import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { runMigrations } from './schema.js';
import { claimNext, getQueueStatus, markCompleted, markFailed, resetFailed, resetStale } from './queue.js';
import { recordSettledFrontier } from '../analysis/settled-frontier.js';

describe('settled analysis queue states', () => {
  it('reports all six lifecycle states and exposes every actionable item', () => {
    const db = new Database(':memory:');
    runMigrations(db);
    for (const [index, status] of [
      'settling', 'awaiting-capability', 'pending', 'processing', 'completed', 'failed',
    ].entries()) {
      db.prepare(`INSERT INTO analysis_queue (source_tool, session_id, status) VALUES (?, ?, ?)`).run(
        'codex-cli', `s${index}`, status,
      );
    }

    expect(getQueueStatus(db)).toMatchObject({
      settling: 1,
      awaitingCapability: 1,
      pending: 1,
      processing: 1,
      completed: 1,
      failed: 1,
    });
    expect(getQueueStatus(db).items.map((item) => item.status)).toEqual(expect.arrayContaining([
      'settling', 'awaiting-capability', 'pending', 'processing', 'failed',
    ]));
    db.close();
  });

  it('claims one source-scoped pending row atomically', () => {
    const db = new Database(':memory:');
    runMigrations(db);
    db.prepare(`INSERT INTO analysis_queue (source_tool, session_id, status) VALUES ('claude-code', 'same', 'pending')`).run();
    db.prepare(`INSERT INTO analysis_queue (source_tool, session_id, status, runner_type) VALUES ('codex-cli', 'same', 'pending', 'auto')`).run();

    const claimed = claimNext(db);
    expect(claimed).toMatchObject({ source_tool: 'claude-code', session_id: 'same', status: 'processing' });
    expect(db.prepare(`SELECT COUNT(*) AS count FROM analysis_queue WHERE status = 'pending'`).get())
      .toEqual({ count: 1 });
    expect(claimNext(db)).toBeNull();
    db.close();
  });

  it('rejects stale completion or failure after a newer generation settles', () => {
    const db = new Database(':memory:');
    runMigrations(db);
    db.prepare(`INSERT INTO analysis_queue
      (source_tool, session_id, status, generation) VALUES ('codex-cli', 'session', 'pending', 1)`).run();
    const claimed = claimNext(db)!;
    recordSettledFrontier(db,
      { source: 'codex-cli', sessionId: 'session', turnId: 'new-turn', basis: 'new-basis' }, new Date(0), 90);

    expect(markCompleted('session', 'codex-cli', claimed.generation, db)).toBe(false);
    expect(markFailed('session', 'old failure', 'codex-cli', claimed.generation, db)).toBe(false);
    expect(db.prepare(`SELECT status, generation FROM analysis_queue WHERE session_id = 'session'`).get())
      .toEqual({ status: 'settling', generation: 2 });
    db.close();
  });

  it('requires source disambiguation when retry ids collide', () => {
    const db = new Database(':memory:');
    runMigrations(db);
    db.prepare(`INSERT INTO analysis_queue (source_tool, session_id, status) VALUES ('claude-code', 'same', 'failed')`).run();
    db.prepare(`INSERT INTO analysis_queue (source_tool, session_id, status, runner_type)
      VALUES ('codex-cli', 'same', 'failed', 'auto')`).run();

    expect(() => resetFailed('same', undefined, db)).toThrow(/source/i);
    expect(resetFailed('same', 'codex-cli', db)).toBe(1);
    expect(db.prepare(`SELECT source_tool, status FROM analysis_queue ORDER BY source_tool`).all()).toEqual([
      { source_tool: 'claude-code', status: 'failed' },
      { source_tool: 'codex-cli', status: 'settling' },
    ]);
    db.close();
  });

  it('returns stale auto workers to the settled scheduler rather than the legacy worker', () => {
    const db = new Database(':memory:');
    runMigrations(db);
    db.prepare(`INSERT INTO analysis_queue
      (source_tool, session_id, status, runner_type, started_at)
      VALUES ('codex-cli', 'auto', 'processing', 'auto',
        strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-11 minutes'))`).run();

    expect(resetStale(db)).toBe(1);
    expect(db.prepare(`SELECT status, not_before FROM analysis_queue`).get()).toMatchObject({
      status: 'settling',
    });
    db.close();
  });

  it('lets manual retry resume an awaiting auto frontier', () => {
    const db = new Database(':memory:');
    runMigrations(db);
    db.prepare(`INSERT INTO analysis_queue
      (source_tool, session_id, status, runner_type, attempt_count)
      VALUES ('codex-cli', 'awaiting', 'awaiting-capability', 'auto', 3)`).run();

    expect(resetFailed('awaiting', 'codex-cli', db)).toBe(1);
    expect(db.prepare(`SELECT status, attempt_count FROM analysis_queue`).get()).toEqual({
      status: 'settling', attempt_count: 0,
    });
    db.close();
  });
});
