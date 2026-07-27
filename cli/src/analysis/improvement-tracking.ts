import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { getDb } from '../db/client.js';
import { recordAnalysisRun } from './analysis-run-db.js';
import { createAnalysisRunnerFromPolicy } from './runner-factory.js';
import type { AnalysisRunner, RunAnalysisResult } from './runner-types.js';

export const IMPROVEMENT_PLAN_PROMPT_VERSION = 'improvement-plan-v1';
export const IMPROVEMENT_OBSERVATION_PROMPT_VERSION = 'improvement-observation-v1';
export const IMPROVEMENT_REVIEW_PROMPT_VERSION = 'improvement-review-v1';

const stringArray = { type: 'array', items: { type: 'string' } } as const;
const PLAN_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    hypothesis: { type: 'string' },
    applicability: { type: 'string' },
    eligibleTasks: { type: 'string' },
    observableOutcome: { type: 'string' },
    guardrail: { type: 'string' },
    reviewWhen: { type: 'string' },
    overlapWithPlanIds: stringArray,
    sequencingReason: { type: 'string' },
  },
};
const OBSERVATION_SCHEMA = {
  type: 'object',
  properties: {
    observations: {
      type: 'array',
      maxItems: 3,
      items: {
        type: 'object',
        properties: {
          planId: { type: 'string' },
          eligible: { type: 'boolean' },
          adoption: { type: 'string', enum: ['observed', 'not-observed', 'unknown'] },
          counterEvidence: { type: 'boolean' },
          negativeImpact: { type: 'boolean' },
          reviewReady: { type: 'boolean' },
          rationale: { type: 'string' },
          evidenceRefs: stringArray,
        },
      },
    },
  },
};
const REVIEW_SCHEMA = {
  type: 'object',
  properties: {
    outcome: {
      type: 'string',
      enum: ['improved', 'no-clear-improvement', 'insufficient-evidence', 'negative-impact'],
    },
    rationale: { type: 'string' },
    supportingRefs: stringArray,
    opposingRefs: stringArray,
    limitations: stringArray,
  },
};

const PLAN_SYSTEM_PROMPT = `You turn one current evidence-supported public practice into a bounded personal improvement plan.
Use the supplied local analysis only to judge applicability. External evidence does not prove personal effect.
Define the applicable tasks, observable outcome, safety guardrail, and review condition in your own words.
Compare active plans semantically and report actual overlap; do not use keyword rules. If plans overlap, explain sequencing.
The system will cap observation at 30 eligible tasks or 45 days, whichever comes first. Return only schema-valid JSON.`;

const OBSERVATION_SYSTEM_PROMPT = `You independently assess whether a completed coding-agent task is relevant to active
improvement plans and whether the summarized evidence shows adoption, counter-evidence, or negative impact.
Do not infer from missing evidence. Use only supplied evidence references. Decide reviewReady from each plan's own
LLM-defined review condition and accumulated evidence. The system separately forces readiness after 30 eligible tasks
or 45 days. Return only schema-valid JSON.`;

const REVIEW_SYSTEM_PROMPT = `You independently review one personal improvement plan from its frozen basis, observation
records, and user corrections. Choose exactly one outcome: improved, no-clear-improvement, insufficient-evidence, or
negative-impact. Separate supporting and opposing evidence, preserve uncertainty, and never treat public evidence as
proof of local effect. Use only supplied references. Return only schema-valid JSON.`;

interface PlanRow {
  id: string;
  title: string;
  hypothesis: string;
  applicability: string;
  reviewPlanJson: string;
  status: 'queued' | 'observing' | 'review-ready' | 'reviewed' | 'paused' | 'ended';
  sequence: number;
  matchedTaskCount: number;
  adoptionSignalCount: number;
  maxTaskCount: number;
  maxObservationDays: number;
  createdAt: string;
}

function parseObject<T>(rawJson: string, label: string): T {
  const parsed = JSON.parse(rawJson) as unknown;
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${label} must be a JSON object`);
  }
  return parsed as T;
}

function runner(options?: { runner?: AnalysisRunner }): AnalysisRunner {
  return options?.runner ?? createAnalysisRunnerFromPolicy().runner;
}

function activePlanRows(db: Database.Database): PlanRow[] {
  return db.prepare(`SELECT id, title, hypothesis, applicability,
      review_plan_json AS reviewPlanJson, status, sequence,
      matched_task_count AS matchedTaskCount,
      adoption_signal_count AS adoptionSignalCount,
      max_task_count AS maxTaskCount,
      max_observation_days AS maxObservationDays,
      created_at AS createdAt
    FROM improvement_plans
    WHERE status IN ('queued', 'observing', 'review-ready')
    ORDER BY sequence, created_at, id`).all() as PlanRow[];
}

function usage(result: RunAnalysisResult) {
  return {
    provider: result.provider,
    model: result.model,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    durationMs: result.durationMs,
  };
}

export async function createImprovementPlanFromPractice(options: {
  practiceId: string;
  runner?: AnalysisRunner;
  db?: Database.Database;
}): Promise<{ id: string; status: 'queued' | 'observing' }> {
  const db = options.db ?? getDb();
  const practice = db.prepare(`SELECT practice.id, practice.snapshot_id AS snapshotId,
      practice.title, practice.summary, practice.applicability,
      practice.source_trust AS sourceTrust,
      practice.discussion_breadth AS discussionBreadth, practice.recency,
      practice.local_relevance AS localRelevance, practice.rationale,
      practice.source_refs_json AS sourceRefsJson,
      practice.conflicts_json AS conflictsJson
    FROM knowledge_practices practice WHERE practice.id = ?`).get(options.practiceId) as {
      id: string; snapshotId: string; title: string; summary: string; applicability: string;
      sourceTrust: string; discussionBreadth: string; recency: string; localRelevance: string;
      rationale: string; sourceRefsJson: string; conflictsJson: string;
    } | undefined;
  if (!practice) throw new Error('Knowledge practice not found');
  const active = activePlanRows(db);
  if (active.length >= 3) throw new Error('At most three active improvement plans are allowed');
  const latestReport = db.prepare(`SELECT id, output_json AS outputJson
    FROM analysis_runs WHERE analysis_type = 'behavior_report' AND status = 'completed'
      AND output_json IS NOT NULL ORDER BY created_at DESC, id DESC LIMIT 1`).get() as {
        id: string; outputJson: string;
      } | undefined;
  const input = {
    practice: {
      ...practice,
      sourceRefs: JSON.parse(practice.sourceRefsJson) as unknown,
      conflicts: JSON.parse(practice.conflictsJson) as unknown,
      sourceRefsJson: undefined,
      conflictsJson: undefined,
    },
    currentLocalAnalysis: latestReport ? JSON.parse(latestReport.outputJson) as unknown : null,
    activePlans: active.map((plan) => ({
      id: plan.id,
      title: plan.title,
      hypothesis: plan.hypothesis,
      applicability: plan.applicability,
      reviewPlan: JSON.parse(plan.reviewPlanJson) as unknown,
      status: plan.status,
      sequence: plan.sequence,
    })),
    systemLimit: { maxEligibleTasks: 30, maxObservationDays: 45, stopAtFirstLimit: true },
  };
  const inputPrompt = JSON.stringify(input);
  const result = await runner(options).runAnalysis({
    systemPrompt: PLAN_SYSTEM_PROMPT,
    userPrompt: inputPrompt,
    jsonSchema: PLAN_SCHEMA,
  });
  const output = parseObject<{
    title: string; hypothesis: string; applicability: string; eligibleTasks: string;
    observableOutcome: string; guardrail: string; reviewWhen: string;
    overlapWithPlanIds: string[]; sequencingReason: string;
  }>(result.rawJson, 'Improvement plan output');
  const activeIds = new Set(active.map((plan) => plan.id));
  if (!Array.isArray(output.overlapWithPlanIds)
      || output.overlapWithPlanIds.some((id) => !activeIds.has(id))) {
    throw new Error('Improvement plan returned invalid overlap references');
  }
  const planRunId = recordAnalysisRun({
    analysisType: 'improvement_plan',
    status: 'completed',
    ...usage(result),
    promptVersion: IMPROVEMENT_PLAN_PROMPT_VERSION,
    systemPrompt: PLAN_SYSTEM_PROMPT,
    inputPrompt,
    inputSummary: {
      practiceId: practice.id,
      snapshotId: practice.snapshotId,
      activePlanCount: active.length,
    },
    outputJson: result.rawJson,
  }, db);
  const id = `improvement-plan:${randomUUID()}`;
  const status = output.overlapWithPlanIds.length > 0 ? 'queued' as const : 'observing' as const;
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO improvement_plans (
    id, source_practice_id, knowledge_snapshot_id, report_run_id,
    title, hypothesis, applicability, review_plan_json, status, sequence,
    max_task_count, max_observation_days, created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 30, 45, ?, ?)`).run(
    id, practice.id, practice.snapshotId, planRunId,
    output.title, output.hypothesis, output.applicability,
    JSON.stringify({
      version: 'improvement-review-plan-v1',
      llmDefined: {
        eligibleTasks: output.eligibleTasks,
        observableOutcome: output.observableOutcome,
        guardrail: output.guardrail,
        reviewWhen: output.reviewWhen,
        overlapWithPlanIds: output.overlapWithPlanIds,
        sequencingReason: output.sequencingReason,
      },
      systemLimit: {
        maxEligibleTasks: 30,
        maxObservationDays: 45,
        stopAtFirstLimit: true,
        explanation: '系统只执行安全上限，适用性和复盘条件由 LLM 判断。',
      },
    }),
    status,
    active.length + 1,
    now,
    now,
  );
  return { id, status };
}

function taskPacket(db: Database.Database, taskId: string) {
  const task = db.prepare(`SELECT id, root_task_id AS rootTaskId, role, status,
      started_at AS startedAt, ended_at AS endedAt
    FROM work_tasks WHERE id = ? AND id = root_task_id`).get(taskId) as {
      id: string; rootTaskId: string; role: string; status: string;
      startedAt: string; endedAt: string | null;
    } | undefined;
  if (!task) throw new Error('Root task not found');
  const eventKinds = db.prepare(`SELECT event.kind, COUNT(*) AS count
    FROM canonical_events event JOIN work_tasks work ON work.id = event.task_id
    WHERE work.root_task_id = ? GROUP BY event.kind ORDER BY count DESC, event.kind
    LIMIT 30`).all(taskId) as Array<{ kind: string; count: number }>;
  const tokens = db.prepare(`SELECT
      COALESCE(SUM(input_tokens), 0) AS inputTokens,
      COALESCE(SUM(cached_input_tokens), 0) AS cachedInputTokens,
      COALESCE(SUM(cache_creation_tokens), 0) AS cacheCreationTokens,
      COALESCE(SUM(output_tokens), 0) AS outputTokens
    FROM task_token_deltas delta JOIN work_tasks work ON work.id = delta.task_id
    WHERE work.root_task_id = ? AND delta.status = 'known'`).get(taskId) as Record<string, number>;
  const claims = db.prepare(`SELECT claim.id, detail.title, detail.summary,
      detail.expected_benefit AS expectedBenefit, detail.verification,
      run.id AS runId, run.input_coverage AS inputCoverage
    FROM semantic_claim_details detail
    JOIN analysis_claims claim ON claim.id = detail.claim_id
    JOIN semantic_analysis_runs run ON run.id = detail.run_id
    WHERE run.task_id = ? AND run.status = 'accepted'
    ORDER BY run.created_at DESC, claim.id LIMIT 20`).all(taskId);
  return { task, eventKinds, tokens, semanticClaims: claims };
}

export async function observeTaskAgainstImprovementPlans(options: {
  taskId: string;
  runner?: AnalysisRunner;
  db?: Database.Database;
  now?: Date;
}): Promise<{ observed: number; reviewReady: string[] }> {
  const db = options.db ?? getDb();
  const now = options.now ?? new Date();
  const plans = activePlanRows(db).filter((plan) => plan.status === 'observing');
  if (plans.length === 0) return { observed: 0, reviewReady: [] };
  const alreadyObserved = new Set((db.prepare(`SELECT plan_id AS planId
    FROM improvement_observations WHERE task_id = ? AND signal = 'eligible'`)
    .all(options.taskId) as Array<{ planId: string }>).map((row) => row.planId));
  const candidates = plans.filter((plan) => !alreadyObserved.has(plan.id));
  if (candidates.length === 0) return { observed: 0, reviewReady: [] };
  const packet = taskPacket(db, options.taskId);
  const allowedRefs = new Set<string>([
    options.taskId,
    ...packet.semanticClaims.flatMap((claim) => {
      const value = claim as { id?: unknown; runId?: unknown };
      return [value.id, value.runId].filter((ref): ref is string => typeof ref === 'string');
    }),
  ]);
  const input = {
    task: packet,
    plans: candidates.map((plan) => ({
      ...plan,
      reviewPlan: JSON.parse(plan.reviewPlanJson) as unknown,
      ageDays: Math.max(0, (now.getTime() - Date.parse(plan.createdAt)) / 86_400_000),
    })),
  };
  const inputPrompt = JSON.stringify(input);
  const result = await runner(options).runAnalysis({
    systemPrompt: OBSERVATION_SYSTEM_PROMPT,
    userPrompt: inputPrompt,
    jsonSchema: OBSERVATION_SCHEMA,
  });
  const output = parseObject<{ observations: Array<{
    planId: string; eligible: boolean; adoption: 'observed' | 'not-observed' | 'unknown';
    counterEvidence: boolean; negativeImpact: boolean; reviewReady: boolean;
    rationale: string; evidenceRefs: string[];
  }> }>(result.rawJson, 'Improvement observation output');
  const candidateIds = new Set(candidates.map((plan) => plan.id));
  if (!Array.isArray(output.observations)
      || output.observations.some((item) => !candidateIds.has(item.planId)
        || !Array.isArray(item.evidenceRefs)
        || item.evidenceRefs.some((ref) => !allowedRefs.has(ref)))) {
    throw new Error('Improvement observation returned invalid evidence references');
  }
  const runId = recordAnalysisRun({
    analysisType: 'improvement_observation',
    status: 'completed',
    ...usage(result),
    promptVersion: IMPROVEMENT_OBSERVATION_PROMPT_VERSION,
    systemPrompt: OBSERVATION_SYSTEM_PROMPT,
    inputPrompt,
    inputSummary: { taskId: options.taskId, planIds: candidates.map((plan) => plan.id) },
    outputJson: result.rawJson,
  }, db);
  const insert = db.prepare(`INSERT OR IGNORE INTO improvement_observations (
    id, plan_id, task_id, signal, rationale, evidence_refs_json, analysis_run_id, created_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
  const ready = new Set<string>();
  db.transaction(() => {
    output.observations.forEach((observation) => {
      if (!observation.eligible) return;
      const refs = JSON.stringify(observation.evidenceRefs);
      insert.run(`improvement-observation:${randomUUID()}`, observation.planId, options.taskId,
        'eligible', observation.rationale, refs, runId, now.toISOString());
      const signals: string[] = [];
      if (observation.adoption === 'observed') signals.push('adoption-observed');
      if (observation.adoption === 'not-observed') signals.push('adoption-not-observed');
      if (observation.counterEvidence) signals.push('counter-evidence');
      if (observation.negativeImpact) signals.push('negative-impact');
      signals.forEach((signal) => insert.run(
        `improvement-observation:${randomUUID()}`, observation.planId, options.taskId,
        signal, observation.rationale, refs, runId, now.toISOString(),
      ));
      db.prepare(`UPDATE improvement_plans SET
        matched_task_count = matched_task_count + 1,
        adoption_signal_count = adoption_signal_count + ?,
        updated_at = ? WHERE id = ?`).run(
        observation.adoption === 'observed' ? 1 : 0,
        now.toISOString(),
        observation.planId,
      );
      const plan = candidates.find((candidate) => candidate.id === observation.planId)!;
      const ageDays = (now.getTime() - Date.parse(plan.createdAt)) / 86_400_000;
      const matched = plan.matchedTaskCount + 1;
      if (observation.reviewReady || matched >= plan.maxTaskCount || ageDays >= plan.maxObservationDays) {
        db.prepare(`UPDATE improvement_plans SET status = 'review-ready', updated_at = ?
          WHERE id = ? AND status = 'observing'`).run(now.toISOString(), observation.planId);
        ready.add(observation.planId);
      }
    });
  })();
  return { observed: output.observations.filter((item) => item.eligible).length, reviewReady: [...ready] };
}

export async function reviewImprovementPlan(options: {
  planId: string;
  runner?: AnalysisRunner;
  db?: Database.Database;
}): Promise<{ reviewId: string; outcome: string }> {
  const db = options.db ?? getDb();
  const plan = db.prepare(`SELECT id, title, hypothesis, applicability,
      review_plan_json AS reviewPlanJson, status, matched_task_count AS matchedTaskCount,
      adoption_signal_count AS adoptionSignalCount, created_at AS createdAt
    FROM improvement_plans WHERE id = ?`).get(options.planId) as Record<string, unknown> | undefined;
  if (!plan) throw new Error('Improvement plan not found');
  const observations = db.prepare(`SELECT id, task_id AS taskId, signal, rationale,
      evidence_refs_json AS evidenceRefsJson, created_at AS createdAt
    FROM improvement_observations WHERE plan_id = ?
    ORDER BY created_at, id LIMIT 120`).all(options.planId);
  const feedback = db.prepare(`SELECT id, kind, note, created_at AS createdAt
    FROM improvement_feedback WHERE plan_id = ? ORDER BY created_at, id`).all(options.planId);
  const input = { plan, observations, feedback };
  const inputPrompt = JSON.stringify(input);
  const result = await runner(options).runAnalysis({
    systemPrompt: REVIEW_SYSTEM_PROMPT,
    userPrompt: inputPrompt,
    jsonSchema: REVIEW_SCHEMA,
  });
  const output = parseObject<{
    outcome: 'improved' | 'no-clear-improvement' | 'insufficient-evidence' | 'negative-impact';
    rationale: string; supportingRefs: string[]; opposingRefs: string[]; limitations: string[];
  }>(result.rawJson, 'Improvement review output');
  const allowedRefs = new Set<string>([
    options.planId,
    ...observations.flatMap((row) => {
      const value = row as { id?: unknown; taskId?: unknown };
      return [value.id, value.taskId].filter((ref): ref is string => typeof ref === 'string');
    }),
    ...feedback.flatMap((row) => {
      const value = row as { id?: unknown };
      return typeof value.id === 'string' ? [value.id] : [];
    }),
  ]);
  if ([...output.supportingRefs, ...output.opposingRefs].some((ref) => !allowedRefs.has(ref))) {
    throw new Error('Improvement review returned invalid evidence references');
  }
  const runId = recordAnalysisRun({
    analysisType: 'improvement_review',
    status: 'completed',
    ...usage(result),
    promptVersion: IMPROVEMENT_REVIEW_PROMPT_VERSION,
    systemPrompt: REVIEW_SYSTEM_PROMPT,
    inputPrompt,
    inputSummary: { planId: options.planId, observationCount: observations.length, feedbackCount: feedback.length },
    outputJson: result.rawJson,
  }, db);
  const reviewId = `improvement-review:${randomUUID()}`;
  db.transaction(() => {
    db.prepare(`INSERT INTO improvement_reviews (
      id, plan_id, outcome, rationale, supporting_refs_json, opposing_refs_json,
      limitations_json, analysis_run_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
      reviewId, options.planId, output.outcome, output.rationale,
      JSON.stringify(output.supportingRefs), JSON.stringify(output.opposingRefs),
      JSON.stringify(output.limitations), runId,
    );
    db.prepare(`UPDATE improvement_plans SET status = 'reviewed', updated_at = datetime('now')
      WHERE id = ?`).run(options.planId);
    const next = db.prepare(`SELECT id FROM improvement_plans WHERE status = 'queued'
      ORDER BY sequence, created_at, id LIMIT 1`).get() as { id: string } | undefined;
    if (next) {
      db.prepare(`UPDATE improvement_plans SET status = 'observing', updated_at = datetime('now')
        WHERE id = ?`).run(next.id);
    }
  })();
  return { reviewId, outcome: output.outcome };
}
