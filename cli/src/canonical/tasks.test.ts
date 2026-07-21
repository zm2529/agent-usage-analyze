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
});
