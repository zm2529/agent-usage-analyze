import { homedir } from 'os';
import { join } from 'path';
import { statSync } from 'fs';
import type Database from 'better-sqlite3';
import { CodexRolloutAdapter } from '../canonical/codex-rollout.js';
import { ingestSourceAdapter } from '../canonical/ingestion.js';
import {
  invalidateCompatibilityProjection,
  prepareSingleFileProjection,
  type PreparedSingleFileProjection,
} from '../commands/sync.js';
import { loadConfig } from '../utils/config.js';
import {
  resolveAnalysisExecutionPolicy,
  type AnalysisExecutionState,
} from './execution-policy.js';
import {
  codexRolloutContentBasis,
  locateCodexRollout,
  type CodexRolloutLocation,
} from './codex-source-locator.js';
import { recordIngestionLog } from './ingestion-log.js';

// Large active rollouts can contain repeated compacted/forked history. Rebuilding
// the legacy message projection for them on every append can hold SQLite for
// minutes. The canonical event projection still advances; the full legacy
// projection is left to the explicit history sync.
const LIVE_PROJECTION_MAX_BYTES = 8 * 1024 * 1024;

export interface ClaimedSettledImport {
  sourceTool: string;
  sessionId: string;
  generation: number;
  locator: string | null;
  sourceBasis: string | null;
}

export interface SettledImportDependencies {
  now(): Date;
  idleSeconds: number;
  locate(claimed: ClaimedSettledImport): CodexRolloutLocation;
  contentBasis(path: string): string;
  ingest(path: string): Promise<{ complete: boolean; diagnostic: string | null }>;
  prepareProjection(path: string): Promise<PreparedSingleFileProjection>;
  invalidateProjection(): void;
  execution: Pick<AnalysisExecutionState, 'effectiveRunner' | 'reason' | 'model'>;
}

export interface SettledImportResult {
  status: 'completed' | 'analysis-ready' | 'awaiting-capability' | 'settling' | 'stale';
  diagnostic: string | null;
}

function guardedUpdate(
  db: Database.Database,
  claimed: ClaimedSettledImport,
  assignments: string,
  values: unknown[],
): boolean {
  return db.prepare(
    `UPDATE analysis_queue SET ${assignments}
     WHERE source_tool = ? AND session_id = ? AND generation = ? AND status = 'processing'`,
  ).run(...values, claimed.sourceTool, claimed.sessionId, claimed.generation).changes === 1;
}

function stale(): SettledImportResult {
  return { status: 'stale', diagnostic: null };
}

function combinedDiagnostic(...parts: Array<string | null | undefined>): string {
  return parts.filter((part): part is string => Boolean(part)).join(';');
}

function resettleUnavailable(
  db: Database.Database,
  claimed: ClaimedSettledImport,
  deps: SettledImportDependencies,
  diagnostic: string,
): SettledImportResult {
  let result: SettledImportResult = stale();
  db.transaction(() => {
    const current = db.prepare(
      `SELECT attempt_count, max_attempts FROM analysis_queue
       WHERE source_tool = ? AND session_id = ? AND generation = ? AND status = 'processing'`,
    ).get(claimed.sourceTool, claimed.sessionId, claimed.generation) as {
      attempt_count: number; max_attempts: number;
    } | undefined;
    if (!current) return;
    const nextAttempt = current.attempt_count + 1;
    const terminal = nextAttempt >= current.max_attempts;
    const delaySeconds = Math.min(3_600, deps.idleSeconds * (2 ** Math.max(0, nextAttempt - 1)));
    const notBefore = new Date(deps.now().getTime() + delaySeconds * 1_000).toISOString();
    deps.invalidateProjection();
    db.prepare(
      `UPDATE analysis_queue
       SET status = ?, attempt_count = ?, not_before = ?, diagnostic = ?, started_at = NULL
       WHERE source_tool = ? AND session_id = ? AND generation = ? AND status = 'processing'`,
    ).run(
      terminal ? 'awaiting-capability' : 'settling', nextAttempt, notBefore, diagnostic,
      claimed.sourceTool, claimed.sessionId, claimed.generation,
    );
    result = { status: terminal ? 'awaiting-capability' : 'settling', diagnostic };
  }).immediate();
  return result;
}

function resettleGrowth(
  db: Database.Database,
  claimed: ClaimedSettledImport,
  deps: SettledImportDependencies,
  basisBefore: string,
  basisAfter: string,
): SettledImportResult {
  const changed = db.transaction(() => {
    const current = db.prepare(
      `SELECT attempt_count AS attemptCount FROM analysis_queue
       WHERE source_tool = ? AND session_id = ? AND generation = ?
         AND status = 'processing' AND source_basis = ?`,
    ).get(claimed.sourceTool, claimed.sessionId, claimed.generation, basisBefore) as {
      attemptCount: number;
    } | undefined;
    if (!current) return false;
    // A source that repeatedly grows during a costly import must not restart at
    // the same cadence forever. A genuine new Hook frontier resets this counter.
    const growthAttempt = Math.min(5, current.attemptCount + 1);
    const delaySeconds = deps.idleSeconds * (2 ** Math.max(0, growthAttempt - 1));
    const notBefore = new Date(deps.now().getTime() + delaySeconds * 1_000).toISOString();
    deps.invalidateProjection();
    return db.prepare(
      `UPDATE analysis_queue
       SET status = 'settling', generation = generation + 1, source_basis = ?,
           not_before = ?, diagnostic = 'source-grew-during-import', started_at = NULL,
           attempt_count = ?, error_message = NULL
       WHERE source_tool = ? AND session_id = ? AND generation = ?
         AND status = 'processing' AND source_basis = ?`,
    ).run(
      basisAfter, notBefore, growthAttempt,
      claimed.sourceTool, claimed.sessionId, claimed.generation, basisBefore,
    ).changes === 1;
  }).immediate();
  return changed
    ? { status: 'settling', diagnostic: 'source-grew-during-import' }
    : stale();
}

function resettleActiveLargeSource(
  db: Database.Database,
  claimed: ClaimedSettledImport,
  deps: SettledImportDependencies,
  sourceBasis: string,
): SettledImportResult {
  const quietSeconds = Math.max(90, deps.idleSeconds);
  const notBefore = new Date(deps.now().getTime() + quietSeconds * 1_000).toISOString();
  const changed = db.prepare(
    `UPDATE analysis_queue
     SET status = 'settling', generation = generation + 1, not_before = ?,
         diagnostic = 'large-source-still-active', started_at = NULL,
         attempt_count = 0, error_message = NULL
     WHERE source_tool = ? AND session_id = ? AND generation = ?
       AND status = 'processing' AND source_basis = ?`,
  ).run(
    notBefore, claimed.sourceTool, claimed.sessionId, claimed.generation, sourceBasis,
  ).changes === 1;
  return changed
    ? { status: 'settling', diagnostic: 'large-source-still-active' }
    : stale();
}

function invalidateForNewerFrontier(
  db: Database.Database,
  claimed: ClaimedSettledImport,
  deps: SettledImportDependencies,
): void {
  db.transaction(() => {
    const newer = db.prepare(
      `SELECT 1 FROM analysis_queue
       WHERE source_tool = ? AND session_id = ? AND generation > ? AND status = 'settling'`,
    ).get(claimed.sourceTool, claimed.sessionId, claimed.generation);
    if (newer) deps.invalidateProjection();
  }).immediate();
}

class SourceGrewDuringProjectionCommit extends Error {
  constructor(readonly basis: string) {
    super('Source grew during compatibility projection commit');
  }
}

/**
 * Import one claimed settled frontier. Every terminal write is generation
 * guarded so a Stop event arriving during I/O always wins.
 */
export async function processSettledImport(
  db: Database.Database,
  claimed: ClaimedSettledImport,
  deps: SettledImportDependencies,
): Promise<SettledImportResult> {
  const location = deps.locate(claimed);
  if (!location.path) {
    const diagnostic = location.diagnostic ?? 'source-not-found';
    return resettleUnavailable(db, claimed, deps, diagnostic);
  }
  const sourcePath = location.path;

  const basisBefore = deps.contentBasis(sourcePath);
  if (!guardedUpdate(db, claimed, 'source_basis = ?, diagnostic = NULL', [basisBefore])) return stale();
  try {
    const source = statSync(sourcePath);
    const quietSeconds = Math.max(90, deps.idleSeconds);
    if (source.size > LIVE_PROJECTION_MAX_BYTES
      && deps.now().getTime() - source.mtimeMs < quietSeconds * 1_000) {
      return resettleActiveLargeSource(db, claimed, deps, basisBefore);
    }
  } catch {
    // The locator and canonical importer provide the authoritative missing-file diagnostic.
  }

  const imported = await deps.ingest(sourcePath);
  const current = db.prepare(
    `SELECT 1 FROM analysis_queue
     WHERE source_tool = ? AND session_id = ? AND generation = ? AND status = 'processing'
       AND source_basis = ?`,
  ).get(claimed.sourceTool, claimed.sessionId, claimed.generation, basisBefore);
  if (!current) {
    invalidateForNewerFrontier(db, claimed, deps);
    return stale();
  }

  if (!imported.complete) {
    const diagnostic = imported.diagnostic ?? 'canonical-import-incomplete';
    return resettleUnavailable(db, claimed, deps, diagnostic);
  }

  const projection = await deps.prepareProjection(sourcePath);
  const basisAfter = deps.contentBasis(sourcePath);
  if (basisAfter !== basisBefore) {
    return resettleGrowth(db, claimed, deps, basisBefore, basisAfter);
  }
  if (!projection.complete) {
    const diagnostic = combinedDiagnostic(location.diagnostic, projection.diagnostic)
      || 'compatibility-projection-unavailable';
    return resettleUnavailable(db, claimed, deps, diagnostic);
  }

  const terminalStatus = deps.execution.effectiveRunner === 'local-only' || deps.execution.effectiveRunner === 'off'
    ? 'completed'
    : 'awaiting-capability';
  const terminalDiagnostic = combinedDiagnostic(location.diagnostic, deps.execution.reason);
  let result: SettledImportResult = stale();
  try {
    db.transaction(() => {
      const current = db.prepare(
        `SELECT 1 FROM analysis_queue
         WHERE source_tool = ? AND session_id = ? AND generation = ? AND status = 'processing'
           AND source_basis = ?`,
      ).get(claimed.sourceTool, claimed.sessionId, claimed.generation, basisBefore);
      if (!current) return;

      projection.commit();
      const commitBasis = deps.contentBasis(sourcePath);
      if (commitBasis !== basisBefore) throw new SourceGrewDuringProjectionCommit(commitBasis);
      const completedAt = terminalStatus === 'completed' ? deps.now().toISOString() : null;
      db.prepare(
        `UPDATE analysis_queue SET status = ?, diagnostic = ?, completed_at = ?, started_at = NULL
         WHERE source_tool = ? AND session_id = ? AND generation = ? AND status = 'processing'`,
      ).run(
        terminalStatus, terminalDiagnostic, completedAt,
        claimed.sourceTool, claimed.sessionId, claimed.generation,
      );
      result = {
        status: terminalStatus === 'awaiting-capability' ? 'analysis-ready' : terminalStatus,
        diagnostic: terminalDiagnostic,
      };
    }).immediate();
  } catch (error) {
    if (error instanceof SourceGrewDuringProjectionCommit) {
      return resettleGrowth(db, claimed, deps, basisBefore, error.basis);
    }
    throw error;
  }
  if (result.status === 'stale') invalidateForNewerFrontier(db, claimed, deps);
  return result;
}

function codexHome(): string {
  return process.env.AGENT_ANALYTICS_CODEX_HOME
    ?? process.env.CODEX_HOME
    ?? join(homedir(), '.codex');
}

export function defaultSettledImportDependencies(
  db: Database.Database,
  idleSeconds: number,
  sessionId?: string,
): SettledImportDependencies {
  const config = loadConfig();
  const policy = resolveAnalysisExecutionPolicy(config);
  const execution = config?.dashboard?.capabilities?.sessionLlmAnalysis === false
    ? { effectiveRunner: 'local-only' as const, reason: 'session-llm-analysis-disabled', model: undefined }
    : policy;
  return {
    now: () => new Date(),
    idleSeconds,
    locate: (claimed) => locateCodexRollout({
      codexHome: codexHome(),
      sessionId: claimed.sessionId,
      locator: claimed.locator,
    }),
    contentBasis: codexRolloutContentBasis,
    ingest: async (path) => {
      const summary = await ingestSourceAdapter(new CodexRolloutAdapter(codexHome(), [path]), db);
      const diagnostics = db.prepare(
        `SELECT severity, code FROM ingestion_diagnostics WHERE run_id = ?`,
      ).all(summary.runId) as Array<{ severity: string; code: string }>;
      const incomplete = diagnostics.find((item) => item.code === 'truncated-tail')
        ?? diagnostics.find((item) => item.severity === 'error');
      const complete = summary.status === 'completed'
        && summary.coverage.discovered === 1
        && summary.coverage.failed === 0
        && !incomplete;
      return {
        complete,
        diagnostic: complete ? null : incomplete?.code ?? `canonical-import-${summary.status}`,
      };
    },
    prepareProjection: async (path) => {
      const sizeBytes = statSync(path).size;
      const existing = sessionId
        ? db.prepare('SELECT 1 FROM sessions WHERE id = ?').get(`codex:${sessionId}`)
        : null;
      if (sizeBytes > LIVE_PROJECTION_MAX_BYTES && existing) {
        recordIngestionLog({
          stage: 'projection', outcome: 'deferred-large-existing-session',
          sessionId, sourcePath: path, sizeBytes,
        });
        return { complete: true, diagnostic: 'large-source-projection-deferred', commit() {} };
      }
      return prepareSingleFileProjection({
        filePath: path,
        sourceTool: 'codex-cli',
        replace: true,
        ...(sessionId ? { replaceSessionId: `codex:${sessionId}` } : {}),
        quiet: true,
      });
    },
    invalidateProjection: () => {
      if (sessionId) invalidateCompatibilityProjection(`codex:${sessionId}`);
    },
    execution,
  };
}
