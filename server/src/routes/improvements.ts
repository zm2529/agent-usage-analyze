import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import { getDb } from 'agent-usage-analyze/db/client';
import { BEHAVIOR_REPORT_PROMPT_VERSION } from 'agent-usage-analyze/analysis/behavior-report';
import {
  createImprovementPlanFromPractice,
  reviewImprovementPlan,
} from 'agent-usage-analyze/analysis/improvement-tracking';

const app = new Hono();

const generation = {
  running: false,
  action: null as 'create-plan' | 'review' | null,
  subjectId: null as string | null,
  startedAt: null as string | null,
  lastError: null as string | null,
};

function json<T>(raw: string, fallback: T): T {
  try { return JSON.parse(raw) as T; } catch { return fallback; }
}

function readPlans() {
  const db = getDb();
  const latestKnowledge = db.prepare(`SELECT id, created_at AS createdAt
    FROM knowledge_snapshots WHERE status = 'completed'
    ORDER BY created_at DESC, id DESC LIMIT 1`).get() as {
      id: string; createdAt: string;
    } | undefined;
  const rows = db.prepare(`SELECT plan.id, plan.source_practice_id AS sourcePracticeId,
      plan.knowledge_snapshot_id AS knowledgeSnapshotId, plan.report_run_id AS reportRunId,
      plan.title, plan.hypothesis, plan.applicability,
      plan.review_plan_json AS reviewPlanJson, plan.status, plan.sequence,
      plan.matched_task_count AS matchedTaskCount,
      plan.adoption_signal_count AS adoptionSignalCount,
      plan.max_task_count AS maxTaskCount,
      plan.max_observation_days AS maxObservationDays,
      plan.evidence_cutoff AS evidenceCutoff,
      plan.created_at AS createdAt, plan.updated_at AS updatedAt,
      practice.title AS sourcePracticeTitle,
      snapshot.created_at AS knowledgeSnapshotCreatedAt
    FROM improvement_plans plan
    LEFT JOIN knowledge_practices practice ON practice.id = plan.source_practice_id
    LEFT JOIN knowledge_snapshots snapshot ON snapshot.id = plan.knowledge_snapshot_id
    ORDER BY CASE plan.status
      WHEN 'observing' THEN 0 WHEN 'review-ready' THEN 1 WHEN 'queued' THEN 2
      WHEN 'paused' THEN 3 WHEN 'reviewed' THEN 4 ELSE 5 END,
      plan.sequence, plan.created_at DESC`).all() as Array<{
        id: string; sourcePracticeId: string | null; knowledgeSnapshotId: string | null;
        reportRunId: string | null; title: string; hypothesis: string; applicability: string;
        reviewPlanJson: string; status: string; sequence: number; matchedTaskCount: number;
        adoptionSignalCount: number; maxTaskCount: number; maxObservationDays: number;
        evidenceCutoff: string | null; createdAt: string; updatedAt: string;
        sourcePracticeTitle: string | null; knowledgeSnapshotCreatedAt: string | null;
      }>;
  return rows.map(({ reviewPlanJson, ...row }) => {
    const observations = db.prepare(`SELECT id, task_id AS taskId, signal, rationale,
        evidence_refs_json AS evidenceRefsJson, analysis_run_id AS analysisRunId,
        created_at AS createdAt
      FROM improvement_observations WHERE plan_id = ?
      ORDER BY created_at DESC, id DESC LIMIT 60`).all(row.id) as Array<{
        id: string; taskId: string; signal: string; rationale: string;
        evidenceRefsJson: string; analysisRunId: string | null; createdAt: string;
      }>;
    const reviews = db.prepare(`SELECT id, outcome, rationale,
        supporting_refs_json AS supportingRefsJson,
        opposing_refs_json AS opposingRefsJson,
        limitations_json AS limitationsJson, analysis_run_id AS analysisRunId,
        created_at AS createdAt
      FROM improvement_reviews WHERE plan_id = ?
      ORDER BY created_at DESC, id DESC`).all(row.id) as Array<{
        id: string; outcome: string; rationale: string; supportingRefsJson: string;
        opposingRefsJson: string; limitationsJson: string; analysisRunId: string | null;
        createdAt: string;
      }>;
    const feedback = db.prepare(`SELECT id, kind, note, created_at AS createdAt
      FROM improvement_feedback WHERE plan_id = ?
      ORDER BY created_at DESC, id DESC`).all(row.id);
    return {
      ...row,
      basisChanged: Boolean(
        row.knowledgeSnapshotId
        && latestKnowledge
        && row.knowledgeSnapshotId !== latestKnowledge.id
        && row.knowledgeSnapshotCreatedAt
        && Date.parse(latestKnowledge.createdAt) > Date.parse(row.knowledgeSnapshotCreatedAt),
      ),
      latestKnowledgeSnapshotId: latestKnowledge?.id ?? null,
      earlyReviewRecommended: Boolean(
        ['observing', 'review-ready', 'queued'].includes(row.status)
        && row.knowledgeSnapshotId
        && latestKnowledge
        && row.knowledgeSnapshotId !== latestKnowledge.id,
      ),
      reviewPlan: json<Record<string, unknown>>(reviewPlanJson, {}),
      observations: observations.map(({ evidenceRefsJson, ...observation }) => ({
        ...observation,
        evidenceRefs: json<string[]>(evidenceRefsJson, []),
      })),
      reviews: reviews.map(({
        supportingRefsJson, opposingRefsJson, limitationsJson, ...review
      }) => ({
        ...review,
        supportingRefs: json<string[]>(supportingRefsJson, []),
        opposingRefs: json<string[]>(opposingRefsJson, []),
        limitations: json<string[]>(limitationsJson, []),
      })),
      feedback,
    };
  });
}

function planCreationAvailability() {
  const db = getDb();
  const latestCompleted = db.prepare(`SELECT prompt_version AS promptVersion
    FROM analysis_runs
    WHERE analysis_type = 'behavior_report' AND status = 'completed' AND output_json IS NOT NULL
    ORDER BY created_at DESC, id DESC LIMIT 1`).get() as { promptVersion: string } | undefined;
  const compatibleReport = db.prepare(`SELECT 1
    FROM analysis_runs
    WHERE analysis_type = 'behavior_report' AND status = 'completed'
      AND prompt_version = ? AND output_json IS NOT NULL
      AND json_type(output_json, '$.developmentPlan.improvementPlans') = 'array'
    LIMIT 1`).get(BEHAVIOR_REPORT_PROMPT_VERSION);
  const practiceCount = (db.prepare(`SELECT COUNT(*) AS count FROM knowledge_practices`)
    .get() as { count: number }).count;
  return {
    analysis: compatibleReport ? 'available' as const
      : latestCompleted ? 'requires-refresh' as const : 'requires-first-run' as const,
    practices: practiceCount > 0 ? 'available' as const : 'empty' as const,
  };
}

app.get('/', (c) => c.json({
  generation: { ...generation },
  creationAvailability: planCreationAvailability(),
  limits: {
    maxActivePlans: 3,
    maxEligibleTasksPerPlan: 30,
    maxObservationDays: 45,
    explanation: '系统只执行最大安全上限；适用任务、观察信号和复盘条件由 LLM 根据证据定义。',
  },
  plans: readPlans(),
}));

app.post('/from-practice/:practiceId', (c) => {
  if (generation.running) return c.json({ error: 'Another improvement operation is running' }, 409);
  const practiceId = c.req.param('practiceId');
  generation.running = true;
  generation.action = 'create-plan';
  generation.subjectId = practiceId;
  generation.startedAt = new Date().toISOString();
  generation.lastError = null;
  void createImprovementPlanFromPractice({ practiceId })
    .catch((error: unknown) => {
      generation.lastError = error instanceof Error ? error.message : '创建改进计划失败';
    })
    .finally(() => {
      generation.running = false;
      generation.action = null;
      generation.subjectId = null;
      generation.startedAt = null;
    });
  return c.json({ accepted: true, message: 'LLM 正在判断适用性、重叠关系和复盘条件。' }, 202);
});

app.post('/:planId/review', (c) => {
  if (generation.running) return c.json({ error: 'Another improvement operation is running' }, 409);
  const planId = c.req.param('planId');
  const plan = getDb().prepare(`SELECT 1 FROM improvement_plans WHERE id = ?`).get(planId);
  if (!plan) return c.json({ error: 'Improvement plan not found' }, 404);
  generation.running = true;
  generation.action = 'review';
  generation.subjectId = planId;
  generation.startedAt = new Date().toISOString();
  generation.lastError = null;
  void reviewImprovementPlan({ planId })
    .catch((error: unknown) => {
      generation.lastError = error instanceof Error ? error.message : '复盘失败';
    })
    .finally(() => {
      generation.running = false;
      generation.action = null;
      generation.subjectId = null;
      generation.startedAt = null;
    });
  return c.json({ accepted: true, message: '独立复盘运行已开始。' }, 202);
});

app.post('/:planId/feedback', async (c) => {
  const planId = c.req.param('planId');
  const body = await c.req.json<unknown>();
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return c.json({ error: 'Invalid feedback body' }, 400);
  }
  const value = body as Record<string, unknown>;
  if (!['judgment-wrong', 'not-applicable', 'continue-observing', 'end-tracking'].includes(value.kind as string)
      || (value.note !== undefined && (typeof value.note !== 'string' || value.note.length > 2_000))
      || Object.keys(value).some((key) => !['kind', 'note'].includes(key))) {
    return c.json({ error: 'Invalid feedback body' }, 400);
  }
  const plan = getDb().prepare(`SELECT status FROM improvement_plans WHERE id = ?`).get(planId);
  if (!plan) return c.json({ error: 'Improvement plan not found' }, 404);
  const id = `improvement-feedback:${randomUUID()}`;
  getDb().transaction(() => {
    getDb().prepare(`INSERT INTO improvement_feedback (id, plan_id, kind, note)
      VALUES (?, ?, ?, ?)`).run(id, planId, value.kind, value.note ?? null);
    if (value.kind === 'end-tracking') {
      getDb().prepare(`UPDATE improvement_plans SET status = 'ended', updated_at = datetime('now')
        WHERE id = ?`).run(planId);
    } else if (value.kind === 'continue-observing') {
      getDb().prepare(`UPDATE improvement_plans SET status = 'observing', updated_at = datetime('now')
        WHERE id = ?`).run(planId);
    }
  })();
  return c.json({
    id,
    storedLocally: true,
    message: '纠正已本地保存，后续观察与复盘 LLM 会读取；不会作为外部通用结论。',
  }, 201);
});

app.patch('/:planId/status', async (c) => {
  const body = await c.req.json<unknown>();
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return c.json({ error: 'Invalid status body' }, 400);
  }
  const value = body as Record<string, unknown>;
  if (!['observing', 'paused', 'ended'].includes(value.status as string)
      || Object.keys(value).length !== 1) {
    return c.json({ error: 'Invalid improvement status' }, 400);
  }
  const updated = getDb().prepare(`UPDATE improvement_plans
    SET status = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(value.status, c.req.param('planId')).changes;
  if (updated === 0) return c.json({ error: 'Improvement plan not found' }, 404);
  return c.json({ updated: true, status: value.status });
});

export default app;
