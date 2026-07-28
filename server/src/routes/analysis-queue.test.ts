import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runMigrations } from 'agent-usage-analyze/db/schema';

let testDb: Database.Database;
const spawnSettledAnalysisWorker = vi.hoisted(() => vi.fn());

vi.mock('agent-usage-analyze/db/client', () => ({
  getDb: () => testDb,
  closeDb: () => {},
}));

vi.mock('agent-usage-analyze/utils/telemetry', () => ({ trackEvent: vi.fn() }));
vi.mock('agent-usage-analyze/analysis/settled-scheduler', async (importOriginal) => ({
  ...await importOriginal<typeof import('agent-usage-analyze/analysis/settled-scheduler')>(),
  spawnSettledAnalysisWorker,
}));

const { createApp } = await import('../index.js');

describe('GET /api/analysis/queue', () => {
  beforeEach(() => {
    spawnSettledAnalysisWorker.mockClear();
    testDb = new Database(':memory:');
    runMigrations(testDb);
  });

  afterEach(() => testDb.close());

  it('exposes settled automation lifecycle states', async () => {
    for (const [index, status] of [
      'settling', 'awaiting-capability', 'pending', 'processing', 'completed', 'failed',
    ].entries()) {
      testDb.prepare(`INSERT INTO analysis_queue (source_tool, session_id, status, runner_type, generation)
        VALUES ('codex-cli', ?, ?, 'auto', ?)`).run(
        `session-${index}`, status, index + 1,
      );
    }

    const response = await createApp().request('/api/analysis/queue');
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      settling: 1,
      awaitingCapability: 1,
      pending: 1,
      processing: 1,
      completed: 1,
      failed: 1,
      latestAutomatic: { session_id: 'session-5', status: 'failed', generation: 6 },
    });
  });

  it('starts a retry for analysis records waiting on capability', async () => {
    testDb.prepare(`INSERT INTO analysis_queue
      (source_tool, session_id, status, runner_type, generation)
      VALUES ('codex-cli', 'waiting-session', 'awaiting-capability', 'auto', 1)`).run();
    testDb.prepare(`INSERT INTO projects (id, name, path, last_activity)
      VALUES ('project', 'Project', '/project', datetime('now'))`).run();
    testDb.prepare(`INSERT INTO sessions
      (id, project_id, project_name, project_path, started_at, ended_at)
      VALUES ('codex:waiting-session', 'project', 'Project', '/project', datetime('now'), datetime('now'))`).run();
    testDb.prepare(`INSERT INTO messages
      (id, session_id, type, content, timestamp)
      VALUES ('message', 'codex:waiting-session', 'user', 'hello', datetime('now'))`).run();

    const response = await createApp().request('/api/analysis/queue/retry', { method: 'POST' });

    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ accepted: true, retrying: 1 });
    expect(spawnSettledAnalysisWorker).toHaveBeenCalledOnce();
  });

  it('does not include historical waiting records in a retry', async () => {
    const insert = testDb.prepare(`INSERT INTO analysis_queue
      (source_tool, session_id, status, runner_type, generation, enqueued_at, completed_at)
      VALUES ('codex-cli', ?, ?, 'auto', 1, ?, ?)`);
    insert.run('historical-waiting', 'awaiting-capability', '2026-07-22T02:00:00.000Z', null);
    insert.run('latest-success', 'completed', '2026-07-22T03:00:00.000Z', '2026-07-22T03:05:00.000Z');
    insert.run('current-waiting', 'awaiting-capability', '2026-07-22T03:06:00.000Z', null);
    testDb.prepare(`INSERT INTO projects (id, name, path, last_activity)
      VALUES ('project', 'Project', '/project', datetime('now'))`).run();
    testDb.prepare(`INSERT INTO sessions
      (id, project_id, project_name, project_path, started_at, ended_at)
      VALUES ('codex:current-waiting', 'project', 'Project', '/project', datetime('now'), datetime('now'))`).run();
    testDb.prepare(`INSERT INTO messages
      (id, session_id, type, content, timestamp)
      VALUES ('message', 'codex:current-waiting', 'user', 'hello', datetime('now'))`).run();

    const response = await createApp().request('/api/analysis/queue/retry', { method: 'POST' });

    expect(await response.json()).toEqual({ accepted: true, retrying: 1 });
    expect(spawnSettledAnalysisWorker).toHaveBeenCalledOnce();
  });

  it('retries a failed oversized automatic analysis but leaves non-actionable failures alone', async () => {
    const insert = testDb.prepare(`INSERT INTO analysis_queue
      (source_tool, session_id, status, runner_type, generation, error_message)
      VALUES ('codex-cli', ?, 'failed', 'auto', 1, ?)`);
    insert.run('oversized', 'Automatic analysis rejected: input-evidence-too-large');
    insert.run('empty', 'Analysis unavailable: no genuine user messages were imported for this session.');

    const response = await createApp().request('/api/analysis/queue/retry', { method: 'POST' });

    expect(await response.json()).toEqual({ accepted: true, retrying: 1 });
    expect(testDb.prepare(`SELECT status FROM analysis_queue WHERE session_id = 'oversized'`)
      .get()).toEqual({ status: 'settling' });
    expect(testDb.prepare(`SELECT status FROM analysis_queue WHERE session_id = 'empty'`)
      .get()).toEqual({ status: 'failed' });
  });
});
