import type Database from 'better-sqlite3';

export interface SettledTurnEvent {
  source: string;
  sessionId: string;
  turnId: string;
  locator?: string;
  basis?: string;
}

export interface SettledFrontier {
  source: string;
  sessionId: string;
  latestTurnId: string;
  generation: number;
  status: string;
  notBefore: string;
}

interface FrontierRow {
  source_tool: string;
  session_id: string;
  latest_turn_id: string;
  generation: number;
  status: string;
  not_before: string;
}

function toFrontier(row: FrontierRow): SettledFrontier {
  return {
    source: row.source_tool,
    sessionId: row.session_id,
    latestTurnId: row.latest_turn_id,
    generation: row.generation,
    status: row.status,
    notBefore: row.not_before,
  };
}

/**
 * Record the latest completed turn without importing or analyzing inside the Hook.
 * Repeated delivery of one turn is idempotent; a new turn advances the generation
 * and pushes the session's settled-analysis deadline forward.
 */
export function recordSettledFrontier(
  db: Database.Database,
  event: SettledTurnEvent,
  now: Date,
  idleSeconds: number,
): SettledFrontier {
  const notBefore = new Date(now.getTime() + idleSeconds * 1_000).toISOString();
  const enqueuedAt = now.toISOString();
  const sourceBasis = event.basis ?? '';

  return db.transaction(() => {
    const firstDelivery = db.prepare(
      `INSERT OR IGNORE INTO analysis_frontier_events
         (source_tool, session_id, turn_id, source_basis, observed_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(event.source, event.sessionId, event.turnId, sourceBasis, enqueuedAt);

    if (firstDelivery.changes === 0) {
      const replayed = db.prepare(
        `SELECT source_tool, session_id, latest_turn_id, generation, status, not_before
         FROM analysis_queue WHERE source_tool = ? AND session_id = ?`,
      ).get(event.source, event.sessionId) as FrontierRow | undefined;
      if (!replayed) throw new Error('Frontier event exists without its queue row');
      return toFrontier(replayed);
    }

    const changed = db.prepare(
    `INSERT INTO analysis_queue (
       source_tool, session_id, status, runner_type, latest_turn_id, generation,
       transcript_locator, source_basis, not_before, diagnostic, enqueued_at,
       started_at, completed_at, error_message, attempt_count, max_attempts
     ) VALUES (?, ?, 'settling', 'auto', ?, ?, ?, ?, ?, NULL, ?, NULL, NULL, NULL, 0, 3)
     ON CONFLICT(source_tool, session_id) DO UPDATE SET
       status = 'settling',
       runner_type = 'auto',
       latest_turn_id = excluded.latest_turn_id,
       generation = analysis_queue.generation + 1,
       transcript_locator = COALESCE(excluded.transcript_locator, analysis_queue.transcript_locator),
       source_basis = COALESCE(excluded.source_basis, analysis_queue.source_basis),
       not_before = excluded.not_before,
       diagnostic = NULL,
       enqueued_at = excluded.enqueued_at,
       started_at = NULL,
       completed_at = NULL,
       error_message = NULL,
       attempt_count = 0
     WHERE analysis_queue.latest_turn_id IS NOT excluded.latest_turn_id
        OR analysis_queue.source_basis IS NOT excluded.source_basis
     RETURNING source_tool, session_id, latest_turn_id, generation, status, not_before`,
  ).get(
    event.source,
    event.sessionId,
    event.turnId,
    1,
    event.locator ?? null,
    sourceBasis,
    notBefore,
    enqueuedAt,
    ) as FrontierRow | undefined;

    if (changed) return toFrontier(changed);

    const existing = db.prepare(
      `SELECT source_tool, session_id, latest_turn_id, generation, status, not_before
       FROM analysis_queue WHERE source_tool = ? AND session_id = ?`,
    ).get(event.source, event.sessionId) as FrontierRow | undefined;
    if (!existing) throw new Error('Settled frontier upsert did not return or persist a row');

    return toFrontier(existing);
  })();
}
