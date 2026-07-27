import { createHash, randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { tryRecordObserverOverhead } from './observer-overhead.js';
import { listSemanticClaims } from './semantic-analysis.js';
import { observeTaskPatterns } from './patterns.js';

export interface AdvisorySuggestion {
  issueKey: string;
  sourceCategory: 'deterministic' | 'llm-semantic';
  triggerFact: string;
  expectedBenefit: string;
  confidence: number;
  coverage: number;
  evidenceRefs: string[];
  verification: string;
  muted: boolean;
}

export interface AdvisoryQueryResult {
  status: 'ok';
  taskId: string;
  suggestions: AdvisorySuggestion[];
  diagnostics: string[];
}

export type AdvisoryAction = 'shown' | 'adopted' | 'ignored' | 'dismissed' | 'outcome';

export interface AdvisoryEvent {
  id: string;
  interventionId: string;
  issueKey: string;
  taskId: string;
  action: AdvisoryAction;
  outcome: 'improved' | 'not-improved' | 'unknown' | null;
  observationEraId: string;
  coverage: number;
  evidenceRefs: string[];
  occurredAt: string;
}

export interface AdvisoryHistory {
  events: AdvisoryEvent[];
  comparisons: Array<{
    interventionId: string;
    issueKey: string;
    kind: 'observational-before-after';
    causal: false;
    baseline: { observationEraId: string; coverage: number; occurredAt: string };
    followup: {
      observationEraId: string; coverage: number;
      outcome: 'improved' | 'not-improved' | 'unknown'; occurredAt: string;
    };
  }>;
}

export function setAdvisoryMute(db: Database.Database, input: {
  scopeKind: 'issue' | 'category';
  scopeKey: string;
  mutedUntil: string | null;
  now: string;
}): void {
  assertOpaque(input.scopeKey, 'Mute scope key');
  if (input.scopeKind === 'category' && !['deterministic', 'llm-semantic'].includes(input.scopeKey)) {
    throw new Error('Unsupported advisory category');
  }
  const now = new Date(input.now);
  if (!Number.isFinite(now.getTime())) throw new Error('Mute update time is invalid');
  let mutedUntil: string | null = null;
  if (input.mutedUntil !== null) {
    const until = new Date(input.mutedUntil);
    if (!Number.isFinite(until.getTime()) || until.getTime() <= now.getTime()) {
      throw new Error('Mute end must be after the update time');
    }
    mutedUntil = until.toISOString();
  }
  db.prepare(`INSERT INTO advisory_mutes (scope_kind, scope_key, muted_until, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(scope_kind, scope_key) DO UPDATE SET
      muted_until = excluded.muted_until, updated_at = excluded.updated_at`)
    .run(input.scopeKind, input.scopeKey, mutedUntil, now.toISOString());
}

export function clearAdvisoryMute(
  db: Database.Database,
  input: { scopeKind: 'issue' | 'category'; scopeKey: string },
): void {
  assertOpaque(input.scopeKey, 'Mute scope key');
  db.prepare('DELETE FROM advisory_mutes WHERE scope_kind = ? AND scope_key = ?')
    .run(input.scopeKind, input.scopeKey);
}

function assertOpaque(value: string, label: string): void {
  if (value.length < 1 || value.length > 256 || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value)) {
    throw new Error(`${label} must be an opaque identifier`);
  }
}

export function recordAdvisoryEvent(db: Database.Database, input: {
  interventionId?: string;
  issueKey: string;
  taskId: string;
  action: AdvisoryAction;
  outcome?: 'improved' | 'not-improved' | 'unknown';
  observationEraId: string;
  coverage: number;
  evidenceRefs: string[];
  occurredAt: string;
}): { eventId: string; interventionId: string } {
  assertOpaque(input.issueKey, 'Issue key');
  assertOpaque(input.taskId, 'Task id');
  assertOpaque(input.observationEraId, 'Observation era id');
  if (!Number.isFinite(input.coverage) || input.coverage < 0 || input.coverage > 1) {
    throw new Error('Advisory coverage must be between 0 and 1');
  }
  if (!Array.isArray(input.evidenceRefs) || input.evidenceRefs.length === 0) {
    throw new Error('Advisory event requires evidence refs');
  }
  input.evidenceRefs.forEach((ref) => assertOpaque(ref, 'Evidence ref'));
  const occurredAt = new Date(input.occurredAt);
  if (!Number.isFinite(occurredAt.getTime())) throw new Error('Advisory event time is invalid');
  if ((input.action === 'outcome') !== (input.outcome !== undefined)) {
    throw new Error('Only outcome events carry an outcome');
  }
  const task = db.prepare('SELECT root_task_id AS rootTaskId FROM work_tasks WHERE id = ?')
    .get(input.taskId) as { rootTaskId: string } | undefined;
  if (!task) throw new Error('Advisory task not found');
  const evidenceClosed = input.evidenceRefs.every((eventId) => db.prepare(`SELECT 1
    FROM canonical_events event JOIN work_tasks task ON task.id = event.task_id
    WHERE event.id = ? AND task.root_task_id = ? AND event.era_id = ?`)
    .get(eventId, task.rootTaskId, input.observationEraId));
  if (!evidenceClosed) throw new Error('Advisory evidence does not belong to the analyzed task');
  const era = db.prepare('SELECT id FROM observation_eras WHERE id = ?').get(input.observationEraId);
  if (!era) throw new Error('Advisory observation era not found');
  const interventionId = input.interventionId ?? `advisory-intervention:${randomUUID()}`;
  assertOpaque(interventionId, 'Intervention id');
  if (input.action === 'shown' && input.interventionId !== undefined) {
    throw new Error('Shown events create a new intervention');
  }
  if (input.action !== 'shown' && input.interventionId === undefined) {
    throw new Error('Advisory response requires an intervention id');
  }
  if (input.action !== 'shown') {
    const baseline = db.prepare(`SELECT issue_key AS issueKey FROM advisory_events
      WHERE intervention_id = ? AND action = 'shown'`).get(interventionId) as {
        issueKey: string;
      } | undefined;
    if (!baseline || baseline.issueKey !== input.issueKey) {
      throw new Error('Advisory intervention not found');
    }
  }
  const id = `advisory-event:${randomUUID()}`;
  db.prepare(`INSERT INTO advisory_events
    (id, intervention_id, issue_key, task_id, action, outcome, observation_era_id, coverage,
     evidence_refs_json, occurred_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    id, interventionId, input.issueKey, task.rootTaskId, input.action, input.outcome ?? null,
    input.observationEraId, input.coverage, JSON.stringify(input.evidenceRefs),
    occurredAt.toISOString(),
  );
  if (input.action !== 'outcome') {
    tryRecordObserverOverhead(db, {
      category: 'advisory', observerRunId: id, analyzedTaskId: task.rootTaskId,
      advisoryAction: input.action, evidenceRefs: input.evidenceRefs,
    });
  }
  return { eventId: id, interventionId };
}

export function readAdvisoryHistory(db: Database.Database, taskId?: string, limit = 200): AdvisoryHistory {
  let rootTaskId: string | undefined;
  if (taskId !== undefined) {
    const task = db.prepare('SELECT root_task_id AS rootTaskId FROM work_tasks WHERE id = ?')
      .get(taskId) as { rootTaskId: string } | undefined;
    if (!task) return { events: [], comparisons: [] };
    rootTaskId = task.rootTaskId;
  }
  const rows = (rootTaskId
    ? db.prepare(`SELECT id, intervention_id AS interventionId, issue_key AS issueKey,
        task_id AS taskId, action, outcome,
        observation_era_id AS observationEraId, coverage,
        evidence_refs_json AS evidenceRefsJson, occurred_at AS occurredAt
      FROM advisory_events WHERE task_id = ? OR intervention_id IN (
        SELECT intervention_id FROM advisory_events WHERE task_id = ?
      ) ORDER BY occurred_at DESC, id DESC`).all(rootTaskId, rootTaskId)
    : db.prepare(`SELECT id, intervention_id AS interventionId, issue_key AS issueKey,
        task_id AS taskId, action, outcome,
        observation_era_id AS observationEraId, coverage,
        evidence_refs_json AS evidenceRefsJson, occurred_at AS occurredAt
      FROM advisory_events ORDER BY occurred_at DESC, id DESC LIMIT ?`).all(Math.max(1, Math.min(limit, 200)))) as Array<{
        id: string; interventionId: string; issueKey: string; taskId: string; action: AdvisoryAction;
        outcome: AdvisoryEvent['outcome']; observationEraId: string; coverage: number;
        evidenceRefsJson: string; occurredAt: string;
      }>;
  const events: AdvisoryEvent[] = rows.flatMap((row) => {
    const evidenceRefs = parseStringArray(row.evidenceRefsJson);
    if (!evidenceRefs) return [];
    const { evidenceRefsJson: _storedRefs, ...event } = row;
    return [{ ...event, evidenceRefs }];
  });
  const interventionIds = [...new Set(events.map((event) => event.interventionId))];
  const comparisons: AdvisoryHistory['comparisons'] = [];
  for (const interventionId of interventionIds) {
    const chronological = events.filter((event) => event.interventionId === interventionId)
      .sort((left, right) => left.occurredAt.localeCompare(right.occurredAt) || left.id.localeCompare(right.id));
    const baseline = chronological.find((event) => event.action === 'shown');
    const followup = [...chronological].reverse().find((event) => event.action === 'outcome'
      && event.outcome !== null && (!baseline || event.occurredAt > baseline.occurredAt));
    if (!baseline || !followup || followup.outcome === null) continue;
    comparisons.push({
      interventionId, issueKey: baseline.issueKey,
      kind: 'observational-before-after', causal: false,
      baseline: {
        observationEraId: baseline.observationEraId,
        coverage: baseline.coverage,
        occurredAt: baseline.occurredAt,
      },
      followup: {
        observationEraId: followup.observationEraId,
        coverage: followup.coverage,
        outcome: followup.outcome,
        occurredAt: followup.occurredAt,
      },
    });
  }
  comparisons.sort((left, right) => left.baseline.occurredAt.localeCompare(right.baseline.occurredAt)
    || left.issueKey.localeCompare(right.issueKey));
  return { events, comparisons };
}

const DETERMINISTIC_ADVICE = {
  rework: {
    triggerFact: 'The same redacted file identity changed more than once in a task.',
    expectedBenefit: 'A smaller validated slice may make repeated edits easier to evaluate.',
    verification: 'Compare repeated file-change evidence in the next similar task.',
  },
  waiting: {
    triggerFact: 'A linked tool call and result were at least 60 seconds apart.',
    expectedBenefit: 'A narrower or staged operation may make the next feedback point arrive sooner.',
    verification: 'Compare tool wait time in the next similar task.',
  },
  'context-switching': {
    triggerFact: 'A task moved between observed repository or worktree contexts.',
    expectedBenefit: 'Keeping one explicit work context may reduce accidental boundary changes.',
    verification: 'Compare observed repository and worktree transitions in the next similar task.',
  },
  'validation-missing': {
    triggerFact: 'The task record explicitly states that validation was not performed.',
    expectedBenefit: 'Adding the smallest relevant check may expose problems sooner.',
    verification: 'Run the smallest relevant validation and compare the next similar task.',
  },
  'late-constraint': {
    triggerFact: 'A user message arrived after the first observed file change.',
    expectedBenefit: 'Surfacing known constraints before editing may reduce avoidable rework.',
    verification: 'Compare time from the first constraint to the first file change in the next similar task.',
  },
  'repeated-failure': {
    triggerFact: 'At least two explicit failed task lifecycle events were observed.',
    expectedBenefit: 'A smaller diagnostic step may expose the next distinct failure sooner.',
    verification: 'Compare the number of explicit failed lifecycle events in the next similar task.',
  },
} as const;

function parseStringArray(value: string): string[] | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) && parsed.every((item) => typeof item === 'string') ? parsed : null;
  } catch {
    return null;
  }
}

function semanticIssueKey(title: string, verification: string): string {
  const normalize = (value: string) => value.trim().toLowerCase().replace(/\s+/g, ' ');
  const digest = createHash('sha256').update(JSON.stringify([
    normalize(title), normalize(verification),
  ])).digest('hex');
  return `semantic:sha256:${digest}`;
}

function hasExplicitNoValidationEvidence(
  db: Database.Database,
  taskId: string,
  eventIds: string[],
): boolean {
  for (const eventId of eventIds) {
    const row = db.prepare(`SELECT event.payload_json AS payloadJson
      FROM canonical_events event JOIN work_tasks task ON task.id = event.task_id
      WHERE event.id = ? AND task.root_task_id = ?`).get(eventId, taskId) as {
        payloadJson: string;
      } | undefined;
    if (!row) continue;
    try {
      const payload = JSON.parse(row.payloadJson) as Record<string, unknown>;
      if (payload.validationPerformed === false
          || ['not-run', 'skipped'].includes(String(payload.validationStatus ?? '').toLowerCase())) {
        return true;
      }
    } catch {
      // Malformed payload is not evidence that validation was skipped.
    }
  }
  return false;
}

function resolveEvidenceEvents(
  db: Database.Database,
  rootTaskId: string,
  evidenceRecordIds: string[],
  expected: { sourceCategory: string; algorithmVersion: string },
): string[] {
  const eventIds: string[] = [];
  for (const evidenceId of evidenceRecordIds) {
    const evidence = db.prepare(`SELECT fact_refs_json AS factsJson,
      source_category AS sourceCategory, algorithm_version AS algorithmVersion
      FROM evidence_records WHERE id = ? AND position = 'supports'`)
      .get(evidenceId) as {
        factsJson: string; sourceCategory: string; algorithmVersion: string;
      } | undefined;
    if (!evidence || evidence.sourceCategory !== expected.sourceCategory
        || evidence.algorithmVersion !== expected.algorithmVersion) return [];
    let facts: Array<{ eventId?: unknown }>;
    try {
      facts = JSON.parse(evidence.factsJson) as Array<{ eventId?: unknown }>;
    } catch {
      return [];
    }
    if (!Array.isArray(facts) || facts.length === 0) return [];
    for (const fact of facts) {
      if (typeof fact.eventId !== 'string') return [];
      const event = db.prepare(`SELECT event.id FROM canonical_events event
        JOIN work_tasks task ON task.id = event.task_id
        WHERE event.id = ? AND task.root_task_id = ?`).get(fact.eventId, rootTaskId);
      if (!event) return [];
      eventIds.push(fact.eventId);
    }
  }
  return [...new Set(eventIds)];
}

export function queryAdvisories(
  db: Database.Database,
  input: { taskId: string; now: string; limit?: number; cooldownMs?: number; includeMuted?: boolean },
): AdvisoryQueryResult {
  const limit = Math.max(0, Math.min(3, input.limit ?? 1));
  const task = db.prepare('SELECT root_task_id AS rootTaskId FROM work_tasks WHERE id = ?')
    .get(input.taskId) as { rootTaskId: string } | undefined;
  if (!task || limit === 0) return { status: 'ok', taskId: input.taskId, suggestions: [], diagnostics: [] };
  const nowMs = Date.parse(input.now);
  const cooldownMs = input.cooldownMs ?? 7 * 86_400_000;
  if (!Number.isFinite(nowMs) || !Number.isSafeInteger(cooldownMs) || cooldownMs < 0) {
    return { status: 'ok', taskId: input.taskId, suggestions: [], diagnostics: ['invalid-query'] };
  }
  const normalizedNow = new Date(nowMs).toISOString();
  const rows = db.prepare(`SELECT claim.pattern_key AS patternKey,
    claim.algorithm_version AS algorithmVersion, claim.coverage, claim.confidence,
    claim.evidence_refs_json AS evidenceRefsJson
    FROM analysis_claims claim, json_each(claim.sample_task_refs_json) sample
    WHERE sample.value = ? AND claim.source_category = 'deterministic'
      AND claim.era_compatibility != 'incomparable'
    ORDER BY claim.window_end DESC, claim.id DESC`).all(task.rootTaskId) as Array<{
      patternKey: string; algorithmVersion: string; coverage: number; confidence: number;
      evidenceRefsJson: string;
    }>;
  const suggestions: AdvisorySuggestion[] = [];
  const seen = new Set<string>();
  const cooldownBoundary = new Date(nowMs - cooldownMs).toISOString();
  for (const claim of listSemanticClaims(db, task.rootTaskId)) {
    if (claim.claimType !== 'improvement-advice') continue;
    const issueKey = semanticIssueKey(claim.title, claim.verification);
    if (seen.has(issueKey)) continue;
    const muted = Boolean(db.prepare(`SELECT 1 FROM advisory_mutes
      WHERE ((scope_kind = 'issue' AND scope_key = ?)
        OR (scope_kind = 'category' AND scope_key = 'llm-semantic'))
        AND (muted_until IS NULL OR muted_until > ?) LIMIT 1`).get(issueKey, normalizedNow));
    if (muted && !input.includeMuted) continue;
    const recentlyShown = db.prepare(`SELECT 1 FROM advisory_events
      WHERE task_id = ? AND issue_key = ? AND action = 'shown' AND occurred_at > ? LIMIT 1`)
      .get(task.rootTaskId, issueKey, cooldownBoundary);
    if (recentlyShown) continue;
    seen.add(issueKey);
    suggestions.push({
      issueKey,
      sourceCategory: 'llm-semantic',
      triggerFact: claim.summary,
      expectedBenefit: claim.expectedBenefit,
      confidence: claim.confidence,
      coverage: claim.run.inputCoverage,
      evidenceRefs: claim.evidenceRefs,
      verification: claim.verification,
      muted,
    });
    if (suggestions.length >= limit) break;
  }
  for (const row of rows) {
    if (suggestions.length >= limit) break;
    const definition = DETERMINISTIC_ADVICE[row.patternKey as keyof typeof DETERMINISTIC_ADVICE];
    if (!definition || row.algorithmVersion !== 'deterministic-patterns-v1') continue;
    const issueKey = `pattern:${row.patternKey}`;
    if (seen.has(issueKey)) continue;
    const muted = Boolean(db.prepare(`SELECT 1 FROM advisory_mutes
      WHERE ((scope_kind = 'issue' AND scope_key = ?)
        OR (scope_kind = 'category' AND scope_key = 'deterministic'))
        AND (muted_until IS NULL OR muted_until > ?) LIMIT 1`).get(issueKey, normalizedNow));
    if (muted && !input.includeMuted) continue;
    const recentlyShown = db.prepare(`SELECT 1 FROM advisory_events
      WHERE task_id = ? AND issue_key = ? AND action = 'shown' AND occurred_at > ? LIMIT 1`)
      .get(task.rootTaskId, issueKey, cooldownBoundary);
    if (recentlyShown) continue;
    const evidenceRecordIds = parseStringArray(row.evidenceRefsJson);
    if (!evidenceRecordIds || evidenceRecordIds.length === 0) continue;
    if (!Number.isFinite(row.coverage) || row.coverage < 0 || row.coverage > 1
        || !Number.isFinite(row.confidence) || row.confidence < 0 || row.confidence > 1) continue;
    const evidenceRefs = resolveEvidenceEvents(db, task.rootTaskId, evidenceRecordIds, {
      sourceCategory: 'deterministic', algorithmVersion: row.algorithmVersion,
    });
    if (evidenceRefs.length === 0) continue;
    if (row.patternKey === 'validation-missing'
        && !hasExplicitNoValidationEvidence(db, task.rootTaskId, evidenceRefs)) continue;
    seen.add(issueKey);
    suggestions.push({
      issueKey,
      sourceCategory: 'deterministic',
      ...definition,
      confidence: row.confidence,
      coverage: row.coverage,
      evidenceRefs,
      muted,
    });
  }
  if (suggestions.length < limit) {
    const coverageRow = db.prepare(`SELECT
        COALESCE(SUM(parsed_count - unknown_count), 0) AS known,
        COALESCE(SUM(parsed_count + skipped_count + failed_count), 0) AS total
      FROM source_ingestion_stats WHERE source_artifact_id IN (
        SELECT DISTINCT event.source_artifact_id
        FROM canonical_events event JOIN work_tasks node ON node.id = event.task_id
        WHERE node.root_task_id = ?
      )`).get(task.rootTaskId) as { known: number; total: number };
    const taskCoverage = coverageRow.total > 0
      ? Math.max(0, Math.min(1, coverageRow.known / coverageRow.total))
      : 1;
    for (const observation of observeTaskPatterns(db, task.rootTaskId)) {
      if (suggestions.length >= limit) break;
      const definition = DETERMINISTIC_ADVICE[observation.pattern];
      const issueKey = `pattern:${observation.pattern}`;
      if (seen.has(issueKey)) continue;
      const muted = Boolean(db.prepare(`SELECT 1 FROM advisory_mutes
        WHERE ((scope_kind = 'issue' AND scope_key = ?)
          OR (scope_kind = 'category' AND scope_key = 'deterministic'))
          AND (muted_until IS NULL OR muted_until > ?) LIMIT 1`).get(issueKey, normalizedNow));
      if (muted && !input.includeMuted) continue;
      const recentlyShown = db.prepare(`SELECT 1 FROM advisory_events
        WHERE task_id = ? AND issue_key = ? AND action = 'shown' AND occurred_at > ? LIMIT 1`)
        .get(task.rootTaskId, issueKey, cooldownBoundary);
      if (recentlyShown) continue;
      seen.add(issueKey);
      suggestions.push({
        issueKey,
        sourceCategory: 'deterministic',
        ...definition,
        confidence: Math.min(0.9, taskCoverage * (0.6 + Math.min(0.3, observation.evidenceRefs.length * 0.05))),
        coverage: taskCoverage,
        evidenceRefs: observation.evidenceRefs.slice(0, 10),
        muted,
      });
    }
  }
  return { status: 'ok', taskId: input.taskId, suggestions, diagnostics: [] };
}
