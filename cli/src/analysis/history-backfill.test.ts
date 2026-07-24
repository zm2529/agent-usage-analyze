import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { runMigrations } from '../db/schema.js';
import { enqueueRecentUnanalyzedSessions } from './history-backfill.js';

describe('enqueueRecentUnanalyzedSessions', () => {
  it('queues only recent, non-trivial, unanalyzed Codex sessions with a bounded limit', () => {
    const db = new Database(':memory:');
    runMigrations(db);
    db.exec(`
      INSERT INTO projects (id, name, path, last_activity) VALUES
        ('p1', 'Codex', '/repo', '2026-07-21T00:00:00.000Z'),
        ('p2', 'Claude', '/repo2', '2026-07-21T00:00:00.000Z');
    `);
    const insert = db.prepare(`INSERT INTO sessions (
      id, project_id, project_name, project_path, started_at, ended_at,
      message_count, source_tool
    ) VALUES (?, ?, 'Project', '/repo', ?, ?, ?, ?)`);
    insert.run('codex:new', 'p1', '2026-07-21T00:00:00.000Z', '2026-07-21T00:10:00.000Z', 8, 'codex-cli');
    insert.run('codex:old', 'p1', '2025-01-01T00:00:00.000Z', '2025-01-01T00:10:00.000Z', 8, 'codex-cli');
    insert.run('codex:tiny', 'p1', '2026-07-21T00:00:00.000Z', '2026-07-21T00:01:00.000Z', 2, 'codex-cli');
    insert.run('claude:new', 'p2', '2026-07-21T00:00:00.000Z', '2026-07-21T00:10:00.000Z', 8, 'claude-code');
    insert.run('codex:done', 'p1', '2026-07-21T00:00:00.000Z', '2026-07-21T00:10:00.000Z', 8, 'codex-cli');
    db.prepare(`INSERT INTO analysis_usage (
      session_id, analysis_type, provider, model, input_tokens, output_tokens,
      estimated_cost_usd, duration_ms, session_message_count
    ) VALUES ('codex:done', 'session', 'codex-native', 'default', 1, 1, 0, 1, 8)`).run();

    expect(enqueueRecentUnanalyzedSessions(db, {
      now: new Date('2026-07-22T00:00:00.000Z'), days: 30, limit: 10,
    })).toBe(1);
    expect(db.prepare(`SELECT source_tool, session_id, runner_type, status FROM analysis_queue`).all())
      .toEqual([{
        source_tool: 'codex-cli', session_id: 'codex:new',
        runner_type: 'automatic-history', status: 'pending',
      }]);
    db.close();
  });
});
