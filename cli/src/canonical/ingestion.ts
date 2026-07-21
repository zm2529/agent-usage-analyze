import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { rebuildTaskProjection } from './tasks.js';
import { IdentityConflictError } from './tasks.js';

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
  parserVersion: string;
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

interface CanonicalEventBase {
  id: string;
  nativeEventId: string;
  sequence: number;
  occurredAt: string;
  actor: EventActor;
  sensitivity: Sensitivity;
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

export interface CanonicalEventPayloads {
  'session-meta': { originator?: string; source?: string; model?: string; cliVersion?: string; taskRole?: 'root' | 'subagent' | 'reviewer' | 'worker' | 'unknown' };
  'turn-context': { model?: string; effort?: string; sandbox?: string; approvalPolicy?: string };
  'user-message': Record<string, never>;
  'assistant-message': Record<string, never>;
  'system-message': Record<string, never>;
  'tool-call': { toolName?: string; callId?: string };
  'tool-result': { callId?: string; status?: 'completed' | 'failed' | 'cancelled' | 'unknown' };
  thinking: Record<string, never>;
  compaction: { trigger?: 'automatic' | 'manual' | 'unknown' };
  'task-started': { status?: 'started' | 'running' };
  'task-completed': { status?: 'completed' | 'failed' | 'cancelled' | 'aborted'; reason?: 'normal' | 'user-cancelled' | 'tool-error' | 'turn-aborted' | 'unknown' };
  'task-status': { status?: 'started' | 'running' | 'completed' | 'failed' | 'cancelled' | 'aborted' | 'unknown'; reason?: 'normal' | 'user-cancelled' | 'tool-error' | 'turn-aborted' | 'unknown' };
  'subagent-spawned': { agentRole?: 'subagent' | 'reviewer' | 'worker' | 'unknown'; status?: 'started' | 'running' | 'completed' | 'failed' | 'cancelled' | 'unknown' };
  'token-snapshot': { inputTokens?: number; cachedInputTokens?: number; cacheCreationTokens?: number; outputTokens?: number; reasoningTokens?: number; compactionTokens?: number };
  'file-change': { changeType?: 'added' | 'modified' | 'deleted' | 'renamed' | 'unknown'; pathHash?: string };
  unknown: { envelopeType?: string };
}

export type CanonicalEvent = {
  [K in CanonicalEventKind]: CanonicalEventBase & { kind: K; payload: CanonicalEventPayloads[K] }
}[CanonicalEventKind];

export interface IdentityEdge {
  kind: 'parent' | 'task-thread' | 'root-child' | 'turn-attempt';
  fromId: string;
  toId: string;
}

export type IngestionDiagnosticCode =
  | 'fixture'
  | 'adapter-parse-failed'
  | 'ingestion-failed'
  | 'unknown-envelope'
  | 'truncated-tail'
  | 'rewritten-source'
  | 'token-reset'
  | 'token-out-of-order'
  | 'identity-conflict'
  | 'malformed-record';

export interface IngestionDiagnostic {
  severity: 'info' | 'warning' | 'error';
  code: IngestionDiagnosticCode;
  count: number;
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
  operation?: 'append' | 'rebuild';
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
type PayloadValueKind = 'string' | 'number' | 'boolean';

const EVENT_PAYLOAD_FIELDS: Record<CanonicalEventKind, Record<string, PayloadValueKind>> = {
  'session-meta': { originator: 'string', source: 'string', model: 'string', cliVersion: 'string', taskRole: 'string' },
  'turn-context': { model: 'string', effort: 'string', sandbox: 'string', approvalPolicy: 'string' },
  'user-message': {},
  'assistant-message': {},
  'system-message': {},
  'tool-call': { toolName: 'string', callId: 'string' },
  'tool-result': { callId: 'string', status: 'string' },
  thinking: {},
  compaction: { trigger: 'string' },
  'task-started': { status: 'string' },
  'task-completed': { status: 'string', reason: 'string' },
  'task-status': { status: 'string', reason: 'string' },
  'subagent-spawned': { agentRole: 'string', status: 'string' },
  'token-snapshot': {
    inputTokens: 'number', cachedInputTokens: 'number', cacheCreationTokens: 'number',
    outputTokens: 'number', reasoningTokens: 'number', compactionTokens: 'number',
  },
  'file-change': { changeType: 'string', pathHash: 'string' },
  unknown: { envelopeType: 'string' },
};
const PAYLOAD_STRING_VALUES: Partial<Record<CanonicalEventKind, Record<string, ReadonlySet<string>>>> = {
  'session-meta': { taskRole: new Set(['root', 'subagent', 'reviewer', 'worker', 'unknown']) },
  'tool-result': { status: new Set(['completed', 'failed', 'cancelled', 'unknown']) },
  compaction: { trigger: new Set(['automatic', 'manual', 'unknown']) },
  'task-started': { status: new Set(['started', 'running']) },
  'task-completed': {
    status: new Set(['completed', 'failed', 'cancelled', 'aborted']),
    reason: new Set(['normal', 'user-cancelled', 'tool-error', 'turn-aborted', 'unknown']),
  },
  'task-status': {
    status: new Set(['started', 'running', 'completed', 'failed', 'cancelled', 'aborted', 'unknown']),
    reason: new Set(['normal', 'user-cancelled', 'tool-error', 'turn-aborted', 'unknown']),
  },
  'subagent-spawned': {
    agentRole: new Set(['subagent', 'reviewer', 'worker', 'unknown']),
    status: new Set(['started', 'running', 'completed', 'failed', 'cancelled', 'unknown']),
  },
  'file-change': { changeType: new Set(['added', 'modified', 'deleted', 'renamed', 'unknown']) },
};
const FORBIDDEN_ANALYSIS_KEY = /(analysis|score|rating|claim|causal|effectiveness|confidence)/i;
const OPAQUE_PAYLOAD_REF = /^source:[A-Za-z0-9._:-]+(?:#[A-Za-z0-9._:=-]+)?$/;
const DIAGNOSTIC_CODES = new Set<IngestionDiagnosticCode>([
  'fixture', 'adapter-parse-failed', 'ingestion-failed', 'unknown-envelope',
  'truncated-tail', 'rewritten-source', 'token-reset', 'token-out-of-order',
  'identity-conflict',
  'malformed-record',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertOnlyKeys(value: Record<string, unknown>, allowed: readonly string[], label: string): void {
  const unexpected = Object.keys(value).find((key) => !allowed.includes(key));
  if (unexpected) throw new Error(`${label} contains unsupported field: ${unexpected}`);
}

function isOptionalString(value: unknown): boolean {
  return value === undefined || typeof value === 'string';
}

function isOptionalNonNegativeInteger(value: unknown): boolean {
  return value === undefined
    || (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0);
}

function validatePayload(kind: CanonicalEventKind, payload: Record<string, unknown>): void {
  const schema = EVENT_PAYLOAD_FIELDS[kind];
  if (Object.keys(payload).some((key) => FORBIDDEN_ANALYSIS_KEY.test(key))) {
    throw new Error('Canonical payload cannot contain analysis or causal fields');
  }
  assertOnlyKeys(payload, Object.keys(schema), `Canonical ${kind} payload`);
  for (const [key, value] of Object.entries(payload)) {
    const expected = schema[key];
    if (typeof value !== expected) throw new Error(`Canonical ${kind} payload field ${key} must be ${expected}`);
    if (typeof value === 'string' && (value.length > 256 || value.includes('\n'))) {
      throw new Error(`Canonical ${kind} payload cannot contain raw content`);
    }
    const allowedValues = PAYLOAD_STRING_VALUES[kind]?.[key];
    if (allowedValues && typeof value === 'string' && !allowedValues.has(value)) {
      throw new Error(`Canonical ${kind} payload field ${key} is not an allowed structural value`);
    }
    if (typeof value === 'number' && (!Number.isSafeInteger(value) || value < 0)) {
      throw new Error(`Canonical ${kind} payload counters must be non-negative integers`);
    }
  }
}

function isCursor(value: unknown): value is SourceCursor {
  return isRecord(value)
    && typeof value.token === 'string'
    && value.token.length > 0
    && typeof value.position === 'number'
    && Number.isSafeInteger(value.position)
    && value.position >= 0;
}

export class CanonicalBatchValidationError extends Error {
  override readonly name = 'CanonicalBatchValidationError';
}

function parseCanonicalBatchValue(value: unknown): CanonicalBatch {
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
  if (value.previousCursor) {
    assertOnlyKeys(value.previousCursor as unknown as Record<string, unknown>, ['token', 'position'], 'Previous cursor');
  }
  assertOnlyKeys(value.nextCursor as unknown as Record<string, unknown>, ['token', 'position'], 'Next cursor');
  assertOnlyKeys(value, [
    'artifact', 'era', 'events', 'identityEdges', 'diagnostics', 'coverage',
    'previousCursor', 'nextCursor', 'operation',
  ], 'Canonical batch');
  if (value.operation !== undefined && !['append', 'rebuild'].includes(String(value.operation))) {
    throw new Error('Canonical batch operation must be append or rebuild');
  }
  assertOnlyKeys(value.artifact, [
    'id', 'sourceKind', 'parserVersion', 'locatorHash', 'observedAt', 'contentHash',
  ], 'Source artifact');
  if (typeof value.artifact.id !== 'string'
      || !SOURCE_KINDS.has(value.artifact.sourceKind as SourceKind)
      || typeof value.artifact.parserVersion !== 'string'
      || typeof value.artifact.locatorHash !== 'string'
      || typeof value.artifact.observedAt !== 'string'
      || !isOptionalString(value.artifact.contentHash)) {
    throw new Error('Source artifact does not match the runtime schema');
  }
  assertOnlyKeys(value.era, [
    'id', 'name', 'mode', 'parserVersion', 'capabilities', 'startsAt', 'endsAt',
  ], 'Observation era');
  if (typeof value.era.id !== 'string'
      || typeof value.era.name !== 'string'
      || !ERA_MODES.has(value.era.mode as EraMode)
      || typeof value.era.parserVersion !== 'string'
      || !Array.isArray(value.era.capabilities)
      || !value.era.capabilities.every((capability) => typeof capability === 'string')
      || typeof value.era.startsAt !== 'string'
      || !isOptionalString(value.era.endsAt)) {
    throw new Error('Observation era does not match the runtime schema');
  }
  if (value.artifact.parserVersion !== value.era.parserVersion) {
    throw new Error('Canonical batch artifact and era parser versions must match');
  }
  for (const key of ['discovered', 'parsed', 'skipped', 'failed', 'unknown']) {
    const count = value.coverage[key];
    if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0) {
      throw new Error('Coverage counts must be non-negative integers');
    }
  }
  assertOnlyKeys(value.coverage, ['discovered', 'parsed', 'skipped', 'failed', 'unknown'], 'Coverage');
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
    assertOnlyKeys(rawEvent, [
      'id', 'nativeEventId', 'sequence', 'occurredAt', 'kind', 'actor', 'sensitivity',
      'payload', 'parentEventId', 'taskId', 'threadId', 'turnId', 'attempt', 'generation',
      'repository', 'payloadRef',
    ], 'Canonical event');
    if (!Number.isSafeInteger(rawEvent.sequence) || rawEvent.sequence < 0
        || !isOptionalString(rawEvent.parentEventId)
        || !isOptionalString(rawEvent.taskId)
        || !isOptionalString(rawEvent.threadId)
        || !isOptionalString(rawEvent.turnId)
        || !isOptionalString(rawEvent.payloadRef)
        || !isOptionalNonNegativeInteger(rawEvent.attempt)
        || !isOptionalNonNegativeInteger(rawEvent.generation)) {
      throw new Error('Canonical event optional identity fields do not match the runtime schema');
    }
    if (rawEvent.repository !== undefined) {
      if (!isRecord(rawEvent.repository)) throw new Error('Canonical event repository must be a record');
      assertOnlyKeys(rawEvent.repository, ['root', 'worktree', 'branch'], 'Canonical event repository');
      if (!isOptionalString(rawEvent.repository.root)
          || !isOptionalString(rawEvent.repository.worktree)
          || !isOptionalString(rawEvent.repository.branch)) {
        throw new Error('Canonical event repository fields must be strings');
      }
    }
    validatePayload(rawEvent.kind as CanonicalEventKind, rawEvent.payload);
    if (rawEvent.sensitivity === 'sensitive-content' && Object.keys(rawEvent.payload).length > 0) {
      throw new Error('Canonical payload cannot contain raw sensitive content; use payloadRef');
    }
    if (rawEvent.sensitivity === 'sensitive-content'
        && (typeof rawEvent.payloadRef !== 'string' || rawEvent.payloadRef.length === 0)) {
      throw new Error('Sensitive canonical events require a payloadRef');
    }
    if (rawEvent.payloadRef !== undefined && !OPAQUE_PAYLOAD_REF.test(rawEvent.payloadRef as string)) {
      throw new Error('Canonical payloadRef must be an opaque source reference');
    }
  }
  for (const edge of value.identityEdges) {
    if (!isRecord(edge)
        || !['parent', 'task-thread', 'root-child', 'turn-attempt'].includes(String(edge.kind))
        || typeof edge.fromId !== 'string'
        || typeof edge.toId !== 'string') {
      throw new Error('Identity edge does not match the runtime schema');
    }
    assertOnlyKeys(edge, ['kind', 'fromId', 'toId'], 'Identity edge');
  }
  for (const diagnostic of value.diagnostics) {
    if (!isRecord(diagnostic)) throw new Error('Ingestion diagnostic must be a record');
    assertOnlyKeys(diagnostic, ['severity', 'code', 'count'], 'Ingestion diagnostic');
    if (!['info', 'warning', 'error'].includes(String(diagnostic.severity))
        || typeof diagnostic.code !== 'string'
        || !DIAGNOSTIC_CODES.has(diagnostic.code as IngestionDiagnosticCode)
        || typeof diagnostic.count !== 'number'
        || !Number.isSafeInteger(diagnostic.count)
        || diagnostic.count < 0) {
      throw new Error('Ingestion diagnostic does not match the runtime schema');
    }
  }
  return value as unknown as CanonicalBatch;
}

export function parseCanonicalBatch(value: unknown): CanonicalBatch {
  try {
    return parseCanonicalBatchValue(value);
  } catch (error) {
    if (error instanceof CanonicalBatchValidationError) throw error;
    throw new CanonicalBatchValidationError(error instanceof Error ? error.message : 'Invalid canonical batch');
  }
}

function cursorsEqual(left: SourceCursor | null, right: SourceCursor | null): boolean {
  if (left === null || right === null) return left === right;
  return left.token === right.token && left.position === right.position;
}

function mergeDiagnostics(
  existingJson: string | null,
  incoming: IngestionDiagnostic[],
): Array<{ severity: string; code: string; count: number }> {
  const merged = new Map<string, { severity: string; code: string; count: number }>();
  if (existingJson) {
    try {
      const existing = JSON.parse(existingJson) as Array<{ severity: string; code: string; count: number }>;
      for (const diagnostic of existing) {
        if (typeof diagnostic.severity !== 'string' || typeof diagnostic.code !== 'string'
            || !Number.isSafeInteger(diagnostic.count) || diagnostic.count < 1) continue;
        merged.set(`${diagnostic.severity}:${diagnostic.code}`, diagnostic);
      }
    } catch {
      merged.set('error:invalid-stored-diagnostics', {
        severity: 'error', code: 'invalid-stored-diagnostics', count: 1,
      });
    }
  }
  for (const diagnostic of incoming) {
    const key = `${diagnostic.severity}:${diagnostic.code}`;
    const prior = merged.get(key);
    merged.set(key, { ...diagnostic, count: diagnostic.count + (prior?.count ?? 0) });
  }
  return [...merged.values()].sort((left, right) => left.code.localeCompare(right.code));
}

export async function ingestSourceAdapter(
  adapter: SourceAdapter,
  db: Database.Database,
): Promise<IngestionSummary> {
  const runId = `ingestion:${randomUUID()}`;
  const startedAt = new Date().toISOString();
  const coverage = { ...EMPTY_COVERAGE };
  let insertedEvents = 0;
  let advancedSources = 0;
  let status: IngestionSummary['status'] = 'completed';

  db.prepare(`
    INSERT INTO ingestion_runs (
      id, adapter_name, started_at, status, discovered_count,
      parsed_count, skipped_count, failed_count, unknown_count
    ) VALUES (?, ?, ?, 'running', 0, 0, 0, 0, 0)
  `).run(runId, adapter.name, startedAt);

  try {
    const artifacts = await adapter.discover();
    coverage.discovered = artifacts.length;
    db.prepare('UPDATE ingestion_runs SET discovered_count = ? WHERE id = ?')
      .run(artifacts.length, runId);
    for (const artifact of artifacts) {
      let batch: CanonicalBatch;
      const storedSource = db.prepare(`
        SELECT cursor AS token, cursor_position AS position,
               locator_hash AS locatorHash, content_hash AS contentHash,
               parser_version AS parserVersion
        FROM source_artifacts WHERE id = ?
      `).get(artifact.id) as ({
        token: string | null;
        position: number;
        locatorHash: string;
        contentHash: string | null;
        parserVersion: string;
      }) | undefined;
      if (storedSource && (
        storedSource.locatorHash !== artifact.locatorHash
        || storedSource.contentHash !== (artifact.contentHash ?? null)
        || storedSource.parserVersion !== artifact.parserVersion
      )) {
        throw new Error('Immutable source identity conflicts with changed locator or content hash');
      }
      const currentCursor = storedSource?.token !== null && storedSource?.token !== undefined
        ? { token: storedSource.token, position: storedSource.position }
        : null;
      try {
        batch = parseCanonicalBatch(await adapter.parse(artifact, { currentCursor }));
        if (batch.artifact.id !== artifact.id
            || batch.artifact.sourceKind !== artifact.sourceKind
            || batch.artifact.parserVersion !== artifact.parserVersion
            || batch.artifact.locatorHash !== artifact.locatorHash
            || (batch.artifact.contentHash ?? null) !== (artifact.contentHash ?? null)) {
          throw new Error('Canonical batch artifact does not match the discovered source');
        }
        if (!cursorsEqual(batch.previousCursor, currentCursor)) {
          throw new Error('Stale source cursor: batch was parsed from an outdated source position');
        }
        if (batch.operation !== 'rebuild' && batch.nextCursor.position < (currentCursor?.position ?? 0)) {
          throw new Error('Stale source cursor: next position would move backwards');
        }
      } catch (error) {
        coverage.failed += 1;
        db.prepare(`
          INSERT INTO ingestion_diagnostics (run_id, severity, code, count, detail)
          VALUES (?, 'error', 'adapter-parse-failed', 1, ?)
        `).run(runId, null);
        if (error instanceof CanonicalBatchValidationError || (error instanceof Error && (
          error.message.includes('Stale source cursor')
          || error.message.includes('Canonical')
        ))) {
          throw error;
        }
        continue;
      }

      const writeBatch = db.transaction(() => {
        if (batch.operation === 'rebuild') {
          db.prepare('DELETE FROM canonical_identity_edges WHERE source_artifact_id = ?').run(artifact.id);
          db.prepare('DELETE FROM canonical_events WHERE source_artifact_id = ?').run(artifact.id);
        }
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
            id, source_kind, parser_version, locator_hash, observed_at,
            content_hash, cursor, cursor_position, era_id
          ) VALUES (?, ?, ?, ?, ?, ?, NULL, 0, ?)
          ON CONFLICT(id) DO NOTHING
        `).run(
          artifact.id,
          artifact.sourceKind,
          artifact.parserVersion,
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
          const persistedEvent = {
            id: event.id,
            sourceArtifactId: artifact.id,
            eraId: batch.era.id,
            nativeEventId: event.nativeEventId,
            sequence: event.sequence,
            occurredAt: event.occurredAt,
            kind: event.kind,
            actor: event.actor,
            sensitivity: event.sensitivity,
            payloadJson: JSON.stringify(event.payload),
            parentEventId: event.parentEventId ?? null,
            taskId: event.taskId ?? null,
            threadId: event.threadId ?? null,
            turnId: event.turnId ?? null,
            attempt: event.attempt ?? null,
            generation: event.generation ?? null,
            parserVersion: batch.era.parserVersion,
            repoRoot: event.repository?.root ?? null,
            worktreePath: event.repository?.worktree ?? null,
            gitBranch: event.repository?.branch ?? null,
            payloadRef: event.payloadRef ?? null,
          };
          const result = insertEvent.run(
            ...Object.values(persistedEvent),
          );
          if (result.changes === 0) {
            const existing = db.prepare(`
              SELECT id, source_artifact_id AS sourceArtifactId, era_id AS eraId,
                     native_event_id AS nativeEventId, sequence, occurred_at AS occurredAt,
                     kind, actor, sensitivity, payload_json AS payloadJson,
                     parent_event_id AS parentEventId, task_id AS taskId, thread_id AS threadId,
                     turn_id AS turnId, attempt, generation, parser_version AS parserVersion,
                     repo_root AS repoRoot, worktree_path AS worktreePath,
                     git_branch AS gitBranch, payload_ref AS payloadRef
              FROM canonical_events
              WHERE id = ? OR (source_artifact_id = ? AND native_event_id = ?)
              LIMIT 1
            `).get(event.id, artifact.id, event.nativeEventId) as Record<string, unknown> | undefined;
            if (!existing || JSON.stringify(existing) !== JSON.stringify(persistedEvent)) {
              throw new Error('Canonical event identity conflict with different evidence');
            }
          }
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

        const noNewRange = batch.operation !== 'rebuild'
          && batch.nextCursor.position === (batch.previousCursor?.position ?? 0);
        const priorStats = db.prepare(`
          SELECT discovered_count AS discovered, parsed_count AS parsed,
                 skipped_count AS skipped, failed_count AS failed,
                 unknown_count AS unknown, diagnostics_json AS diagnosticsJson
          FROM source_ingestion_stats WHERE source_artifact_id = ?
        `).get(artifact.id) as (CoverageCounts & { diagnosticsJson: string }) | undefined;
        if (!priorStats || batch.operation === 'rebuild' || !noNewRange) {
          const replace = !priorStats || batch.operation === 'rebuild';
          const sourceCoverage = replace ? batch.coverage : {
            discovered: Math.max(priorStats.discovered, batch.coverage.discovered),
            parsed: priorStats.parsed + batch.coverage.parsed,
            skipped: priorStats.skipped + batch.coverage.skipped,
            failed: priorStats.failed + batch.coverage.failed,
            unknown: priorStats.unknown + batch.coverage.unknown,
          };
          const diagnostics = mergeDiagnostics(
            replace ? null : priorStats?.diagnosticsJson ?? null,
            batch.diagnostics,
          );
          db.prepare(`
            INSERT INTO source_ingestion_stats (
              source_artifact_id, discovered_count, parsed_count, skipped_count,
              failed_count, unknown_count, diagnostics_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(source_artifact_id) DO UPDATE SET
              discovered_count = excluded.discovered_count,
              parsed_count = excluded.parsed_count,
              skipped_count = excluded.skipped_count,
              failed_count = excluded.failed_count,
              unknown_count = excluded.unknown_count,
              diagnostics_json = excluded.diagnostics_json,
              updated_at = datetime('now')
          `).run(
            artifact.id,
            sourceCoverage.discovered,
            sourceCoverage.parsed,
            sourceCoverage.skipped,
            sourceCoverage.failed,
            sourceCoverage.unknown,
            JSON.stringify(diagnostics),
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
        if (batch.operation === 'rebuild' || batch.events.length > 0 || batch.identityEdges.length > 0) {
          db.prepare(`UPDATE canonical_projection_state
            SET dirty = 1, updated_at = datetime('now') WHERE id = 1`).run();
        }
      });

      writeBatch();
      advancedSources += 1;
      coverage.parsed += batch.coverage.parsed;
      coverage.skipped += batch.coverage.skipped;
      coverage.failed += batch.coverage.failed;
      coverage.unknown += batch.coverage.unknown;
    }

    const projectionState = db.prepare('SELECT dirty FROM canonical_projection_state WHERE id = 1')
      .get() as { dirty: number };
    if (projectionState.dirty === 1) {
      db.transaction(() => {
        rebuildTaskProjection(db);
        db.prepare(`UPDATE canonical_projection_state
          SET dirty = 0, updated_at = datetime('now') WHERE id = 1`).run();
      })();
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
    const failureCode: IngestionDiagnosticCode = error instanceof IdentityConflictError
      ? 'identity-conflict'
      : 'ingestion-failed';
    db.prepare(`
      INSERT INTO ingestion_diagnostics (run_id, severity, code, count, detail)
      VALUES (?, 'error', ?, 1, ?)
    `).run(runId, failureCode, null);
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
