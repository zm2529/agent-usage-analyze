import Database from 'better-sqlite3';
import { spawn } from 'child_process';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runMigrations } from '../db/schema.js';
import type { SettledImportDependencies } from './settled-import.js';
import {
  acquireSettledWorkerLease,
  claimDueFrontiers,
  processDueFrontiers,
} from './settled-scheduler.js';

const tempDirs: string[] = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('settled analysis scheduler', () => {
  it('holds one recoverable worker lease', () => {
    const dir = mkdtempSync(join(tmpdir(), 'agent-analytics-settler-'));
    tempDirs.push(dir);
    const databasePath = join(dir, 'data.db');

    const first = acquireSettledWorkerLease(databasePath);
    expect(first).not.toBeNull();
    expect(acquireSettledWorkerLease(databasePath)).toBeNull();
    first?.release();
    const recovered = acquireSettledWorkerLease(databasePath);
    expect(recovered).not.toBeNull();
    recovered?.release();
  });

  it('recovers the lease after a worker is killed', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'agent-analytics-settler-crash-'));
    tempDirs.push(dir);
    const databasePath = join(dir, 'data.db');
    acquireSettledWorkerLease(databasePath)?.release();
    const lockPath = `${databasePath}.settler/lock.db`;
    const child = spawn(process.execPath, ['--input-type=module', '-e', `
      import Database from 'better-sqlite3';
      const db = new Database(process.argv[1]);
      db.pragma('busy_timeout = 0');
      db.exec('BEGIN EXCLUSIVE');
      db.prepare('UPDATE worker_lock SET id = 1 WHERE id = 1').run();
      process.stdout.write('locked\\n');
      setInterval(() => db.prepare('SELECT 1').get(), 1000);
    `, lockPath], { cwd: join(import.meta.dirname, '../..'), stdio: ['ignore', 'pipe', 'pipe'] });
    await new Promise<void>((resolveReady, reject) => {
      child.once('error', reject);
      child.stdout.once('data', (chunk) => chunk.toString().includes('locked')
        ? resolveReady()
        : reject(new Error('lock child failed')));
      child.stderr.once('data', (chunk) => reject(new Error(chunk.toString())));
    });

    expect(acquireSettledWorkerLease(databasePath)).toBeNull();
    child.kill('SIGKILL');
    await new Promise<void>((resolveExit) => child.once('exit', () => resolveExit()));
    const recovered = acquireSettledWorkerLease(databasePath);
    expect(recovered).not.toBeNull();
    recovered?.release();
  });

  it('atomically claims only settled generations once', () => {
    const db = new Database(':memory:');
    runMigrations(db);
    const insert = db.prepare(`INSERT INTO analysis_queue
      (source_tool, session_id, status, runner_type, generation, not_before) VALUES (?, ?, 'settling', 'auto', ?, ?)`);
    insert.run('codex-cli', 'due', 2, '2026-07-22T03:00:00.000Z');
    insert.run('codex-cli', 'later', 1, '2026-07-22T03:02:00.000Z');

    expect(claimDueFrontiers(db, new Date('2026-07-22T03:01:00Z'))).toEqual([
      {
        sourceTool: 'codex-cli', sessionId: 'due', generation: 2,
        locator: null, sourceBasis: null,
      },
    ]);
    expect(db.prepare(`SELECT status FROM analysis_queue WHERE session_id = 'due'`).get())
      .toEqual({ status: 'processing' });
    expect(claimDueFrontiers(db, new Date('2026-07-22T03:01:00Z'))).toEqual([]);
    expect(db.prepare(`SELECT status FROM analysis_queue WHERE session_id = 'later'`).get())
      .toEqual({ status: 'settling' });
    db.close();
  });

  it('runs each due claim through settled import instead of the legacy queue', async () => {
    const db = new Database(':memory:');
    runMigrations(db);
    db.prepare(`INSERT INTO analysis_queue
      (source_tool, session_id, status, runner_type, generation, not_before)
      VALUES ('codex-cli', 'due', 'settling', 'auto', 1, '2026-07-22T03:00:00.000Z')`).run();
    const commit = vi.fn();
    const prepareProjection = vi.fn(async () => ({ complete: true, diagnostic: null, commit }));
    const deps: SettledImportDependencies = {
      now: () => new Date('2026-07-22T03:01:00Z'),
      idleSeconds: 90,
      locate: () => ({ path: '/safe/rollout.jsonl', locatorAccepted: false, diagnostic: null }),
      contentBasis: () => 'rollout-sha256:stable',
      ingest: async () => ({ complete: true, diagnostic: null }),
      prepareProjection,
      invalidateProjection: vi.fn(),
      execution: { effectiveRunner: 'local-only', reason: 'explicit-local-only' },
    };

    await expect(processDueFrontiers(
      db,
      new Date('2026-07-22T03:01:00Z'),
      () => deps,
    )).resolves.toBe(1);
    expect(prepareProjection).toHaveBeenCalledOnce();
    expect(commit).toHaveBeenCalledOnce();
    expect(db.prepare(`SELECT status FROM analysis_queue WHERE session_id = 'due'`).get())
      .toEqual({ status: 'completed' });
    db.close();
  });

  it('backs off transient worker failures and fails only at the attempt limit', async () => {
    const db = new Database(':memory:');
    runMigrations(db);
    db.prepare(`INSERT INTO analysis_queue
      (source_tool, session_id, status, runner_type, generation, not_before, max_attempts)
      VALUES ('codex-cli', 'due', 'settling', 'auto', 1, '2026-07-22T03:00:00.000Z', 2)`).run();
    const failingFactory = () => { throw new Error('temporary import failure'); };

    await expect(processDueFrontiers(db, new Date('2026-07-22T03:01:00Z'), failingFactory))
      .resolves.toBe(1);
    expect(db.prepare(`SELECT status, attempt_count, not_before FROM analysis_queue`).get())
      .toEqual({ status: 'settling', attempt_count: 1, not_before: '2026-07-22T03:02:30.000Z' });

    db.prepare(`UPDATE analysis_queue SET not_before = '2026-07-22T03:02:00.000Z'`).run();
    await expect(processDueFrontiers(db, new Date('2026-07-22T03:03:00Z'), failingFactory))
      .resolves.toBe(1);
    expect(db.prepare(`SELECT status, attempt_count, diagnostic FROM analysis_queue`).get())
      .toEqual({ status: 'failed', attempt_count: 2, diagnostic: 'settled-import-failed' });
    db.close();
  });
});
