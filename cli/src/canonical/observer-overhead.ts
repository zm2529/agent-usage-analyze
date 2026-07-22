import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';

export type ObserverOverheadCategory = 'import' | 'llm' | 'sidecar' | 'advisory';
export type AdvisoryAction = 'shown' | 'adopted' | 'ignored' | 'dismissed';

interface ObserverOverheadBase {
  observerRunId: string;
  analyzedTaskId?: string;
  evidenceRefs: string[];
}

export type ObserverOverheadInput = ObserverOverheadBase & (
  | {
    category: 'import';
    cpuMs?: number;
    wallMs?: number;
    dbBytesDelta?: number;
  }
  | {
    category: 'llm';
    wallMs?: number;
    inputTokens?: number;
    cachedInputTokens?: number;
    outputTokens?: number;
    reasoningTokens?: number;
    provider?: string;
    model?: string;
    costUsd?: number | null;
  }
  | {
    category: 'sidecar';
    cpuMs?: number;
    wallMs?: number;
    sidecarMs: number;
  }
  | {
    category: 'advisory';
    wallMs?: number;
    advisoryAction: AdvisoryAction;
  }
);

interface ObserverOverheadFields extends ObserverOverheadBase {
  category: ObserverOverheadCategory;
  cpuMs?: number;
  wallMs?: number;
  dbBytesDelta?: number;
  inputTokens?: number;
  cachedInputTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
  provider?: string;
  model?: string;
  costUsd?: number | null;
  sidecarMs?: number;
  advisoryAction?: AdvisoryAction;
}

export interface ObserverOverheadSummary {
  eventCount: number;
  degraded: boolean;
  diagnostics: Array<{
    id: string; category: ObserverOverheadCategory; observerRunId: string;
    code: 'observer-write-failed' | 'observer-measurement-failed'; occurredAt: string;
  }>;
  totals: {
    cpuMs: number; wallMs: number; dbBytesDelta: number; inputTokens: number | null;
    cachedInputTokens: number | null; outputTokens: number | null;
    reasoningTokens: number | null; costUsd: number | null; sidecarMs: number;
  };
  advisory: Record<AdvisoryAction, number>;
  byCategory: Array<{ category: ObserverOverheadCategory; eventCount: number; wallMs: number }>;
  recentEvents: Array<ObserverOverheadFields & { id: string; occurredAt: string; subjectKind: 'observer' }>;
}

const CATEGORIES = new Set<ObserverOverheadCategory>(['import', 'llm', 'sidecar', 'advisory']);
const ACTIONS = new Set<AdvisoryAction>(['shown', 'adopted', 'ignored', 'dismissed']);
const ALLOWED_KEYS = ['category', 'observerRunId', 'analyzedTaskId', 'cpuMs', 'wallMs', 'dbBytesDelta',
  'inputTokens', 'cachedInputTokens', 'outputTokens', 'reasoningTokens', 'costUsd',
  'provider', 'model', 'sidecarMs', 'advisoryAction', 'evidenceRefs'];

function assertString(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || value.length < 1 || value.length > 256 || value.includes('\n')) {
    throw new Error(`${label} must be a non-empty bounded string`);
  }
}

function assertMetric(value: unknown, label: string, integer = false): void {
  if (value === undefined || value === null) return;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || (integer && !Number.isSafeInteger(value))) {
    throw new Error(`${label} must be non-negative${integer ? ' integer' : ''}`);
  }
}

export function recordObserverOverhead(db: Database.Database, input: ObserverOverheadInput): string {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) throw new Error('Observer overhead must be an object');
  const unsupported = Object.keys(input).find((key) => !ALLOWED_KEYS.includes(key));
  if (unsupported) throw new Error(`Observer overhead contains unsupported field: ${unsupported}`);
  const value = input as ObserverOverheadFields;
  if (!CATEGORIES.has(value.category)) throw new Error('Unsupported observer overhead category');
  const categoryKeys: Record<ObserverOverheadCategory, string[]> = {
    import: ['cpuMs', 'wallMs', 'dbBytesDelta'],
    llm: [
      'wallMs', 'inputTokens', 'cachedInputTokens', 'outputTokens', 'reasoningTokens',
      'provider', 'model', 'costUsd',
    ],
    sidecar: ['cpuMs', 'wallMs', 'sidecarMs'],
    advisory: ['wallMs', 'advisoryAction'],
  };
  const categoryUnsupported = Object.keys(value).find((key) =>
    !['category', 'observerRunId', 'analyzedTaskId', 'evidenceRefs', ...categoryKeys[value.category]].includes(key));
  if (categoryUnsupported) throw new Error(`${value.category} overhead contains unsupported field: ${categoryUnsupported}`);
  assertString(value.observerRunId, 'Observer run id');
  if (value.analyzedTaskId !== undefined) assertString(value.analyzedTaskId, 'Analyzed task id');
  assertMetric(value.cpuMs, 'CPU milliseconds');
  assertMetric(value.wallMs, 'Wall milliseconds');
  assertMetric(value.dbBytesDelta, 'Database byte growth', true);
  assertMetric(value.inputTokens, 'Input tokens', true);
  assertMetric(value.cachedInputTokens, 'Cached input tokens', true);
  assertMetric(value.outputTokens, 'Output tokens', true);
  assertMetric(value.reasoningTokens, 'Reasoning tokens', true);
  if (value.provider !== undefined) assertString(value.provider, 'LLM provider');
  if (value.model !== undefined) assertString(value.model, 'LLM model');
  assertMetric(value.costUsd, 'Cost');
  assertMetric(value.sidecarMs, 'Sidecar milliseconds');
  if (value.category === 'sidecar' && value.sidecarMs === undefined) throw new Error('Sidecar milliseconds are required');
  if (value.category === 'advisory' && (value.advisoryAction === undefined || !ACTIONS.has(value.advisoryAction))) {
    throw new Error('Supported advisory action is required');
  }
  if (!Array.isArray(value.evidenceRefs) || value.evidenceRefs.length === 0) throw new Error('Observer overhead requires evidence refs');
  value.evidenceRefs.forEach((ref, index) => {
    assertString(ref, `Evidence ref ${index}`);
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(ref)) throw new Error('Evidence refs must be opaque identifiers');
  });
  const id = `observer-overhead:${randomUUID()}`;
  db.prepare(`INSERT INTO observer_overhead_events (
    id, category, observer_run_id, analyzed_task_id, cpu_ms, wall_ms, db_bytes_delta,
    input_tokens, cached_input_tokens, output_tokens, reasoning_tokens, cost_usd,
    llm_provider, llm_model, sidecar_ms, advisory_action, evidence_refs_json
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    id, value.category, value.observerRunId, value.analyzedTaskId ?? null, value.cpuMs ?? null,
    value.wallMs ?? null, value.dbBytesDelta ?? null, value.inputTokens ?? null,
    value.cachedInputTokens ?? null, value.outputTokens ?? null, value.reasoningTokens ?? null,
    value.costUsd ?? null, value.provider ?? null, value.model ?? null, value.sidecarMs ?? null,
    value.advisoryAction ?? null, JSON.stringify(value.evidenceRefs),
  );
  return id;
}

/** Observer accounting must never change the primary operation's result. */
export function tryRecordObserverOverhead(db: Database.Database, input: ObserverOverheadInput): boolean {
  try {
    recordObserverOverhead(db, input);
    return true;
  } catch {
    recordObserverOverheadDiagnostic(db, {
      category: input.category,
      observerRunId: input.observerRunId,
      code: 'observer-write-failed',
    });
    return false;
  }
}

export function recordObserverOverheadDiagnostic(
  db: Database.Database,
  input: {
    category: ObserverOverheadCategory;
    observerRunId: string;
    code: 'observer-write-failed' | 'observer-measurement-failed';
  },
): boolean {
  try {
    if (!CATEGORIES.has(input.category)) return false;
    assertString(input.observerRunId, 'Observer run id');
    db.prepare(`INSERT INTO observer_overhead_diagnostics
      (id, category, observer_run_id, code) VALUES (?, ?, ?, ?)`)
      .run(`observer-diagnostic:${randomUUID()}`, input.category, input.observerRunId, input.code);
    return true;
  } catch {
    return false;
  }
}

interface OverheadRow {
  id: string; subjectKind: 'observer'; category: ObserverOverheadCategory; observerRunId: string;
  analyzedTaskId: string | null; cpuMs: number | null; wallMs: number | null;
  dbBytesDelta: number | null; inputTokens: number | null; cachedInputTokens: number | null;
  outputTokens: number | null; reasoningTokens: number | null;
  provider: string | null; model: string | null; costUsd: number | null;
  sidecarMs: number | null; advisoryAction: AdvisoryAction | null;
  evidenceRefsJson: string; occurredAt: string;
}

export function readObserverOverhead(db: Database.Database): ObserverOverheadSummary {
  const rows = db.prepare(`SELECT id, subject_kind AS subjectKind, category,
    observer_run_id AS observerRunId, analyzed_task_id AS analyzedTaskId, cpu_ms AS cpuMs,
    wall_ms AS wallMs, db_bytes_delta AS dbBytesDelta, input_tokens AS inputTokens,
    cached_input_tokens AS cachedInputTokens, output_tokens AS outputTokens,
    reasoning_tokens AS reasoningTokens, llm_provider AS provider, llm_model AS model,
    cost_usd AS costUsd, sidecar_ms AS sidecarMs,
    advisory_action AS advisoryAction, evidence_refs_json AS evidenceRefsJson,
    occurred_at AS occurredAt FROM observer_overhead_events ORDER BY occurred_at DESC, id DESC`).all() as OverheadRow[];
  const totals: ObserverOverheadSummary['totals'] = {
    cpuMs: 0, wallMs: 0, dbBytesDelta: 0, inputTokens: 0, cachedInputTokens: 0,
    outputTokens: 0, reasoningTokens: 0, costUsd: 0, sidecarMs: 0,
  };
  const advisory: Record<AdvisoryAction, number> = { shown: 0, adopted: 0, ignored: 0, dismissed: 0 };
  const byCategory = new Map<ObserverOverheadCategory, { eventCount: number; wallMs: number }>();
  let unknownLlmCost = false;
  let unknownInputTokens = false;
  let unknownCachedInputTokens = false;
  let unknownOutputTokens = false;
  let unknownReasoningTokens = false;
  let inputTokenTotal = 0;
  let cachedInputTokenTotal = 0;
  let outputTokenTotal = 0;
  let reasoningTokenTotal = 0;
  for (const row of rows) {
    totals.cpuMs += row.cpuMs ?? 0;
    totals.wallMs += row.wallMs ?? 0;
    totals.dbBytesDelta += row.dbBytesDelta ?? 0;
    if (row.category === 'llm') {
      if (row.inputTokens === null) unknownInputTokens = true;
      else inputTokenTotal += row.inputTokens;
      if (row.cachedInputTokens === null) unknownCachedInputTokens = true;
      else cachedInputTokenTotal += row.cachedInputTokens;
      if (row.outputTokens === null) unknownOutputTokens = true;
      else outputTokenTotal += row.outputTokens;
      if (row.reasoningTokens === null) unknownReasoningTokens = true;
      else reasoningTokenTotal += row.reasoningTokens;
    }
    totals.sidecarMs += row.sidecarMs ?? 0;
    if (row.category === 'llm' && row.costUsd === null) unknownLlmCost = true;
    else if (row.costUsd !== null && totals.costUsd !== null) totals.costUsd += row.costUsd;
    if (row.advisoryAction) advisory[row.advisoryAction] += 1;
    const category = byCategory.get(row.category) ?? { eventCount: 0, wallMs: 0 };
    category.eventCount += 1;
    category.wallMs += row.wallMs ?? 0;
    byCategory.set(row.category, category);
  }
  if (unknownLlmCost) totals.costUsd = null;
  totals.inputTokens = unknownInputTokens ? null : inputTokenTotal;
  totals.cachedInputTokens = unknownCachedInputTokens ? null : cachedInputTokenTotal;
  totals.outputTokens = unknownOutputTokens ? null : outputTokenTotal;
  totals.reasoningTokens = unknownReasoningTokens ? null : reasoningTokenTotal;
  const diagnostics = db.prepare(`SELECT id, category, observer_run_id AS observerRunId,
    code, occurred_at AS occurredAt FROM observer_overhead_diagnostics
    ORDER BY occurred_at DESC, id DESC LIMIT 50`).all() as ObserverOverheadSummary['diagnostics'];
  return {
    eventCount: rows.length, degraded: diagnostics.length > 0, diagnostics, totals, advisory,
    byCategory: [...byCategory.entries()].map(([category, value]) => ({ category, ...value })),
    recentEvents: rows.slice(0, 50).map((row) => ({
      id: row.id, subjectKind: row.subjectKind, category: row.category,
      observerRunId: row.observerRunId, analyzedTaskId: row.analyzedTaskId ?? undefined,
      cpuMs: row.cpuMs ?? undefined, wallMs: row.wallMs ?? undefined,
      dbBytesDelta: row.dbBytesDelta ?? undefined, inputTokens: row.inputTokens ?? undefined,
      cachedInputTokens: row.cachedInputTokens ?? undefined,
      outputTokens: row.outputTokens ?? undefined, reasoningTokens: row.reasoningTokens ?? undefined,
      provider: row.provider ?? undefined, model: row.model ?? undefined, costUsd: row.costUsd,
      sidecarMs: row.sidecarMs ?? undefined, advisoryAction: row.advisoryAction ?? undefined,
      evidenceRefs: JSON.parse(row.evidenceRefsJson) as string[], occurredAt: row.occurredAt,
    })),
  };
}
