import { spawn } from 'child_process';
import { closeSync, existsSync, mkdirSync, openSync } from 'fs';
import { join, resolve } from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';
import { getConfigDir } from '../utils/config.js';
import { getDb, getDbPath } from '../db/client.js';

const CLI_ENTRY = resolve(fileURLToPath(import.meta.url), '../../index.js');

export interface SettledWorkerLease {
  release(): void;
}

export interface PromotedFrontier {
  sourceTool: string;
  sessionId: string;
  generation: number;
}

/**
 * Try to acquire an OS-backed SQLite lease. A killed worker cannot leave it
 * stale because the kernel releases the transaction lock with the process.
 */
export function acquireSettledWorkerLease(databasePath: string): SettledWorkerLease | null {
  const root = `${databasePath}.settler`;
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const lockDb = new Database(join(root, 'lock.db'));
  try {
    lockDb.pragma('busy_timeout = 0');
    lockDb.pragma('journal_mode = DELETE');
    lockDb.exec(`CREATE TABLE IF NOT EXISTS worker_lock (id INTEGER PRIMARY KEY CHECK (id = 1));`);
    lockDb.prepare(`INSERT OR IGNORE INTO worker_lock (id) VALUES (1)`).run();
    lockDb.exec('BEGIN EXCLUSIVE');
    lockDb.prepare('UPDATE worker_lock SET id = 1 WHERE id = 1').run();
    let released = false;
    return {
      release() {
        if (released) return;
        released = true;
        try {
          if (lockDb.inTransaction) lockDb.exec('ROLLBACK');
        } finally {
          lockDb.close();
        }
      },
    };
  } catch (error) {
    lockDb.close();
    if ((error as { code?: unknown }).code === 'SQLITE_BUSY') return null;
    throw error;
  }
}

/** Promote due frontiers with one atomic status transition. */
export function promoteDueFrontiers(
  db: Database.Database,
  now: Date,
): PromotedFrontier[] {
  const rows = db.prepare(
    `UPDATE analysis_queue
     SET status = CASE WHEN runner_type = 'auto' THEN 'awaiting-capability' ELSE 'pending' END,
         diagnostic = CASE WHEN runner_type = 'auto' THEN 'analysis-capability-not-selected' ELSE NULL END
     WHERE status = 'settling' AND not_before <= ?
     RETURNING source_tool, session_id, generation`,
  ).all(now.toISOString()) as Array<{ source_tool: string; session_id: string; generation: number }>;
  return rows.map((row) => ({
    sourceTool: row.source_tool,
    sessionId: row.session_id,
    generation: row.generation,
  }));
}

function earliestDeadline(db: Database.Database): string | null {
  const row = db.prepare(
    `SELECT MIN(not_before) AS deadline FROM analysis_queue WHERE status = 'settling'`,
  ).get() as { deadline: string | null };
  return row.deadline;
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolveWait) => setTimeout(resolveWait, milliseconds));
}

/** Wait for the moving frontier and promote each due generation exactly once. */
export async function runSettledScheduler(): Promise<number> {
  const lease = acquireSettledWorkerLease(getDbPath());
  if (!lease) return 0;
  let promoted = 0;
  try {
    const db = getDb();
    while (true) {
      const deadline = earliestDeadline(db);
      if (!deadline) return promoted;
      const remaining = new Date(deadline).getTime() - Date.now();
      if (remaining > 0) {
        await wait(Math.min(remaining, 60_000));
        continue;
      }
      promoted += promoteDueFrontiers(db, new Date()).length;
    }
  } finally {
    lease.release();
  }
}

/** Start the single-lease settled worker without retaining the Hook process. */
export function spawnSettledScheduler(): void {
  const configDir = getConfigDir();
  if (!existsSync(configDir)) mkdirSync(configDir, { recursive: true, mode: 0o700 });
  const logFd = openSync(join(configDir, 'settled-analysis.log'), 'a', 0o600);
  try {
    const child = spawn(process.execPath, [CLI_ENTRY, 'queue', 'settle', '-q'], {
      detached: true,
      stdio: ['ignore', logFd, logFd],
      env: { ...process.env, AGENT_ANALYTICS_HOOK_ACTIVE: '1' },
    });
    child.on('error', () => {
      // The persisted frontier remains recoverable by the next Hook or manual queue run.
    });
    child.unref();
  } finally {
    closeSync(logFd);
  }
}
