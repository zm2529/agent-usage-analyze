import { createHash } from 'node:crypto';
import type Database from 'better-sqlite3';

export const PATTERN_ALGORITHM_VERSION = 'deterministic-patterns-v1';

export type PatternKey =
  | 'rework'
  | 'waiting'
  | 'context-switching'
  | 'validation-missing'
  | 'late-constraint'
  | 'repeated-failure';
export type TrendState = 'new' | 'persistent' | 'improving' | 'regressed' | 'resolved' | 'incomparable';
export type EraCompatibility = 'compatible' | 'limited' | 'incomparable';

export interface ObservationEraReport {
  id: string;
  mode: 'historical-backfill' | 'continuous-observation';
  parserVersion: string;
  capabilities: string[];
  startsAt: string;
  endsAt: string | null;
  coverage: number;
}

export interface AnalysisClaim {
  id: string;
  pattern: PatternKey;
  sourceCategory: 'deterministic';
  algorithmVersion: string;
  window: { start: string; end: string };
  sampleCount: number;
  totalTaskCount: number;
  coverage: number;
  confidence: number;
  eraCompatibility: EraCompatibility;
  sampleTaskRefs: string[];
  evidenceRefs: string[];
  evidence: AnalysisEvidenceRecord[];
}

export interface AnalysisEvidenceRecord {
  id: string;
  evidenceType: string;
  subjectRef: string;
  position: 'supports' | 'opposes' | 'limits';
  sourceCategory: 'deterministic' | 'statistical' | 'llm-semantic' | 'human-corrected';
  algorithmVersion: string;
  coverage: number;
  confidence: number;
  eraCompatibility: EraCompatibility;
  eraIds: string[];
  humanStatus: 'unreviewed' | 'confirmed' | 'rejected' | 'corrected';
  factRefs: string[];
  facts: Array<{ eventId: string; taskId: string }>;
}

export interface PatternTrend {
  pattern: PatternKey;
  label: string;
  observableFact: string;
  state: TrendState;
  change: number | null;
  unknownReason: 'insufficient-sample' | 'insufficient-coverage' | 'era-incompatible' | 'conflicting-evidence' | null;
  previous: AnalysisClaim | null;
  current: AnalysisClaim | null;
  conflictingEvidence: AnalysisEvidenceRecord[];
}

export interface TrendComparison {
  previousWindow: { start: string; end: string; taskCount: number; coverage: number; eras: ObservationEraReport[] };
  currentWindow: { start: string; end: string; taskCount: number; coverage: number; eras: ObservationEraReport[] };
  eraCompatibility: EraCompatibility;
  trends: PatternTrend[];
}

const PATTERNS: Record<PatternKey, { label: string; observableFact: string }> = {
  rework: { label: 'Rework', observableFact: 'The same redacted file identity changed more than once in a task.' },
  waiting: { label: 'Waiting', observableFact: 'A linked tool call and result were at least 60 seconds apart.' },
  'context-switching': { label: 'Context switching', observableFact: 'A task moved between observed repository or worktree contexts.' },
  'validation-missing': { label: 'Validation missing', observableFact: 'A completed task changed files without an observed validation tool call.' },
  'late-constraint': { label: 'Late constraint', observableFact: 'A user message arrived after the first observed file change.' },
  'repeated-failure': { label: 'Repeated failure', observableFact: 'At least two explicit failed task lifecycle events were observed.' },
};

interface EventRow {
  id: string; kind: string; occurredAt: string; payloadJson: string;
  parentEventId: string | null; repoRoot: string | null; worktreePath: string | null;
  sourceArtifactId: string;
  turnId: string | null; generation: number | null; attempt: number | null;
  threadId: string | null; taskId: string | null;
}

interface WindowObservation {
  start: string;
  end: string;
  taskCount: number;
  coverage: number;
  eras: ObservationEraReport[];
  evidence: Record<PatternKey, string[]>;
  sampleCounts: Record<PatternKey, number>;
  sampleTasks: Record<PatternKey, string[]>;
  factTasks: Map<string, string>;
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function parsePayload(value: string): Record<string, unknown> {
  try { return JSON.parse(value) as Record<string, unknown>; } catch { return {}; }
}

function emptyEvidence(): Record<PatternKey, string[]> {
  return {
    rework: [], waiting: [], 'context-switching': [], 'validation-missing': [],
    'late-constraint': [], 'repeated-failure': [],
  };
}

function emptyCounts(): Record<PatternKey, number> {
  return {
    rework: 0, waiting: 0, 'context-switching': 0, 'validation-missing': 0,
    'late-constraint': 0, 'repeated-failure': 0,
  };
}

function emptyTaskRefs(): Record<PatternKey, string[]> {
  return {
    rework: [], waiting: [], 'context-switching': [], 'validation-missing': [],
    'late-constraint': [], 'repeated-failure': [],
  };
}

function detectLanePatterns(events: EventRow[]): Record<PatternKey, string[]> {
  const found = emptyEvidence();
  const ordered = [...events].sort((left, right) => left.occurredAt.localeCompare(right.occurredAt) || left.id.localeCompare(right.id));
  const fileGroups = new Map<string, string[]>();
  for (const event of ordered.filter((item) => item.kind === 'file-change')) {
    const pathHash = parsePayload(event.payloadJson).pathHash;
    if (typeof pathHash === 'string') fileGroups.set(pathHash, [...(fileGroups.get(pathHash) ?? []), event.id]);
  }
  for (const ids of fileGroups.values()) if (ids.length > 1) found.rework.push(...ids);

  const calls = new Map(ordered.filter((event) => event.kind === 'tool-call').map((event) => [event.id, event]));
  for (const result of ordered.filter((event) => event.kind === 'tool-result' && event.parentEventId)) {
    const call = calls.get(result.parentEventId!);
    if (call && Date.parse(result.occurredAt) - Date.parse(call.occurredAt) >= 60_000) {
      found.waiting.push(call.id, result.id);
    }
  }

  let priorContext: string | null = null;
  for (const event of ordered) {
    const context = `${event.repoRoot ?? ''}\u0000${event.worktreePath ?? ''}`;
    if (context === '\u0000') continue;
    if (priorContext !== null && context !== priorContext) found['context-switching'].push(event.id);
    priorContext = context;
  }

  const fileChanges = ordered.filter((event) => event.kind === 'file-change');
  const completed = ordered.filter((event) => event.kind === 'task-completed');
  const validation = ordered.some((event) => {
    if (event.kind !== 'tool-call') return false;
    return typeof parsePayload(event.payloadJson).validationKind === 'string';
  });
  if (fileChanges.length > 0 && completed.length > 0 && !validation) {
    found['validation-missing'].push(...fileChanges.map((event) => event.id), completed.at(-1)!.id);
  }

  if (fileChanges.length > 0) {
    const firstChange = fileChanges[0]!.occurredAt;
    const laterMessages = ordered.filter((event) => event.kind === 'user-message'
      && event.occurredAt > firstChange && typeof parsePayload(event.payloadJson).constraintKind === 'string');
    if (laterMessages.length > 0) found['late-constraint'].push(fileChanges[0]!.id, ...laterMessages.map((event) => event.id));
  }

  const failures = ordered.filter((event) => {
    if (!['task-status', 'task-completed'].includes(event.kind)) return false;
    return parsePayload(event.payloadJson).status === 'failed';
  });
  const failureLanes = new Map<string, EventRow>();
  for (const failure of failures) {
    if (failure.turnId === null && (failure.generation === null || failure.attempt === null)) continue;
    const lane = failure.turnId ?? `${failure.generation}:${failure.attempt}`;
    if (!failureLanes.has(lane)) failureLanes.set(lane, failure);
  }
  if (failureLanes.size > 1) found['repeated-failure'].push(...[...failureLanes.values()].map((event) => event.id));
  for (const key of Object.keys(found) as PatternKey[]) found[key] = [...new Set(found[key])];
  return found;
}

function detectTaskPatterns(events: EventRow[]): Record<PatternKey, string[]> {
  const combined = emptyEvidence();
  const lanes = new Map<string, EventRow[]>();
  for (const event of events) {
    const lane = event.threadId ?? event.taskId ?? 'unknown';
    lanes.set(lane, [...(lanes.get(lane) ?? []), event]);
  }
  for (const laneEvents of lanes.values()) {
    const found = detectLanePatterns(laneEvents);
    for (const key of Object.keys(combined) as PatternKey[]) combined[key].push(...found[key]);
  }
  for (const key of Object.keys(combined) as PatternKey[]) combined[key] = [...new Set(combined[key])];
  return combined;
}

function eraReports(db: Database.Database, eraIds: string[], sourceIds: string[]): ObservationEraReport[] {
  if (eraIds.length === 0) return [];
  const placeholders = eraIds.map(() => '?').join(',');
  const rows = db.prepare(`
    SELECT id, mode, parser_version AS parserVersion, capabilities_json AS capabilitiesJson,
           starts_at AS startsAt, ends_at AS endsAt
    FROM observation_eras WHERE id IN (${placeholders}) ORDER BY starts_at, id
  `).all(...eraIds) as Array<{
    id: string; mode: ObservationEraReport['mode']; parserVersion: string;
    capabilitiesJson: string; startsAt: string; endsAt: string | null;
  }>;
  return rows.map((row) => {
    const sourcePlaceholders = sourceIds.map(() => '?').join(',');
    const coverage = sourceIds.length === 0 ? { known: 0, total: 0 } : db.prepare(`
      SELECT COALESCE(SUM(parsed_count - unknown_count), 0) AS known,
             COALESCE(SUM(parsed_count + skipped_count + failed_count), 0) AS total
      FROM source_ingestion_stats WHERE source_artifact_id IN (${sourcePlaceholders})
        AND source_artifact_id IN (SELECT id FROM source_artifacts WHERE era_id = ?)
    `).get(...sourceIds, row.id) as { known: number; total: number };
    let capabilities: string[] = [];
    try { capabilities = JSON.parse(row.capabilitiesJson) as string[]; } catch { /* invalid era stays capability-empty */ }
    return {
      id: row.id, mode: row.mode, parserVersion: row.parserVersion,
      capabilities, startsAt: row.startsAt, endsAt: row.endsAt,
      coverage: coverage.total > 0 ? coverage.known / coverage.total : 0,
    };
  });
}

function observeWindow(db: Database.Database, start: string, end: string): WindowObservation {
  const roots = db.prepare(`
    SELECT id, era_id AS eraId FROM work_tasks
    WHERE id = root_task_id AND started_at >= ? AND started_at < ? ORDER BY started_at, id
  `).all(start, end) as Array<{ id: string; eraId: string }>;
  const evidence = emptyEvidence();
  const sampleCounts = emptyCounts();
  const sampleTasks = emptyTaskRefs();
  const factTasks = new Map<string, string>();
  const events = db.prepare(`
    SELECT root.id AS rootTaskId, event.id, event.kind, event.occurred_at AS occurredAt,
           event.payload_json AS payloadJson, event.parent_event_id AS parentEventId,
           event.repo_root AS repoRoot, event.worktree_path AS worktreePath,
           event.source_artifact_id AS sourceArtifactId, event.turn_id AS turnId,
           event.generation, event.attempt, event.thread_id AS threadId, event.task_id AS taskId
    FROM work_tasks root
    JOIN work_tasks node ON node.root_task_id = root.id
    JOIN canonical_events event ON event.task_id = node.id
    WHERE root.id = root.root_task_id AND root.started_at >= ? AND root.started_at < ?
    ORDER BY root.started_at, root.id, event.occurred_at, event.source_artifact_id, event.sequence
  `).all(start, end) as Array<EventRow & { rootTaskId: string }>;
  const eventsByRoot = new Map<string, EventRow[]>();
  for (const event of events) {
    const rows = eventsByRoot.get(event.rootTaskId) ?? [];
    rows.push(event);
    eventsByRoot.set(event.rootTaskId, rows);
  }
  for (const root of roots) {
    const taskPatterns = detectTaskPatterns(eventsByRoot.get(root.id) ?? []);
    for (const key of Object.keys(evidence) as PatternKey[]) {
      if (taskPatterns[key].length > 0) {
        evidence[key].push(...taskPatterns[key]);
        sampleCounts[key] += 1;
        sampleTasks[key].push(root.id);
        for (const eventId of taskPatterns[key]) factTasks.set(eventId, root.id);
      }
    }
  }
  const eras = eraReports(
    db,
    [...new Set(roots.map((root) => root.eraId))],
    [...new Set(events.map((event) => event.sourceArtifactId))],
  );
  const coverage = eras.length > 0 ? Math.min(...eras.map((era) => era.coverage)) : 0;
  return { start, end, taskCount: roots.length, coverage, eras, evidence, sampleCounts, sampleTasks, factTasks };
}

function eraCompatibility(previous: ObservationEraReport[], current: ObservationEraReport[]): EraCompatibility {
  if (previous.length !== 1 || current.length !== 1) return 'incomparable';
  const left = previous[0]!;
  const right = current[0]!;
  if (left.id === right.id) return 'compatible';
  if (left.mode !== right.mode || left.parserVersion !== right.parserVersion
      || JSON.stringify([...left.capabilities].sort()) !== JSON.stringify([...right.capabilities].sort())) {
    return 'incomparable';
  }
  return 'limited';
}

function readConflictingEvidence(db: Database.Database, subjectRef: string): AnalysisEvidenceRecord[] {
  const rows = db.prepare(`SELECT id, evidence_type AS evidenceType, subject_ref AS subjectRef,
    position, source_category AS sourceCategory, algorithm_version AS algorithmVersion,
    coverage, confidence, era_compatibility AS eraCompatibility, era_ids_json AS eraIdsJson,
    human_status AS humanStatus, fact_refs_json AS factsJson
    FROM evidence_records WHERE subject_ref = ? AND position IN ('opposes', 'limits') ORDER BY created_at, id`)
    .all(subjectRef) as Array<Omit<AnalysisEvidenceRecord, 'eraIds' | 'factRefs' | 'facts'> & { eraIdsJson: string; factsJson: string }>;
  return rows.map((row) => {
    const { eraIdsJson, factsJson, ...record } = row;
    let eraIds: string[] = [];
    let facts: Array<{ eventId: string; taskId: string }> = [];
    try { eraIds = JSON.parse(eraIdsJson) as string[]; } catch { /* safe empty */ }
    try { facts = JSON.parse(factsJson) as typeof facts; } catch { /* safe empty */ }
    return { ...record, eraIds, facts, factRefs: facts.map((fact) => fact.eventId) };
  });
}

function createClaim(
  db: Database.Database,
  pattern: PatternKey,
  observation: WindowObservation,
  compatibility: EraCompatibility,
): { claim: AnalysisClaim | null; conflicts: AnalysisEvidenceRecord[] } {
  const factRefs = [...new Set(observation.evidence[pattern])].sort();
  if (factRefs.length === 0) return { claim: null, conflicts: [] };
  const sampleCount = observation.sampleCounts[pattern];
  const confidence = Math.min(1, observation.coverage * Math.min(1, sampleCount / 3));
  const sampleTaskRefs = [...new Set(observation.sampleTasks[pattern])].sort();
  const subjectRef = `pattern:${pattern}:${observation.start}:${observation.end}`;
  const conflicts = readConflictingEvidence(db, subjectRef);
  if (conflicts.length > 0) return { claim: null, conflicts };
  const facts = factRefs.map((eventId) => ({ eventId, taskId: observation.factTasks.get(eventId)! }));
  const evidenceIdentity = {
    evidenceType: 'canonical-event-observation', subjectRef, position: 'supports',
    sourceCategory: 'deterministic', algorithmVersion: PATTERN_ALGORITHM_VERSION,
    coverage: observation.coverage, confidence, eraCompatibility: compatibility,
    eraIds: observation.eras.map((era) => era.id), humanStatus: 'unreviewed', facts,
  } as const;
  const evidence: AnalysisEvidenceRecord = {
    id: `evidence:${hash(JSON.stringify(evidenceIdentity))}`,
    ...evidenceIdentity,
    factRefs: facts.map((fact) => fact.eventId),
  };
  db.prepare(`INSERT OR IGNORE INTO evidence_records (
    id, evidence_type, subject_ref, position, source_category, algorithm_version,
    coverage, confidence, era_compatibility, era_ids_json, human_status, fact_refs_json
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(evidence.id, evidence.evidenceType, evidence.subjectRef, evidence.position,
      evidence.sourceCategory, evidence.algorithmVersion, evidence.coverage,
      evidence.confidence, evidence.eraCompatibility, JSON.stringify(evidence.eraIds),
      evidence.humanStatus, JSON.stringify(evidence.facts));
  const evidenceRefs = [evidence.id];
  const claimIdentity = {
    pattern,
    sourceCategory: 'deterministic',
    algorithmVersion: PATTERN_ALGORITHM_VERSION,
    window: { start: observation.start, end: observation.end },
    sampleCount,
    totalTaskCount: observation.taskCount,
    coverage: observation.coverage,
    confidence,
    eraCompatibility: compatibility,
    sampleTaskRefs,
    evidenceRefs,
  } as const;
  const claim: AnalysisClaim = { id: `claim:${hash(JSON.stringify(claimIdentity))}`, ...claimIdentity, evidence: [evidence] };
  db.prepare(`INSERT OR IGNORE INTO analysis_claims (
    id, pattern_key, source_category, algorithm_version, window_start, window_end,
    sample_count, total_task_count, coverage, confidence, era_compatibility,
    sample_task_refs_json, evidence_refs_json
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(claim.id, claim.pattern, claim.sourceCategory, claim.algorithmVersion,
      claim.window.start, claim.window.end, claim.sampleCount, claim.totalTaskCount,
      claim.coverage, claim.confidence, claim.eraCompatibility,
      JSON.stringify(claim.sampleTaskRefs), JSON.stringify(claim.evidenceRefs));
  return { claim, conflicts: [] };
}

export function comparePatternWindows(
  db: Database.Database,
  request: { currentStart: string; currentEnd: string; minSampleSize?: number; minCoverage?: number },
): TrendComparison {
  const currentStartMs = Date.parse(request.currentStart);
  const currentEndMs = Date.parse(request.currentEnd);
  if (!Number.isFinite(currentStartMs) || !Number.isFinite(currentEndMs) || currentEndMs <= currentStartMs) {
    throw new Error('Trend window must have valid increasing ISO boundaries');
  }
  const duration = currentEndMs - currentStartMs;
  const previousStart = new Date(currentStartMs - duration).toISOString();
  const previousEnd = new Date(currentStartMs).toISOString();
  const currentStart = new Date(currentStartMs).toISOString();
  const currentEnd = new Date(currentEndMs).toISOString();
  const previous = observeWindow(db, previousStart, previousEnd);
  const current = observeWindow(db, currentStart, currentEnd);
  const compatibility = eraCompatibility(previous.eras, current.eras);
  const minimumSample = request.minSampleSize ?? 2;
  const minimumCoverage = request.minCoverage ?? 0.8;
  const sampleInsufficient = previous.taskCount < minimumSample || current.taskCount < minimumSample;
  const coverageInsufficient = previous.coverage < minimumCoverage || current.coverage < minimumCoverage;
  const trends: PatternTrend[] = [];
  for (const pattern of Object.keys(PATTERNS) as PatternKey[]) {
    const previousResult = createClaim(db, pattern, previous, compatibility);
    const currentResult = createClaim(db, pattern, current, compatibility);
    const previousClaim = previousResult.claim;
    const currentClaim = currentResult.claim;
    const conflictingEvidence = [...previousResult.conflicts, ...currentResult.conflicts];
    if (!previousClaim && !currentClaim && conflictingEvidence.length === 0) continue;
    let state: TrendState;
    let unknownReason: PatternTrend['unknownReason'] = null;
    if (conflictingEvidence.length > 0) {
      state = 'incomparable'; unknownReason = 'conflicting-evidence';
    } else if (compatibility === 'incomparable') {
      state = 'incomparable'; unknownReason = 'era-incompatible';
    } else if (sampleInsufficient) {
      state = 'incomparable'; unknownReason = 'insufficient-sample';
    } else if (coverageInsufficient) {
      state = 'incomparable'; unknownReason = 'insufficient-coverage';
    } else if (!previousClaim) state = 'new';
    else if (!currentClaim) state = 'resolved';
    else {
      const previousRate = previousClaim.sampleCount / previousClaim.totalTaskCount;
      const currentRate = currentClaim.sampleCount / currentClaim.totalTaskCount;
      state = currentRate < previousRate ? 'improving' : currentRate > previousRate ? 'regressed' : 'persistent';
    }
    const previousRate = previousClaim ? previousClaim.sampleCount / previousClaim.totalTaskCount : 0;
    const currentRate = currentClaim ? currentClaim.sampleCount / currentClaim.totalTaskCount : 0;
    const change = state === 'incomparable' ? null : currentRate - previousRate;
    trends.push({
      pattern, ...PATTERNS[pattern], state, change, unknownReason,
      previous: previousClaim, current: currentClaim, conflictingEvidence,
    });
  }
  return {
    previousWindow: { start: previous.start, end: previous.end, taskCount: previous.taskCount, coverage: previous.coverage, eras: previous.eras },
    currentWindow: { start: current.start, end: current.end, taskCount: current.taskCount, coverage: current.coverage, eras: current.eras },
    eraCompatibility: compatibility,
    trends,
  };
}
