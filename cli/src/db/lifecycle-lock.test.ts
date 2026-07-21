import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { acquireDatabaseExclusive, acquireDatabaseOwner } from './lifecycle-lock.js';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('database lifecycle lock', () => {
  it('uses an OS lock that excludes owners and cannot be left stale by a crashed process', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'agent-analytics-lifecycle-lock-'));
    dirs.push(dir);
    const dbPath = join(dir, 'data.db');
    const initialized = acquireDatabaseExclusive(dbPath);
    initialized.release();
    const lockPath = `${dbPath}.lifecycle/lock.db`;
    const child = spawn(process.execPath, ['--input-type=module', '-e', `
      import Database from 'better-sqlite3';
      const db = new Database(process.argv[1]);
      db.pragma('busy_timeout = 0');
      db.exec('BEGIN EXCLUSIVE');
      db.prepare('UPDATE lifecycle_lock SET id = 1 WHERE id = 1').run();
      process.stdout.write('locked\\n');
      setInterval(() => db.prepare('SELECT 1').get(), 1000);
    `, lockPath], { cwd: join(import.meta.dirname, '../..'), stdio: ['pipe', 'pipe', 'pipe'] });
    await new Promise<void>((resolve, reject) => {
      child.once('error', reject);
      child.stdout.once('data', (chunk) => chunk.toString().includes('locked') ? resolve() : reject(new Error('lock child failed')));
      child.stderr.once('data', (chunk) => reject(new Error(chunk.toString())));
    });

    expect(() => acquireDatabaseOwner(dbPath)).toThrow(/lifecycle operation is in progress/i);
    expect(() => acquireDatabaseExclusive(dbPath)).toThrow(/another lifecycle operation is in progress/i);
    child.kill('SIGKILL');
    await new Promise<void>((resolve) => child.once('exit', () => resolve()));

    const recovered = acquireDatabaseExclusive(dbPath);
    recovered.release();
  });
});
