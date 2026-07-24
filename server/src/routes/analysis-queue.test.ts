import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runMigrations } from 'agent-usage-analyze/db/schema';

let testDb: Database.Database;

vi.mock('agent-usage-analyze/db/client', () => ({
  getDb: () => testDb,
  closeDb: () => {},
}));

vi.mock('agent-usage-analyze/utils/telemetry', () => ({ trackEvent: vi.fn() }));

const { createApp } = await import('../index.js');

describe('GET /api/analysis/queue', () => {
  beforeEach(() => {
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
});
