import { Hono } from 'hono';
import { getDb } from 'agent-usage-analyze/db/client';
import {
  queryAdvisories,
  readAdvisoryHistory,
  recordAdvisoryEvent,
  clearAdvisoryMute,
  setAdvisoryMute,
} from 'agent-usage-analyze/canonical/advisory';
import { readObserverOverhead } from 'agent-usage-analyze/canonical/observer-overhead';

const app = new Hono();

const empty = (diagnostics: string[]) => ({
  status: 'ok' as const,
  active: [],
  muted: [],
  history: { events: [], comparisons: [] },
  attention: { shown: 0, adopted: 0, ignored: 0, dismissed: 0 },
  strategic: null,
  diagnostics,
});

function latestStrategicGuidance(db: ReturnType<typeof getDb>) {
  const row = db.prepare(`SELECT output_json AS outputJson, created_at AS createdAt
    FROM analysis_runs WHERE analysis_type = 'behavior_report' AND status = 'completed'
      AND output_json IS NOT NULL ORDER BY created_at DESC, id DESC LIMIT 1`).get() as {
        outputJson: string; createdAt: string;
      } | undefined;
  if (!row) return null;
  try {
    const report = JSON.parse(row.outputJson) as {
      headline?: unknown;
      developmentPlan?: { northStar?: unknown; experiments?: Array<{
        title?: unknown; hypothesis?: unknown; eligibleCohort?: unknown;
      }> };
      skillAssessments?: Array<{
        name?: unknown; fit?: unknown; observation?: unknown; issue?: unknown; recommendation?: unknown;
      }>;
      skillOpportunities?: Array<{
        name?: unknown; trigger?: unknown; evidence?: unknown; expectedBenefit?: unknown;
      }>;
      runtimeAssessments?: Array<{
        category?: unknown; target?: unknown; fit?: unknown; observation?: unknown;
        issue?: unknown; recommendation?: unknown; applicability?: unknown;
      }>;
    };
    if (typeof report.headline !== 'string' || typeof report.developmentPlan?.northStar !== 'string') return null;
    const overall = (report.developmentPlan.experiments ?? []).flatMap((item) =>
      typeof item.title === 'string' && typeof item.hypothesis === 'string'
        ? [{
            category: 'overall' as const,
            title: item.title,
            rationale: item.hypothesis,
            ...(typeof item.eligibleCohort === 'string' ? { applicability: item.eligibleCohort } : {}),
          }]
        : []).slice(0, 4);
    const skills = [
      ...(report.skillAssessments ?? []).flatMap((item) =>
        item.fit !== 'appropriate' && typeof item.name === 'string'
          && typeof item.observation === 'string' && typeof item.recommendation === 'string'
          ? [{
              category: 'skill' as const,
              title: `$${item.name}`,
              rationale: typeof item.issue === 'string' ? item.issue : item.observation,
              recommendation: item.recommendation,
            }]
          : []),
      ...(report.skillOpportunities ?? []).flatMap((item) =>
        typeof item.name === 'string' && typeof item.expectedBenefit === 'string'
          ? [{
              category: 'skill' as const,
              title: item.name,
              rationale: typeof item.evidence === 'string' ? item.evidence : item.expectedBenefit,
              recommendation: item.expectedBenefit,
              ...(typeof item.trigger === 'string' ? { applicability: item.trigger } : {}),
            }]
          : []),
    ].slice(0, 4);
    const runtimes = (report.runtimeAssessments ?? []).flatMap((item) =>
      item.fit !== 'appropriate' && (item.category === 'model' || item.category === 'reasoning-effort')
        && typeof item.target === 'string' && typeof item.observation === 'string'
        && typeof item.recommendation === 'string'
        ? [{
            category: item.category === 'model' ? 'model' as const : 'reasoning' as const,
            title: item.target,
            rationale: typeof item.issue === 'string' ? item.issue : item.observation,
            recommendation: item.recommendation,
            ...(typeof item.applicability === 'string' ? { applicability: item.applicability } : {}),
          }]
        : []).slice(0, 4);
    return {
      generatedAt: row.createdAt,
      headline: report.headline,
      northStar: report.developmentPlan.northStar,
      actions: [...overall, ...skills, ...runtimes],
    };
  } catch { return null; }
}

app.get('/', (c) => {
  const taskId = c.req.query('taskId');
  if (taskId !== undefined && (taskId.length === 0 || taskId.length > 256 || taskId.includes('\n'))) {
    return c.json(empty(['task-not-found']));
  }
  try {
    const db = getDb();
    const taskIds = taskId !== undefined ? [taskId]
      : (db.prepare(`SELECT id FROM work_tasks WHERE id = root_task_id
          ORDER BY started_at DESC, id DESC LIMIT 4`).all() as Array<{ id: string }>).map((task) => task.id);
    const now = new Date().toISOString();
    const results = taskIds.map((candidateTaskId) => {
      const catalog = queryAdvisories(db, {
        taskId: candidateTaskId, now: new Date().toISOString(), limit: 3,
        cooldownMs: 0, includeMuted: true,
      });
      const visible = taskId === undefined
        ? { ...catalog, suggestions: catalog.suggestions.filter((suggestion) => !suggestion.muted) }
        : queryAdvisories(db, {
            taskId: candidateTaskId, now, limit: 3,
          });
      return { taskId: candidateTaskId, visible, catalog };
    });
    const active = results.flatMap(({ taskId: candidateTaskId, visible }) =>
      visible.suggestions.map((suggestion) => ({ ...suggestion, taskId: candidateTaskId })));
    const muted = results.flatMap(({ taskId: candidateTaskId, catalog }) =>
      catalog.suggestions.filter((suggestion) => suggestion.muted)
        .map((suggestion) => ({ ...suggestion, taskId: candidateTaskId })));
    const overhead = readObserverOverhead(db);
    return c.json({
      status: 'ok',
      active,
      muted,
      history: readAdvisoryHistory(db, taskId, 40),
      attention: overhead.advisory,
      strategic: latestStrategicGuidance(db),
      diagnostics: [...new Set(results.flatMap(({ visible, catalog }) =>
        [...visible.diagnostics, ...catalog.diagnostics]))],
    });
  } catch {
    return c.json(empty(['unavailable']));
  }
});

function opaque(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 1 && value.length <= 256
    && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value);
}

app.post('/events', async (c) => {
  const body = await c.req.json<unknown>();
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return c.json({ error: 'Invalid advisory event body' }, 400);
  }
  const value = body as Record<string, unknown>;
  const action = value.action;
  const expected = action === 'shown'
    ? ['taskId', 'issueKey', 'action']
    : action === 'outcome'
      ? ['taskId', 'issueKey', 'action', 'outcome', 'interventionId']
      : ['taskId', 'issueKey', 'action', 'interventionId'];
  if (Object.keys(value).length !== expected.length || expected.some((key) => !(key in value))
      || !opaque(value.taskId) || !opaque(value.issueKey)
      || !['shown', 'adopted', 'ignored', 'dismissed', 'outcome'].includes(action as string)
      || (action !== 'shown' && !opaque(value.interventionId))
      || (action === 'outcome' && !['improved', 'not-improved', 'unknown'].includes(value.outcome as string))) {
    return c.json({ error: 'Invalid advisory event body' }, 400);
  }
  try {
    const db = getDb();
    const task = db.prepare(`SELECT task.root_task_id AS rootTaskId, root.started_at AS startedAt
      FROM work_tasks task JOIN work_tasks root ON root.id = task.root_task_id
      WHERE task.id = ?`).get(value.taskId) as {
        rootTaskId: string; startedAt: string;
      } | undefined;
    if (!task) return c.json({ error: 'Advisory task not found' }, 404);
    const resolveObservation = (rootTaskId: string, evidenceRefs: string[]): {
      observationEraId: string; firstObservedAt: string;
    } | null => {
      if (evidenceRefs.length === 0) return null;
      const eras = db.prepare(`SELECT event.era_id AS observationEraId,
          MIN(event.occurred_at) AS firstObservedAt
        FROM canonical_events event JOIN work_tasks work ON work.id = event.task_id
        WHERE event.id IN (${evidenceRefs.map(() => '?').join(',')}) AND work.root_task_id = ?
        GROUP BY event.era_id`)
        .all(...evidenceRefs, rootTaskId) as Array<{
          observationEraId: string; firstObservedAt: string;
        }>;
      return eras.length === 1 ? eras[0]! : null;
    };
    let coverage: number;
    let evidenceRefs: string[];
    let observationEraId: string;
    let eventTaskId = task.rootTaskId;
    let interventionId: string | undefined;
    if (action === 'shown') {
      const advice = queryAdvisories(db, {
        taskId: task.rootTaskId, now: new Date().toISOString(), limit: 3,
        cooldownMs: 0,
      }).suggestions.find((suggestion) => suggestion.issueKey === value.issueKey);
      if (!advice) return c.json({ error: 'Advisory issue not found' }, 404);
      coverage = advice.coverage;
      evidenceRefs = advice.evidenceRefs;
      const observation = resolveObservation(task.rootTaskId, evidenceRefs);
      if (!observation) return c.json({ recorded: false, degraded: true }, 202);
      observationEraId = observation.observationEraId;
    } else {
      const baseline = db.prepare(`SELECT task_id AS taskId, observation_era_id AS observationEraId,
          coverage, evidence_refs_json AS evidenceRefsJson, occurred_at AS occurredAt
        FROM advisory_events WHERE intervention_id = ? AND issue_key = ? AND action = 'shown'`)
        .get(value.interventionId, value.issueKey) as {
          taskId: string; observationEraId: string; coverage: number;
          evidenceRefsJson: string; occurredAt: string;
        } | undefined;
      if (!baseline) return c.json({ error: 'Advisory interaction not found' }, 404);
      interventionId = value.interventionId as string;
      if (action === 'outcome') {
        if (task.rootTaskId === baseline.taskId) {
          return c.json({ error: 'Follow-up task must differ from the intervention task' }, 400);
        }
        const followup = queryAdvisories(db, {
          taskId: task.rootTaskId, now: new Date().toISOString(), limit: 3,
          cooldownMs: 0, includeMuted: true,
        }).suggestions.find((suggestion) => suggestion.issueKey === value.issueKey);
        if (!followup) return c.json({ recorded: false, degraded: true }, 202);
        coverage = followup.coverage;
        evidenceRefs = followup.evidenceRefs;
        const observation = resolveObservation(task.rootTaskId, evidenceRefs);
        if (!observation) return c.json({ recorded: false, degraded: true }, 202);
        const baselineMs = Date.parse(baseline.occurredAt);
        const followupTaskMs = Date.parse(task.startedAt);
        const followupEvidenceMs = Date.parse(observation.firstObservedAt);
        if (![baselineMs, followupTaskMs, followupEvidenceMs].every(Number.isFinite)
            || followupTaskMs <= baselineMs || followupEvidenceMs <= baselineMs) {
          return c.json({ error: 'Follow-up evidence must occur after the intervention' }, 400);
        }
        observationEraId = observation.observationEraId;
      } else {
        if (task.rootTaskId !== baseline.taskId) {
          return c.json({ error: 'Advisory interaction task mismatch' }, 400);
        }
        try { evidenceRefs = JSON.parse(baseline.evidenceRefsJson) as string[]; } catch {
          return c.json({ recorded: false, degraded: true }, 202);
        }
        coverage = baseline.coverage;
        observationEraId = baseline.observationEraId;
        eventTaskId = baseline.taskId;
      }
    }
    if (!Array.isArray(evidenceRefs) || evidenceRefs.some((ref) => typeof ref !== 'string')) {
        return c.json({ recorded: false, degraded: true }, 202);
    }
    const recorded = recordAdvisoryEvent(db, {
      interventionId,
      issueKey: value.issueKey,
      taskId: eventTaskId,
      action: action as 'shown' | 'adopted' | 'ignored' | 'dismissed' | 'outcome',
      outcome: action === 'outcome' ? value.outcome as 'improved' | 'not-improved' | 'unknown' : undefined,
      observationEraId,
      coverage,
      evidenceRefs,
      occurredAt: new Date().toISOString(),
    });
    return c.json({ recorded: true, degraded: false, id: recorded.eventId,
      interventionId: recorded.interventionId }, 202);
  } catch {
    return c.json({ recorded: false, degraded: true }, 202);
  }
});

app.post('/mutes', async (c) => {
  const body = await c.req.json<unknown>();
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return c.json({ error: 'Invalid advisory mute body' }, 400);
  }
  const value = body as Record<string, unknown>;
  const expected = ['scopeKind', 'scopeKey', 'mutedUntil'];
  if (Object.keys(value).length !== expected.length || expected.some((key) => !(key in value))
      || !['issue', 'category'].includes(value.scopeKind as string) || !opaque(value.scopeKey)
      || (value.mutedUntil !== null && typeof value.mutedUntil !== 'string')) {
    return c.json({ error: 'Invalid advisory mute body' }, 400);
  }
  try {
    setAdvisoryMute(getDb(), {
      scopeKind: value.scopeKind as 'issue' | 'category', scopeKey: value.scopeKey,
      mutedUntil: value.mutedUntil as string | null, now: new Date().toISOString(),
    });
    return c.body(null, 204);
  } catch {
    return c.json({ error: 'Unable to update advisory mute' }, 400);
  }
});

app.delete('/mutes', async (c) => {
  const body = await c.req.json<unknown>();
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return c.json({ error: 'Invalid advisory mute body' }, 400);
  }
  const value = body as Record<string, unknown>;
  const expected = ['scopeKind', 'scopeKey'];
  if (Object.keys(value).length !== expected.length || expected.some((key) => !(key in value))
      || !['issue', 'category'].includes(value.scopeKind as string) || !opaque(value.scopeKey)) {
    return c.json({ error: 'Invalid advisory mute body' }, 400);
  }
  try {
    clearAdvisoryMute(getDb(), {
      scopeKind: value.scopeKind as 'issue' | 'category', scopeKey: value.scopeKey,
    });
    return c.body(null, 204);
  } catch {
    return c.json({ error: 'Unable to update advisory mute' }, 400);
  }
});

export default app;
