import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { runMigrations } from '../db/migrate.js';
import { IdentityConflictError, rebuildTaskProjection } from './tasks.js';

describe('work task identity projection', () => {
  it('fails closed when one child has multiple explicit parents', () => {
    const db = new Database(':memory:');
    runMigrations(db);
    db.prepare(`INSERT INTO observation_eras (id, name, mode, parser_version, capabilities_json, starts_at)
      VALUES ('era', 'era', 'historical-backfill', 'v1', '[]', '2026-07-21T00:00:00Z')`).run();
    db.prepare(`INSERT INTO source_artifacts (
      id, source_kind, parser_version, locator_hash, observed_at, era_id, cursor_position
    ) VALUES ('source', 'codex-rollout', 'v1', 'sha256:test', '2026-07-21T00:00:00Z', 'era', 0)`).run();
    db.prepare(`INSERT INTO canonical_events (
      id, source_artifact_id, era_id, native_event_id, sequence, occurred_at,
      kind, actor, sensitivity, payload_json, task_id, thread_id, parser_version
    ) VALUES ('event', 'source', 'era', 'native', 0, '2026-07-21T00:00:00Z',
      'session-meta', 'system', 'metadata', '{"taskRole":"subagent"}', 'child', 'child', 'v1')`).run();
    const edge = db.prepare(`INSERT INTO canonical_identity_edges (source_artifact_id, kind, from_id, to_id)
      VALUES ('source', 'root-child', ?, 'child')`);
    edge.run('parent-a');
    edge.run('parent-b');

    expect(() => rebuildTaskProjection(db)).toThrow(IdentityConflictError);
    expect(db.prepare('SELECT COUNT(*) AS count FROM work_tasks').get()).toEqual({ count: 0 });
    db.close();
  });

  it('computes same-lane deltas by cross-rollout chronology rather than artifact id', () => {
    const db = new Database(':memory:');
    runMigrations(db);
    db.prepare(`INSERT INTO observation_eras (id, name, mode, parser_version, capabilities_json, starts_at)
      VALUES ('era', 'era', 'historical-backfill', 'v1', '[]', '2026-07-21T00:00:00Z')`).run();
    const source = db.prepare(`INSERT INTO source_artifacts (
      id, source_kind, parser_version, locator_hash, observed_at, era_id, cursor_position
    ) VALUES (?, 'codex-rollout', 'v1', ?, '2026-07-21T00:00:00Z', 'era', 0)`);
    source.run('source-a', 'sha256:a');
    source.run('source-z', 'sha256:z');
    const event = db.prepare(`INSERT INTO canonical_events (
      id, source_artifact_id, era_id, native_event_id, sequence, occurred_at,
      kind, actor, sensitivity, payload_json, task_id, thread_id, turn_id,
      generation, attempt, parser_version
    ) VALUES (?, ?, 'era', ?, ?, ?, ?, 'system', 'structural', ?, 'task', 'task', 'turn', 1, 1, 'v1')`);
    event.run('meta', 'source-z', 'meta', 0, '2026-07-21T00:00:00Z', 'session-meta', '{"taskRole":"root"}');
    event.run('later', 'source-a', 'later', 1, '2026-07-21T00:02:00Z', 'token-snapshot', '{"inputTokens":150,"cachedInputTokens":30,"cacheCreationTokens":4,"outputTokens":20,"reasoningTokens":8,"compactionTokens":1}');
    event.run('earlier', 'source-z', 'earlier', 1, '2026-07-21T00:01:00Z', 'token-snapshot', '{"inputTokens":100,"cachedInputTokens":20,"cacheCreationTokens":2,"outputTokens":10,"reasoningTokens":5,"compactionTokens":0}');

    rebuildTaskProjection(db);
    expect(db.prepare(`SELECT event_id AS eventId, status, input_tokens AS inputTokens
      FROM task_token_deltas ORDER BY event_id`).all()).toEqual([
      { eventId: 'earlier', status: 'unknown-baseline', inputTokens: null },
      { eventId: 'later', status: 'known', inputTokens: 50 },
    ]);
    db.close();
  });
});
