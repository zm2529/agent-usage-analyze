import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { assertCanonicalAutoMigrationAllowed, expandProjectContract } from './product-migration.js';
import { acquireDatabaseOwner } from './lifecycle-lock.js';
import { recordSettledFrontier } from '../analysis/settled-frontier.js';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function createLegacyV9(dbPath: string): void {
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE schema_version (version INTEGER PRIMARY KEY, applied_at TEXT);
    INSERT INTO schema_version (version, applied_at) VALUES (9, '2026-07-01T00:00:00.000Z');
    CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT, path TEXT, last_activity TEXT);
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY, project_id TEXT, project_name TEXT, project_path TEXT,
      started_at TEXT, ended_at TEXT, message_count INTEGER, source_tool TEXT
    );
    CREATE TABLE messages (
      id TEXT PRIMARY KEY, session_id TEXT, type TEXT, content TEXT, thinking TEXT,
      tool_calls TEXT, tool_results TEXT, usage TEXT, timestamp TEXT, parent_id TEXT
    );
    INSERT INTO projects VALUES ('project:private', 'private', '/Users/alice/SecretRepo',
      '2026-07-01T00:10:00.000Z');
    INSERT INTO sessions VALUES (
      'session:private', 'project:private', 'private', '/Users/alice/SecretRepo',
      '2026-07-01T00:00:00.000Z', '2026-07-01T00:10:00.000Z', 2, 'codex'
    );
    INSERT INTO messages VALUES
      ('message:one', 'session:private', 'user', 'TOP_SECRET_PROMPT', NULL, NULL, NULL,
       NULL, '2026-07-01T00:01:00.000Z', NULL),
      ('message:two', 'session:private', 'assistant', 'PRIVATE_CODE', 'PRIVATE_THINKING',
       NULL, NULL, NULL, '2026-07-01T00:02:00.000Z', 'message:one');
  `);
  db.close();
}

describe('expandProjectContract', () => {
  it('blocks automatic mutation of a frozen legacy database before backup', () => {
    const dir = mkdtempSync(join(tmpdir(), 'agent-analytics-auto-migration-'));
    dirs.push(dir);
    const dbPath = join(dir, 'data.db');
    createLegacyV9(dbPath);
    const db = new Database(dbPath);
    expect(() => assertCanonicalAutoMigrationAllowed(db)).toThrow(/backup-first migration/i);
    expect(db.prepare('SELECT MAX(version) AS version FROM schema_version').get())
      .toEqual({ version: 9 });
    db.close();
  });

  it('refuses migration while another product database owner is open', () => {
    const dir = mkdtempSync(join(tmpdir(), 'agent-analytics-owned-migration-'));
    dirs.push(dir);
    const dbPath = join(dir, 'data.db');
    createLegacyV9(dbPath);
    const owner = acquireDatabaseOwner(dbPath);
    const writer = new Database(dbPath);
    expect(() => expandProjectContract({ dbPath })).toThrow(/database is active/i);
    writer.prepare("UPDATE sessions SET project_name = 'still-live' WHERE id = 'session:private'").run();
    writer.close();
    owner.release();
    const unchanged = new Database(dbPath);
    expect(unchanged.prepare('SELECT MAX(version) AS version FROM schema_version').get())
      .toEqual({ version: 9 });
    expect(unchanged.prepare('SELECT project_name FROM sessions').get())
      .toEqual({ project_name: 'still-live' });
    unchanged.close();
  });

  it('backs up, redacts, reconciles, and read-protects a frozen legacy V9 database idempotently', () => {
    const dir = mkdtempSync(join(tmpdir(), 'agent-analytics-migration-'));
    dirs.push(dir);
    const dbPath = join(dir, 'data.db');
    createLegacyV9(dbPath);

    const first = expandProjectContract({ dbPath, now: '2026-07-21T01:00:00.000Z' });
    const second = expandProjectContract({ dbPath, now: '2026-07-21T02:00:00.000Z' });

    expect(first).toMatchObject({
      status: 'migrated', sourceSchemaVersion: 9, targetSchemaVersion: 23,
      reconciliation: { legacySessions: 1, canonicalTasks: 1, legacyMessages: 2, canonicalEvents: 2 },
    });
    expect(first.backupPath).toMatch(/\.backup$/);
    expect(first.reportPath).toMatch(/\.json$/);
    expect(second).toMatchObject({ status: 'current', migrationId: first.migrationId });
    expect(readdirSync(join(dir, 'backups')).filter((name) => name.endsWith('.backup'))).toHaveLength(1);

    const migrated = new Database(dbPath);
    expect(migrated.prepare('SELECT MAX(version) AS version FROM schema_version').get())
      .toEqual({ version: 23 });
    expect(migrated.prepare('SELECT COUNT(*) AS count FROM work_tasks').get()).toEqual({ count: 1 });
    expect(migrated.prepare('SELECT COUNT(*) AS count FROM canonical_events').get()).toEqual({ count: 2 });
    expect(JSON.stringify(migrated.prepare('SELECT payload_json FROM canonical_events').all()))
      .not.toMatch(/TOP_SECRET_PROMPT|PRIVATE_CODE|PRIVATE_THINKING|SecretRepo/);
    expect(() => migrated.prepare("UPDATE sessions SET project_name = 'changed'").run())
      .toThrow(/legacy tables are read-only/i);
    expect(recordSettledFrontier(migrated, {
      source: 'codex-cli', sessionId: 'session:private', turnId: 'turn:after-migration', basis: 'basis',
    }, new Date('2026-07-21T03:00:00.000Z'), 90)).toMatchObject({ generation: 1, status: 'settling' });
    migrated.close();

    const backup = new Database(first.backupPath!);
    expect(backup.prepare('SELECT MAX(version) AS version FROM schema_version').get())
      .toEqual({ version: 9 });
    expect(backup.prepare('SELECT content FROM messages WHERE id = ?').get('message:one'))
      .toEqual({ content: 'TOP_SECRET_PROMPT' });
    backup.close();
    expect(readFileSync(first.reportPath!, 'utf8')).not.toMatch(/TOP_SECRET_PROMPT|SecretRepo/);
  });

  it('initializes an empty database without a backup and remains idempotent', () => {
    const dir = mkdtempSync(join(tmpdir(), 'agent-analytics-empty-migration-'));
    dirs.push(dir);
    const dbPath = join(dir, 'data.db');

    const first = expandProjectContract({ dbPath, now: '2026-07-21T01:00:00.000Z' });
    const second = expandProjectContract({ dbPath, now: '2026-07-21T02:00:00.000Z' });

    expect(first).toMatchObject({ status: 'initialized', backupPath: null, targetSchemaVersion: 23 });
    expect(second).toMatchObject({ status: 'current', migrationId: first.migrationId });
  });

  it('restores the legacy backup when backfill fails', () => {
    const dir = mkdtempSync(join(tmpdir(), 'agent-analytics-rollback-'));
    dirs.push(dir);
    const dbPath = join(dir, 'data.db');
    createLegacyV9(dbPath);

    expect(() => expandProjectContract({
      dbPath, now: '2026-07-21T01:00:00.000Z', failAfterBackfill: true,
    })).toThrow(/injected migration failure/i);

    const restored = new Database(dbPath);
    expect(restored.prepare('SELECT MAX(version) AS version FROM schema_version').get())
      .toEqual({ version: 9 });
    expect(restored.prepare('SELECT content FROM messages WHERE id = ?').get('message:one'))
      .toEqual({ content: 'TOP_SECRET_PROMPT' });
    expect(restored.prepare(`SELECT name FROM sqlite_master WHERE name = 'canonical_events'`).get())
      .toBeUndefined();
    restored.close();
  });

  it('removes a completed report and restores the backup if final recording fails', () => {
    const dir = mkdtempSync(join(tmpdir(), 'agent-analytics-record-rollback-'));
    dirs.push(dir);
    const dbPath = join(dir, 'data.db');
    createLegacyV9(dbPath);

    expect(() => expandProjectContract({
      dbPath, now: '2026-07-21T01:00:00.000Z', failAfterReport: true,
    })).toThrow(/post-report migration failure/i);

    const restored = new Database(dbPath);
    expect(restored.prepare('SELECT MAX(version) AS version FROM schema_version').get())
      .toEqual({ version: 9 });
    restored.close();
    expect(readdirSync(join(dir, 'migration-reports'))).toEqual([]);
  });

  it('rolls back when actual canonical identities do not reconcile', () => {
    const dir = mkdtempSync(join(tmpdir(), 'agent-analytics-reconcile-rollback-'));
    dirs.push(dir);
    const dbPath = join(dir, 'data.db');
    createLegacyV9(dbPath);
    expect(() => expandProjectContract({
      dbPath, now: '2026-07-21T01:00:00.000Z', injectBackfillConflict: true,
    })).toThrow(/identity reconciliation failed/i);
    const restored = new Database(dbPath);
    expect(restored.prepare('SELECT MAX(version) AS version FROM schema_version').get())
      .toEqual({ version: 9 });
    expect(restored.prepare(`SELECT name FROM sqlite_master WHERE name = 'work_tasks'`).get())
      .toBeUndefined();
    restored.close();
  });

  it('restores atomically even when sidecar quarantine falls back to cleanup', () => {
    const dir = mkdtempSync(join(tmpdir(), 'agent-analytics-sidecar-rollback-'));
    dirs.push(dir);
    const dbPath = join(dir, 'data.db');
    createLegacyV9(dbPath);

    expect(() => expandProjectContract({
      dbPath,
      now: '2026-07-21T01:00:00.000Z',
      failAfterBackfill: true,
      failSidecarQuarantine: true,
    })).toThrow(/injected migration failure/i);

    const restored = new Database(dbPath, { readonly: true });
    expect(restored.prepare('SELECT MAX(version) AS version FROM schema_version').get())
      .toEqual({ version: 9 });
    expect(restored.pragma('quick_check')).toEqual([{ quick_check: 'ok' }]);
    restored.close();
    expect(readdirSync(join(dir, 'migration-failures'))).toContainEqual(
      expect.stringMatching(/-recovery\.json$/),
    );
    expect(readFileSync(join(
      dir,
      'migration-failures',
      readdirSync(join(dir, 'migration-failures')).find((name) => name.endsWith('-recovery.json'))!,
    ), 'utf8')).toMatch(/quarantine failed/);
  });

  it('preserves a validated recovery candidate when interrupted before atomic swap', () => {
    const dir = mkdtempSync(join(tmpdir(), 'agent-analytics-restore-interruption-'));
    dirs.push(dir);
    const dbPath = join(dir, 'data.db');
    createLegacyV9(dbPath);

    expect(() => expandProjectContract({
      dbPath,
      now: '2026-07-21T01:00:00.000Z',
      failAfterBackfill: true,
      failRestoreBeforeSwap: true,
    })).toThrow(/injected migration failure; automatic restore incomplete.*backup preserved/i);

    const candidateName = readdirSync(dir).find((name) => name.endsWith('.recovered'));
    expect(candidateName).toBeTruthy();
    const candidate = new Database(join(dir, candidateName!), { readonly: true });
    expect(candidate.prepare('SELECT MAX(version) AS version FROM schema_version').get())
      .toEqual({ version: 9 });
    expect(candidate.pragma('quick_check')).toEqual([{ quick_check: 'ok' }]);
    candidate.close();
    const statusName = readdirSync(join(dir, 'migration-failures'))
      .find((name) => name.endsWith('-recovery.json'));
    expect(readFileSync(join(dir, 'migration-failures', statusName!), 'utf8'))
      .toMatch(/manual|restore incomplete|interruption/i);
  });

  it('never swaps a backup while an unsafe SQLite sidecar remains', () => {
    const dir = mkdtempSync(join(tmpdir(), 'agent-analytics-residual-sidecar-'));
    dirs.push(dir);
    const dbPath = join(dir, 'data.db');
    createLegacyV9(dbPath);

    expect(() => expandProjectContract({
      dbPath,
      now: '2026-07-21T01:00:00.000Z',
      failAfterBackfill: true,
      failSidecarQuarantine: true,
      failSidecarCleanup: true,
    })).toThrow(/automatic restore incomplete: residual SQLite sidecars/i);

    expect(existsSync(`${dbPath}-wal`)).toBe(true);
    const candidateName = readdirSync(dir).find((name) => name.endsWith('.recovered'));
    expect(candidateName).toBeTruthy();
    const candidate = new Database(join(dir, candidateName!), { readonly: true });
    expect(candidate.prepare('SELECT MAX(version) AS version FROM schema_version').get())
      .toEqual({ version: 9 });
    candidate.close();
    const statusName = readdirSync(join(dir, 'migration-failures'))
      .find((name) => name.endsWith('-recovery.json'));
    expect(readFileSync(join(dir, 'migration-failures', statusName!), 'utf8'))
      .toMatch(/residualSidecars[\s\S]*data\.db-wal/);
  });
});
