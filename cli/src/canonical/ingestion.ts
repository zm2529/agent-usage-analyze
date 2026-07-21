import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';

export type SourceKind = 'synthetic-codex' | 'codex-rollout' | 'codex-hook' | 'git';
export type EraMode = 'historical-backfill' | 'continuous-observation';
export type EventActor = 'user' | 'assistant' | 'system' | 'tool' | 'subagent' | 'unknown';
export type Sensitivity = 'structural' | 'metadata' | 'sensitive-content';
export type CanonicalEventKind =
  | 'session-meta'
  | 'turn-context'
  | 'user-message'
  | 'assistant-message'
  | 'system-message'
  | 'tool-call'
  | 'tool-result'
  | 'thinking'
  | 'compaction'
  | 'task-started'
  | 'task-completed'
  | 'task-status'
  | 'subagent-spawned'
  | 'token-snapshot'
  | 'file-change'
  | 'unknown';

export interface SourceCursor {
  token: string;
  position: number;
}

export interface SourceArtifact {
  id: string;
  sourceKind: SourceKind;
  locatorHash: string;
  observedAt: string;
  contentHash?: string;
}

export interface ObservationEraSeed {
  id: string;
  name: string;
  mode: EraMode;
  parserVersion: string;
  capabilities: string[];
  startsAt: string;
  endsAt?: string;
}

export interface CanonicalEvent {
  id: string;
  nativeEventId: string;
  sequence: number;
  occurredAt: string;
  kind: CanonicalEventKind;
  actor: EventActor;
  sensitivity: Sensitivity;
  payload: Record<string, unknown>;
  parentEventId?: string;
  taskId?: string;
  threadId?: string;
  turnId?: string;
  attempt?: number;
  generation?: number;
  repository?: {
    root?: string;
    worktree?: string;
    branch?: string;
  };
  payloadRef?: string;
}

export interface IdentityEdge {
  kind: 'parent' | 'task-thread' | 'root-child' | 'turn-attempt';
  fromId: string;
  toId: string;
}

export interface IngestionDiagnostic {
  severity: 'info' | 'warning' | 'error';
  code: string;
  count: number;
  detail?: string;
}

export interface CoverageCounts {
  discovered: number;
  parsed: number;
  skipped: number;
  failed: number;
  unknown: number;
}

export interface CanonicalBatch {
  artifact: SourceArtifact;
  era: ObservationEraSeed;
  events: CanonicalEvent[];
  identityEdges: IdentityEdge[];
  diagnostics: IngestionDiagnostic[];
  coverage: CoverageCounts;
  previousCursor: SourceCursor | null;
  nextCursor: SourceCursor;
}

export interface SourceAdapter {
  readonly name: string;
  discover(): Promise<SourceArtifact[]>;
  parse(artifact: SourceArtifact, context: { currentCursor: SourceCursor | null }): Promise<CanonicalBatch>;
}

export interface IngestionSummary {
  runId: string;
  adapter: string;
  insertedEvents: number;
  advancedSources: number;
  coverage: CoverageCounts;
  status: 'completed' | 'completed-with-errors' | 'failed';
}

const EMPTY_COVERAGE: CoverageCounts = {
  discovered: 0,
  parsed: 0,
  skipped: 0,
  failed: 0,
  unknown: 0,
};

const EVENT_KINDS = new Set<CanonicalEventKind>([
  'session-meta', 'turn-context', 'user-message', 'assistant-message', 'system-message',
  'tool-call', 'tool-result', 'thinking', 'compaction', 'task-started', 'task-completed',
  'task-status', 'subagent-spawned', 'token-snapshot', 'file-change', 'unknown',
]);
const ACTORS = new Set<EventActor>(['user', 'assistant', 'system', 'tool', 'subagent', 'unknown']);
const SENSITIVITIES = new Set<Sensitivity>(['structural', 'metadata', 'sensitive-content']);
const SOURCE_KINDS = new Set<SourceKind>(['synthetic-codex', 'codex-rollout', 'codex-hook', 'git']);
const ERA_MODES = new Set<EraMode>(['historical-backfill', 'continuous-observation']);
const FORBIDDEN_ANALYSIS_KEY = /(analysis|score|rating|causal|effectiveness|confidence)/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function containsForbiddenAnalysisKey(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsForbiddenAnalysisKey);
  if (!isRecord(value)) return false;
  return Object.entries(value).some(
    ([key, child]) => FORBIDDEN_ANALYSIS_KEY.test(key) || containsForbiddenAnalysisKey(child),
  );
}

function containsRawContent(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsRawContent);
  if (typeof value === 'string') return value.length > 256 || value.includes('\n');
  if (!isRecord(value)) return false;
  return Object.values(value).some(containsRawContent);
}

function isCursor(value: unknown): value is SourceCursor {
  return isRecord(value)
    && typeof value.token === 'string'
    && typeof value.position === 'number'
    && Number.isSafeInteger(value.position)
    && value.position >= 0;
}

export function parseCanonicalBatch(value: unknown): CanonicalBatch {
  if (!isRecord(value) || !isRecord(value.artifact) || !isRecord(value.era)) {
    throw new Error('Canonical batch must contain artifact and era records');
  }
  if (!Array.isArray(value.events) || !Array.isArray(value.identityEdges)
      || !Array.isArray(value.diagnostics) || !isRecord(value.coverage)) {
    throw new Error('Canonical batch must contain events, identityEdges, diagnostics, and coverage');
  }
  if (!(value.previousCursor === null || isCursor(value.previousCursor)) || !isCursor(value.nextCursor)) {
    throw new Error('Canonical batch must contain valid previousCursor and nextCursor');
  }
  if (typeof value.artifact.id !== 'string'
      || !SOURCE_KINDS.has(value.artifact.sourceKind as SourceKind)
      || typeof value.artifact.locatorHash !== 'string'
      || typeof value.artifact.observedAt !== 'string') {
    throw new Error('Source artifact does not match the runtime schema');
  }
  if (typeof value.era.id !== 'string'
      || typeof value.era.name !== 'string'
      || !ERA_MODES.has(value.era.mode as EraMode)
      || typeof value.era.parserVersion !== 'string'
      || !Array.isArray(value.era.capabilities)
      || !value.era.capabilities.every((capability) => typeof capability === 'string')
      || typeof value.era.startsAt !== 'string') {
    throw new Error('Observation era does not match the runtime schema');
  }
  for (const key of ['discovered', 'parsed', 'skipped', 'failed', 'unknown']) {
    const count = value.coverage[key];
    if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0) {
      throw new Error('Coverage counts must be non-negative integers');
    }
  }
  for (const rawEvent of value.events) {
    if (!isRecord(rawEvent)
        || typeof rawEvent.id !== 'string'
        || typeof rawEvent.nativeEventId !== 'string'
        || typeof rawEvent.sequence !== 'number'
        || typeof rawEvent.occurredAt !== 'string'
        || !EVENT_KINDS.has(rawEvent.kind as CanonicalEventKind)
        || !ACTORS.has(rawEvent.actor as EventActor)
        || !SENSITIVITIES.has(rawEvent.sensitivity as Sensitivity)
        || !isRecord(rawEvent.payload)) {
      throw new Error('Canonical event does not match the closed runtime schema');
    }
    if (containsForbiddenAnalysisKey(rawEvent.payload)) {
      throw new Error('Canonical payload cannot contain analysis or causal fields');
    }
    if ((rawEvent.sensitivity === 'sensitive-content' && Object.keys(rawEvent.payload).length > 0)
        || containsRawContent(rawEvent.payload)) {
      throw new Error('Canonical payload cannot contain raw sensitive content; use payloadRef');
    }
    if (rawEvent.sensitivity === 'sensitive-content'
        && (typeof rawEvent.payloadRef !== 'string' || rawEvent.payloadRef.length === 0)) {
      throw new Error('Sensitive canonical events require a payloadRef');
    }
  }
  for (const edge of value.identityEdges) {
    if (!isRecord(edge)
        || !['parent', 'task-thread', 'root-child', 'turn-attempt'].includes(String(edge.kind))
        || typeof edge.fromId !== 'string'
        || typeof edge.toId !== 'string') {
      throw new Error('Identity edge does not match the runtime schema');
    }
  }
  return value as unknown as CanonicalBatch;
}

function cursorsEqual(left: SourceCursor | null, right: SourceCursor | null): boolean {
  if (left === null || right === null) return left === right;
  return left.token === right.token && left.position === right.position;
}

export async function ingestSourceAdapter(
  adapter: SourceAdapter,
  db: Database.Database,
): Promise<IngestionSummary> {
  const runId = `ingestion:${randomUUID()}`;
  const startedAt = new Date().toISOString();
  const artifacts = await adapter.discover();
  const coverage = { ...EMPTY_COVERAGE, discovered: artifacts.length };
  let insertedEvents = 0;
  let advancedSources = 0;
  let status: IngestionSummary['status'] = 'completed';

  db.prepare(`
    INSERT INTO ingestion_runs (
      id, adapter_name, started_at, status, discovered_count,
      parsed_count, skipped_count, failed_count, unknown_count
    ) VALUES (?, ?, ?, 'running', ?, 0, 0, 0, 0)
  `).run(runId, adapter.name, startedAt, artifacts.length);

  try {
    for (const artifact of artifacts) {
      let batch: CanonicalBatch;
      const storedSource = db.prepare(`
        SELECT cursor AS token, cursor_position AS position,
               locator_hash AS locatorHash, content_hash AS contentHash
        FROM source_artifacts WHERE id = ?
      `).get(artifact.id) as ({
        token: string | null;
        position: number;
        locatorHash: string;
        contentHash: string | null;
      }) | undefined;
      if (storedSource && (
        storedSource.locatorHash !== artifact.locatorHash
        || storedSource.contentHash !== (artifact.contentHash ?? null)
      )) {
        throw new Error('Immutable source identity conflicts with changed locator or content hash');
      }
      const currentCursor = storedSource?.token
        ? { token: storedSource.token, position: storedSource.position }
        : null;
      try {
        batch = parseCanonicalBatch(await adapter.parse(artifact, { currentCursor }));
        if (batch.artifact.id !== artifact.id
            || batch.artifact.sourceKind !== artifact.sourceKind
            || batch.artifact.locatorHash !== artifact.locatorHash
            || (batch.artifact.contentHash ?? null) !== (artifact.contentHash ?? null)) {
          throw new Error('Canonical batch artifact does not match the discovered source');
        }
        if (!cursorsEqual(batch.previousCursor, currentCursor)) {
          throw new Error('Stale source cursor: batch was parsed from an outdated source position');
        }
        if (batch.nextCursor.position < (currentCursor?.position ?? 0)) {
          throw new Error('Stale source cursor: next position would move backwards');
        }
      } catch (error) {
        coverage.failed += 1;
        db.prepare(`
          INSERT INTO ingestion_diagnostics (run_id, severity, code, count, detail)
          VALUES (?, 'error', 'adapter-parse-failed', 1, ?)
        `).run(runId, null);
        if (error instanceof Error && (
          error.message.includes('Stale source cursor')
          || error.message.includes('Canonical')
        )) {
          throw error;
        }
        continue;
      }

      const writeBatch = db.transaction(() => {
        db.prepare(`
          INSERT INTO observation_eras (
            id, name, mode, parser_version, capabilities_json, starts_at, ends_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            name = excluded.name,
            ends_at = COALESCE(excluded.ends_at, observation_eras.ends_at)
        `).run(
          batch.era.id,
          batch.era.name,
          batch.era.mode,
          batch.era.parserVersion,
          JSON.stringify(batch.era.capabilities),
          batch.era.startsAt,
          batch.era.endsAt ?? null,
        );

        db.prepare(`
          INSERT INTO source_artifacts (
            id, source_kind, locator_hash, observed_at, content_hash, cursor, cursor_position, era_id
          ) VALUES (?, ?, ?, ?, ?, NULL, 0, ?)
          ON CONFLICT(id) DO NOTHING
        `).run(
          artifact.id,
          artifact.sourceKind,
          artifact.locatorHash,
          artifact.observedAt,
          artifact.contentHash ?? null,
          batch.era.id,
        );

        const insertEvent = db.prepare(`
          INSERT OR IGNORE INTO canonical_events (
            id, source_artifact_id, era_id, native_event_id, sequence,
            occurred_at, kind, actor, sensitivity, payload_json,
            parent_event_id, task_id, thread_id, turn_id, attempt, generation,
            parser_version, repo_root, worktree_path, git_branch, payload_ref
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        for (const event of batch.events) {
          const result = insertEvent.run(
            event.id,
            artifact.id,
            batch.era.id,
            event.nativeEventId,
            event.sequence,
            event.occurredAt,
            event.kind,
            event.actor,
            event.sensitivity,
            JSON.stringify(event.payload),
            event.parentEventId ?? null,
            event.taskId ?? null,
            event.threadId ?? null,
            event.turnId ?? null,
            event.attempt ?? null,
            event.generation ?? null,
            batch.era.parserVersion,
            event.repository?.root ?? null,
            event.repository?.worktree ?? null,
            event.repository?.branch ?? null,
            event.payloadRef ?? null,
          );
          insertedEvents += result.changes;
        }

        const insertIdentityEdge = db.prepare(`
          INSERT OR IGNORE INTO canonical_identity_edges (
            source_artifact_id, kind, from_id, to_id
          ) VALUES (?, ?, ?, ?)
        `);
        for (const edge of batch.identityEdges) {
          insertIdentityEdge.run(artifact.id, edge.kind, edge.fromId, edge.toId);
        }

        const insertDiagnostic = db.prepare(`
          INSERT INTO ingestion_diagnostics (run_id, severity, code, count, detail)
          VALUES (?, ?, ?, ?, ?)
        `);
        for (const diagnostic of batch.diagnostics) {
          insertDiagnostic.run(
            runId,
            diagnostic.severity,
            diagnostic.code,
            diagnostic.count,
            null,
          );
        }

        const cursorUpdate = db.prepare(`
          UPDATE source_artifacts
          SET cursor = ?, cursor_position = ?, updated_at = datetime('now')
          WHERE id = ? AND cursor IS ? AND cursor_position = ?
        `).run(
          batch.nextCursor.token,
          batch.nextCursor.position,
          artifact.id,
          batch.previousCursor?.token ?? null,
          batch.previousCursor?.position ?? 0,
        );
        if (cursorUpdate.changes !== 1) {
          throw new Error('Stale source cursor: compare-and-swap failed');
        }
      });

      writeBatch();
      advancedSources += 1;
      coverage.parsed += batch.coverage.parsed;
      coverage.skipped += batch.coverage.skipped;
      coverage.failed += batch.coverage.failed;
      coverage.unknown += batch.coverage.unknown;
    }

    status = coverage.failed > 0
      ? (coverage.parsed > 0 ? 'completed-with-errors' : 'failed')
      : 'completed';
    db.prepare(`
      UPDATE ingestion_runs SET
        completed_at = ?, status = ?, inserted_event_count = ?,
        parsed_count = ?, skipped_count = ?, failed_count = ?, unknown_count = ?
      WHERE id = ?
    `).run(
      new Date().toISOString(),
      status,
      insertedEvents,
      coverage.parsed,
      coverage.skipped,
      coverage.failed,
      coverage.unknown,
      runId,
    );
  } catch (error) {
    db.prepare(`
      UPDATE ingestion_runs SET completed_at = ?, status = 'failed', failed_count = failed_count + 1
      WHERE id = ?
    `).run(new Date().toISOString(), runId);
    db.prepare(`
      INSERT INTO ingestion_diagnostics (run_id, severity, code, count, detail)
      VALUES (?, 'error', 'ingestion-failed', 1, ?)
    `).run(runId, null);
    throw error;
  }

  return { runId, adapter: adapter.name, insertedEvents, advancedSources, coverage, status };
}

export interface IngestionHealth {
  status: 'never-run' | 'running' | 'completed' | 'completed-with-errors' | 'failed';
  diagnostics: Array<{ severity: string; code: string; count: number }>;
  coverage: CoverageCounts;
  eventCount: number;
  sourceCount: number;
  eras: Array<{ id: string; mode: EraMode; parserVersion: string }>;
}

export function readIngestionHealth(db: Database.Database): IngestionHealth {
  const latestRun = db.prepare(`
    SELECT id, status, discovered_count AS discovered, parsed_count AS parsed,
           skipped_count AS skipped, failed_count AS failed, unknown_count AS unknown
    FROM ingestion_runs
    ORDER BY started_at DESC, rowid DESC
    LIMIT 1
  `).get() as (CoverageCounts & { id: string; status: IngestionHealth['status'] }) | undefined;
  const eventCount = db.prepare('SELECT COUNT(*) AS count FROM canonical_events').get() as { count: number };
  const sourceCount = db.prepare('SELECT COUNT(*) AS count FROM source_artifacts').get() as { count: number };
  const eras = db.prepare(`
    SELECT id, mode, parser_version AS parserVersion
    FROM observation_eras
    ORDER BY starts_at ASC, id ASC
  `).all() as Array<{ id: string; mode: EraMode; parserVersion: string }>;
  const diagnostics = latestRun
    ? db.prepare(`
        SELECT severity, code, SUM(count) AS count
        FROM ingestion_diagnostics WHERE run_id = ?
        GROUP BY severity, code ORDER BY severity, code
      `).all(latestRun.id) as IngestionHealth['diagnostics']
    : [];

  return {
    status: latestRun?.status ?? 'never-run',
    diagnostics,
    coverage: latestRun
      ? {
          discovered: latestRun.discovered,
          parsed: latestRun.parsed,
          skipped: latestRun.skipped,
          failed: latestRun.failed,
          unknown: latestRun.unknown,
        }
      : { ...EMPTY_COVERAGE },
    eventCount: eventCount.count,
    sourceCount: sourceCount.count,
    eras,
  };
}
