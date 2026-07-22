/**
 * analysis_queue CRUD operations.
 *
 * Queue semantics: one row per source + session pair.
 * Retries increment attempt_count in-place — no duplicate rows.
 *
 * Status lifecycle:
 *   settling -> pending -> processing -> completed
 *              awaiting-capability
 *                        -> pending  (retry if attempt_count < max_attempts)
 *                        -> failed   (permanent failure after max_attempts)
 *
 * All write operations are synchronous (better-sqlite3 is sync-only).
 */

import type Database from 'better-sqlite3';
import { getDb } from './client.js';

export type QueueLifecycleStatus =
  | 'settling'
  | 'awaiting-capability'
  | 'pending'
  | 'processing'
  | 'completed'
  | 'failed';

export interface QueueItem {
  source_tool: string;
  session_id: string;
  status: QueueLifecycleStatus;
  runner_type: string;
  latest_turn_id: string | null;
  generation: number;
  transcript_locator: string | null;
  source_basis: string | null;
  not_before: string | null;
  diagnostic: string | null;
  enqueued_at: string;
  started_at: string | null;
  completed_at: string | null;
  error_message: string | null;
  attempt_count: number;
  max_attempts: number;
}

export interface QueueStatus {
  settling: number;
  awaitingCapability: number;
  pending: number;
  processing: number;
  completed: number;
  failed: number;
  items: QueueItem[];
  latestAutomatic: QueueItem | null;
}

/**
 * Add a session to the analysis queue.
 * Uses INSERT OR REPLACE so re-enqueuing a session resets it to pending
 * (handles the case where a session grows after initial enqueue).
 */
export function enqueue(
  sessionId: string,
  runnerType = 'native',
  sourceTool = 'claude-code',
  db: Database.Database = getDb(),
): void {
  db.prepare(
    `INSERT OR REPLACE INTO analysis_queue
       (source_tool, session_id, status, runner_type, enqueued_at, started_at, completed_at, error_message, attempt_count, max_attempts)
     VALUES
       (?, ?, 'pending', ?, datetime('now'), NULL, NULL, NULL, 0, 3)`
  ).run(sourceTool, sessionId, runnerType);
}

/**
 * Atomically claim the next pending item by moving it to 'processing'.
 * Uses UPDATE ... WHERE session_id = (subquery) to avoid a SELECT-then-UPDATE
 * race. Returns the claimed item, or null if the queue is empty.
 *
 * SQLite's single-writer model prevents concurrent claims, but the atomic
 * pattern is still correct and future-safe.
 */
export function claimNext(db: Database.Database = getDb()): QueueItem | null {
  // RETURNING * makes the claim and fetch a single atomic operation,
  // eliminating the UPDATE + SELECT timing window.
  return (db.prepare(
    `UPDATE analysis_queue
     SET status = 'processing', started_at = datetime('now')
     WHERE (source_tool, session_id) = (
       SELECT source_tool, session_id FROM analysis_queue
       WHERE status = 'pending' AND runner_type <> 'auto'
       ORDER BY enqueued_at ASC
       LIMIT 1
     )
     RETURNING *`
  ).get() as QueueItem | undefined) ?? null;
}

export function isProcessingGeneration(
  sessionId: string,
  sourceTool: string,
  generation: number,
  db: Database.Database = getDb(),
): boolean {
  return Boolean(db.prepare(
    `SELECT 1 FROM analysis_queue
     WHERE source_tool = ? AND session_id = ? AND generation = ? AND status = 'processing'`,
  ).get(sourceTool, sessionId, generation));
}

/**
 * Mark an item as completed.
 */
export function markCompleted(
  sessionId: string,
  sourceTool = 'claude-code',
  generation?: number,
  db: Database.Database = getDb(),
): boolean {
  const generationGuard = generation === undefined ? '' : ` AND generation = ? AND status = 'processing'`;
  const result = db.prepare(
    `UPDATE analysis_queue
     SET status = 'completed', completed_at = datetime('now'), error_message = NULL
     WHERE source_tool = ? AND session_id = ?${generationGuard}`
  ).run(sourceTool, sessionId, ...(generation === undefined ? [] : [generation]));
  return result.changes === 1;
}

/**
 * Mark an item as failed (or re-queue for retry).
 * If attempt_count < max_attempts, resets to 'pending' for retry.
 * Otherwise sets status to 'failed' permanently.
 */
export function markFailed(
  sessionId: string,
  errorMessage: string,
  sourceTool = 'claude-code',
  generation?: number,
  db: Database.Database = getDb(),
): boolean {
  // Increment attempt_count and check if we've hit the limit atomically
  const generationGuard = generation === undefined ? '' : ` AND generation = ? AND status = 'processing'`;
  const result = db.prepare(
    `UPDATE analysis_queue
     SET attempt_count = attempt_count + 1,
         error_message = ?,
         status = CASE
           WHEN attempt_count + 1 >= max_attempts THEN 'failed'
           ELSE 'pending'
         END,
         started_at = NULL
     WHERE source_tool = ? AND session_id = ?${generationGuard}`
  ).run(errorMessage, sourceTool, sessionId, ...(generation === undefined ? [] : [generation]));
  return result.changes === 1;
}

/**
 * Reset stale 'processing' items back to 'pending'.
 * Items stuck in 'processing' for more than 10 minutes are considered stale
 * (worker was killed or crashed mid-analysis).
 */
export function resetStale(db: Database.Database = getDb()): number {
  const result = db.prepare(
    `UPDATE analysis_queue
     SET status = CASE WHEN runner_type = 'auto' THEN 'settling' ELSE 'pending' END,
         not_before = CASE WHEN runner_type = 'auto' THEN datetime('now') ELSE not_before END,
         started_at = NULL
     WHERE status = 'processing'
       AND started_at < datetime('now', '-10 minutes')`
  ).run();
  return result.changes;
}

/**
 * Reset failed items back to pending (manual retry).
 * Pass a sessionId to retry one item, or omit to retry all failed items.
 */
export function resetFailed(
  sessionId?: string,
  sourceTool?: string,
  db: Database.Database = getDb(),
): number {
  if (sessionId) {
    if (!sourceTool) {
      const matches = db.prepare(
        `SELECT COUNT(*) AS count FROM analysis_queue
         WHERE session_id = ? AND status IN ('failed', 'awaiting-capability')`,
      ).get(sessionId) as { count: number };
      if (matches.count > 1) {
        throw new Error(`Session ID ${sessionId} is ambiguous; provide a source tool`);
      }
    }
    const result = db.prepare(
      `UPDATE analysis_queue
       SET status = CASE WHEN runner_type = 'auto' THEN 'settling' ELSE 'pending' END,
           not_before = CASE WHEN runner_type = 'auto' THEN datetime('now') ELSE not_before END,
           attempt_count = 0, error_message = NULL, diagnostic = NULL, started_at = NULL
       WHERE session_id = ? AND status IN ('failed', 'awaiting-capability')${sourceTool ? ' AND source_tool = ?' : ''}`
    ).run(sessionId, ...(sourceTool ? [sourceTool] : []));
    return result.changes;
  }
  const result = db.prepare(
    `UPDATE analysis_queue
     SET status = CASE WHEN runner_type = 'auto' THEN 'settling' ELSE 'pending' END,
         not_before = CASE WHEN runner_type = 'auto' THEN datetime('now') ELSE not_before END,
         attempt_count = 0, error_message = NULL, diagnostic = NULL, started_at = NULL
     WHERE status IN ('failed', 'awaiting-capability')`
  ).run();
  return result.changes;
}

/**
 * Return queue status counts and active/pending item details.
 * Completed items are excluded from the items list; all actionable states remain visible.
 */
export function getQueueStatus(db: Database.Database = getDb()): QueueStatus {

  const counts = db.prepare(
    `SELECT
       SUM(CASE WHEN status = 'settling' THEN 1 ELSE 0 END) as settling,
       SUM(CASE WHEN status = 'awaiting-capability' THEN 1 ELSE 0 END) as awaiting_capability,
       SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
       SUM(CASE WHEN status = 'processing' THEN 1 ELSE 0 END) as processing,
       SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
       SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed
     FROM analysis_queue`
  ).get() as {
    settling: number | null;
    awaiting_capability: number | null;
    pending: number | null;
    processing: number | null;
    completed: number | null;
    failed: number | null;
  };

  const items = db.prepare(
    `SELECT * FROM analysis_queue
     WHERE status IN ('settling', 'awaiting-capability', 'pending', 'processing', 'failed')
     ORDER BY enqueued_at ASC`
  ).all() as QueueItem[];
  const latestAutomatic = (db.prepare(
    `SELECT * FROM analysis_queue WHERE runner_type = 'auto'
     ORDER BY enqueued_at DESC, generation DESC LIMIT 1`,
  ).get() as QueueItem | undefined) ?? null;

  return {
    settling: counts.settling ?? 0,
    awaitingCapability: counts.awaiting_capability ?? 0,
    pending: counts.pending ?? 0,
    processing: counts.processing ?? 0,
    completed: counts.completed ?? 0,
    failed: counts.failed ?? 0,
    items,
    latestAutomatic,
  };
}

/**
 * Remove completed and failed items older than the specified number of days.
 * Returns the number of rows deleted.
 */
export function pruneCompleted(olderThanDays = 7, db: Database.Database = getDb()): number {
  const result = db.prepare(
    `DELETE FROM analysis_queue
     WHERE status IN ('completed', 'failed')
       AND enqueued_at < datetime('now', ? || ' days')`
  ).run(`-${olderThanDays}`);
  return result.changes;
}
