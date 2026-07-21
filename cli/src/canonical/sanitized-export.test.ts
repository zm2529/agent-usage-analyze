import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { runMigrations } from '../db/migrate.js';
import { buildSanitizedExport } from './sanitized-export.js';

describe('buildSanitizedExport', () => {
  it('exports only aggregate, versioned, irreversible, evidence-locator data', () => {
    const db = new Database(':memory:');
    runMigrations(db);
    db.exec(`
      INSERT INTO observation_eras
        (id, name, mode, parser_version, capabilities_json, starts_at)
      VALUES ('era:private', 'private era', 'historical-backfill', 'parser-v1', '[]',
        '2026-07-01T00:00:00.000Z');
      INSERT INTO source_artifacts
        (id, source_kind, parser_version, locator_hash, observed_at, era_id)
      VALUES ('source:private', 'synthetic-codex', 'parser-v1', 'sha256:source',
        '2026-07-01T00:00:00.000Z', 'era:private');
      INSERT INTO work_tasks
        (id, root_task_id, thread_id, role, status, started_at, era_id, repo_root)
      VALUES ('task:private-name', 'task:private-name', 'thread:private', 'root', 'completed',
        '2026-07-01T00:00:00.000Z', 'era:private', '/Users/alice/SecretRepo');
      INSERT INTO canonical_events
        (id, source_artifact_id, era_id, native_event_id, sequence, occurred_at, kind,
         actor, sensitivity, payload_json, task_id, thread_id, parser_version)
      VALUES ('event:private-name', 'source:private', 'era:private', 'native:private', 1,
        '2026-07-01T00:01:00.000Z', 'user-message', 'user', 'content',
        '{"text":"TOP_SECRET_PROMPT","code":"PRIVATE_CODE"}',
        'task:private-name', 'thread:private', 'parser-v1');
      INSERT INTO ingestion_runs
        (id, adapter_name, started_at, completed_at, status, discovered_count,
         parsed_count, skipped_count, failed_count, unknown_count, inserted_event_count)
      VALUES ('run:private', 'fixture', '2026-07-01T00:00:00.000Z',
        '2026-07-01T00:02:00.000Z', 'completed', 1, 1, 0, 0, 0, 1);
      INSERT INTO source_ingestion_stats
        (source_artifact_id, discovered_count, parsed_count, skipped_count, failed_count, unknown_count)
      VALUES ('source:private', 1, 1, 0, 0, 0);
    `);

    const result = buildSanitizedExport(db, { now: '2026-07-21T01:00:00.000Z' });
    const serialized = JSON.stringify(result);

    expect(result).toMatchObject({
      schemaVersion: 'agent-analytics.sanitized-export.v1',
      generatedAt: '2026-07-21T01:00:00.000Z',
      summary: { taskCount: 1, eventCount: 1 },
      coverage: { discovered: 1, parsed: 1, skipped: 0, failed: 0, unknown: 0 },
      versions: { databaseSchema: 22, parsers: ['parser-v1'] },
    });
    expect(result.evidenceLocators).toEqual([
      expect.stringMatching(/^event:sha256:[a-f0-9]{64}$/),
    ]);
    expect(serialized).not.toMatch(/TOP_SECRET_PROMPT|PRIVATE_CODE|SecretRepo|private-name|thread:private/);
    db.close();
  });
});
