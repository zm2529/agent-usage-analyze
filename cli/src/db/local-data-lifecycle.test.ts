import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { runMigrations } from './migrate.js';
import { archiveLocalAnalysisData } from './local-data-lifecycle.js';
import { acquireDatabaseOwner } from './lifecycle-lock.js';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('archiveLocalAnalysisData', () => {
  it('moves only product-owned data to a recoverable backup and leaves sources and Git untouched', () => {
    const dir = mkdtempSync(join(tmpdir(), 'agent-analytics-reset-'));
    dirs.push(dir);
    const configDir = join(dir, 'config');
    const dbPath = join(configDir, 'data.db');
    const syncStatePath = join(configDir, 'sync-state.json');
    const sourcePath = join(dir, 'rollout.jsonl');
    const repo = join(dir, 'repo');
    mkdirSync(configDir, { recursive: true });
    mkdirSync(repo, { recursive: true });
    writeFileSync(sourcePath, 'SOURCE_MUST_SURVIVE\n');
    writeFileSync(syncStatePath, '{"cursor":1}');
    execFileSync('git', ['init', '-q'], { cwd: repo });
    writeFileSync(join(repo, 'kept.txt'), 'GIT_MUST_SURVIVE\n');
    execFileSync('git', ['add', 'kept.txt'], { cwd: repo });
    execFileSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid',
      'commit', '-qm', 'fixture'], { cwd: repo });
    const headBefore = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();
    const db = new Database(dbPath);
    runMigrations(db);
    db.prepare(`INSERT INTO usage_stats (id, total_input_tokens) VALUES (1, 99)`).run();
    db.close();

    const result = archiveLocalAnalysisData({
      dbPath, syncStatePath, now: '2026-07-21T01:00:00.000Z',
    });

    expect(result).toMatchObject({
      status: 'archived', rebuildCommand: 'agent-usage-analyze import-codex',
    });
    expect(result.databaseBackupPath).toMatch(/\.backup$/);
    expect(result.syncStateBackupPath).toMatch(/\.json$/);
    expect(readFileSync(sourcePath, 'utf8')).toBe('SOURCE_MUST_SURVIVE\n');
    expect(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim())
      .toBe(headBefore);
    expect(execFileSync('git', ['status', '--porcelain'], { cwd: repo, encoding: 'utf8' })).toBe('');
    const backup = new Database(result.databaseBackupPath!);
    expect(backup.prepare('SELECT total_input_tokens FROM usage_stats WHERE id = 1').get())
      .toEqual({ total_input_tokens: 99 });
    backup.close();
  });

  it('refuses an incomplete archive while another WAL reader is active', () => {
    const dir = mkdtempSync(join(tmpdir(), 'agent-analytics-active-reset-'));
    dirs.push(dir);
    const dbPath = join(dir, 'data.db');
    const writer = new Database(dbPath);
    writer.pragma('journal_mode = WAL');
    runMigrations(writer);
    writer.exec('CREATE TABLE archive_probe (id INTEGER PRIMARY KEY, value TEXT); INSERT INTO archive_probe VALUES (1, \'before\')');
    const reader = new Database(dbPath);
    reader.exec('BEGIN');
    expect(reader.prepare('SELECT value FROM archive_probe').get()).toEqual({ value: 'before' });
    writer.prepare("UPDATE archive_probe SET value = 'after' WHERE id = 1").run();
    writer.close();

    expect(() => archiveLocalAnalysisData({
      dbPath, syncStatePath: join(dir, 'sync-state.json'), now: '2026-07-21T01:00:00.000Z',
    })).toThrow(/database is active/i);
    expect(existsSync(dbPath)).toBe(true);
    reader.exec('ROLLBACK');
    reader.close();
  });

  it('refuses to rename data behind an idle product database owner', () => {
    const dir = mkdtempSync(join(tmpdir(), 'agent-analytics-idle-owner-reset-'));
    dirs.push(dir);
    const dbPath = join(dir, 'data.db');
    const writer = new Database(dbPath);
    runMigrations(writer);
    writer.exec('CREATE TABLE owner_probe (value TEXT); INSERT INTO owner_probe VALUES (\'before\')');
    const owner = acquireDatabaseOwner(dbPath);
    expect(() => archiveLocalAnalysisData({
      dbPath, syncStatePath: join(dir, 'sync-state.json'), now: '2026-07-21T01:00:00.000Z',
    })).toThrow(/database is active/i);
    writer.prepare("UPDATE owner_probe SET value = 'after'").run();
    expect(writer.prepare('SELECT value FROM owner_probe').get()).toEqual({ value: 'after' });
    expect(existsSync(dbPath)).toBe(true);
    expect(existsSync(join(dir, 'backups'))).toBe(false);
    writer.close();
    owner.release();
  });
});
