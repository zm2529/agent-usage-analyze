import { spawn } from 'child_process';
import { closeSync, existsSync, mkdirSync, openSync } from 'fs';
import { join, resolve } from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';
import { getConfigDir, loadConfig } from '../utils/config.js';
import { getDb, getDbPath } from '../db/client.js';
import { resetStale } from '../db/queue.js';
import {
  defaultSettledImportDependencies,
  processSettledImport,
  type ClaimedSettledImport,
  type SettledImportDependencies,
} from './settled-import.js';

const CLI_ENTRY = resolve(fileURLToPath(import.meta.url), '../../index.js');

export interface SettledWorkerLease {
  release(): void;
}

export type ClaimedFrontier = ClaimedSettledImport;

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

/** Claim due frontiers with one atomic status transition. */
export function claimDueFrontiers(
  db: Database.Database,
  now: Date,
): ClaimedFrontier[] {
  const rows = db.prepare(
    `UPDATE analysis_queue
     SET status = 'processing', started_at = ?, diagnostic = NULL
     WHERE status = 'settling' AND runner_type = 'auto' AND source_tool = 'codex-cli'
       AND not_before <= ?
     RETURNING source_tool, session_id, generation, transcript_locator, source_basis`,
  ).all(now.toISOString(), now.toISOString()) as Array<{
    source_tool: string;
    session_id: string;
    generation: number;
    transcript_locator: string | null;
    source_basis: string | null;
  }>;
  return rows.map((row) => ({
    sourceTool: row.source_tool,
    sessionId: row.session_id,
    generation: row.generation,
    locator: row.transcript_locator,
    sourceBasis: row.source_basis,
  }));
}

export type SettledDependenciesFactory = (
  db: Database.Database,
  claimed: ClaimedFrontier,
) => SettledImportDependencies;

function configuredIdleSeconds(): number {
  const configured = loadConfig()?.dashboard?.analysis?.idleSeconds;
  return Number.isFinite(configured)
    ? Math.min(3_600, Math.max(5, Math.round(configured!)))
    : 90;
}

/** Claim and import every frontier that is due at this instant. */
export async function processDueFrontiers(
  db: Database.Database,
  now: Date,
  dependencies: SettledDependenciesFactory = (database, claimed) => (
    defaultSettledImportDependencies(database, configuredIdleSeconds(), claimed.sessionId)
  ),
): Promise<number> {
  const claimed = claimDueFrontiers(db, now);
  for (const frontier of claimed) {
    try {
      await processSettledImport(db, frontier, dependencies(db, frontier));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const attempt = db.prepare(
        `SELECT attempt_count, max_attempts FROM analysis_queue
         WHERE source_tool = ? AND session_id = ? AND generation = ? AND status = 'processing'`,
      ).get(frontier.sourceTool, frontier.sessionId, frontier.generation) as {
        attempt_count: number; max_attempts: number;
      } | undefined;
      if (attempt) {
        const nextAttempt = attempt.attempt_count + 1;
        const retryDelaySeconds = Math.min(
          3_600,
          configuredIdleSeconds() * (2 ** Math.max(0, nextAttempt - 1)),
        );
        const retryAt = new Date(now.getTime() + retryDelaySeconds * 1_000).toISOString();
        db.prepare(
          `UPDATE analysis_queue
           SET status = CASE WHEN ? >= max_attempts THEN 'failed' ELSE 'settling' END,
               attempt_count = ?, not_before = ?, diagnostic = 'settled-import-failed',
               error_message = ?, started_at = NULL
           WHERE source_tool = ? AND session_id = ? AND generation = ? AND status = 'processing'`,
        ).run(
          nextAttempt, nextAttempt, retryAt, message,
          frontier.sourceTool, frontier.sessionId, frontier.generation,
        );
      }
    }
  }
  return claimed.length;
}

function earliestDeadline(db: Database.Database): string | null {
  const row = db.prepare(
    `SELECT MIN(not_before) AS deadline FROM analysis_queue
     WHERE status = 'settling' AND runner_type = 'auto' AND source_tool = 'codex-cli'`,
  ).get() as { deadline: string | null };
  return row.deadline;
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolveWait) => setTimeout(resolveWait, milliseconds));
}

/** Wait for the moving frontier and import each due generation exactly once. */
export async function runSettledScheduler(): Promise<number> {
  const lease = acquireSettledWorkerLease(getDbPath());
  if (!lease) return 0;
  let processed = 0;
  try {
    const db = getDb();
    resetStale(db);
    while (true) {
      const deadline = earliestDeadline(db);
      if (!deadline) return processed;
      const remaining = new Date(deadline).getTime() - Date.now();
      if (remaining > 0) {
        await wait(Math.min(remaining, 60_000));
        continue;
      }
      processed += await processDueFrontiers(db, new Date());
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
