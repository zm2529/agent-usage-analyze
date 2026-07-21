import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { runMigrations } from '../db/migrate.js';
import { openReadonlyAdvisoryDatabase, resolveReadonlyAdvisoryFilename } from './advisory-worker-db.js';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const digest = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');

describe('read-only advisory database snapshots', () => {
  it('uses an immutable URI when no live WAL snapshot exists', () => {
    const dir = mkdtempSync(join(tmpdir(), 'agent-analytics-advisory-immutable-'));
    dirs.push(dir);
    const dbPath = join(dir, 'data.db');
    const writer = new Database(dbPath);
    runMigrations(writer);
    writer.close();

    expect(resolveReadonlyAdvisoryFilename(dbPath)).toEqual({
      filename: expect.stringMatching(/^file:.*data\.db\?immutable=1&mode=ro$/),
      snapshotMode: 'immutable',
    });
    expect(readdirSync(dir)).toEqual(['data.db']);
  });

  it('abstains from an active WAL without changing database, WAL, or shared-memory bytes', () => {
    const dir = mkdtempSync(join(tmpdir(), 'agent-analytics-advisory-wal-'));
    dirs.push(dir);
    const dbPath = join(dir, 'data.db');
    const writer = new Database(dbPath);
    writer.pragma('journal_mode = WAL');
    runMigrations(writer);
    writer.exec(`
      INSERT INTO observation_eras
        (id, name, mode, parser_version, capabilities_json, starts_at)
      VALUES ('era:wal', 'wal', 'continuous-observation', 'fixture-v1', '[]',
        '2026-07-21T00:00:00.000Z');
      INSERT INTO work_tasks
        (id, root_task_id, thread_id, role, status, started_at, era_id)
      VALUES ('task:wal', 'task:wal', 'thread:wal', 'root', 'active',
        '2026-07-21T00:00:00.000Z', 'era:wal');
    `);
    const before = {
      db: digest(dbPath), wal: digest(`${dbPath}-wal`), shm: digest(`${dbPath}-shm`),
    };
    const files = readdirSync(dir).sort();

    expect(() => openReadonlyAdvisoryDatabase(dbPath)).toThrow(/WAL is active/i);

    expect(readdirSync(dir).sort()).toEqual(files);
    expect({
      db: digest(dbPath), wal: digest(`${dbPath}-wal`), shm: digest(`${dbPath}-shm`),
    }).toEqual(before);
    writer.close();
  });
});
