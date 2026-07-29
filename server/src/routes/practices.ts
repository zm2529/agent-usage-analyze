import { Hono } from 'hono';
import { getDb } from 'agent-usage-analyze/db/client';
import {
  isWeeklyKnowledgeRefreshDue,
  runKnowledgeResearch,
  type KnowledgeSnapshotScope,
} from 'agent-usage-analyze/analysis/knowledge-research';
import { loadConfig, saveConfig } from 'agent-usage-analyze/utils/config';

const app = new Hono();

interface GenerationState {
  running: boolean;
  queued: boolean;
  scope: KnowledgeSnapshotScope | null;
  startedAt: string | null;
  lastCompletedAt: string | null;
  lastError: string | null;
}

const generation: GenerationState = {
  running: false,
  queued: false,
  scope: null,
  startedAt: null,
  lastCompletedAt: null,
  lastError: null,
};

function researchAuthorization() {
  const research = loadConfig()?.dashboard?.knowledgeResearch;
  return {
    enabled: research?.enabled === true,
    authorizedAt: typeof research?.authorizedAt === 'string' ? research.authorizedAt : null,
  };
}

function latestSnapshot() {
  return getDb().prepare(`SELECT id, scope, topic, snapshot_version AS snapshotVersion,
      prompt_version AS promptVersion, status, research_run_id AS researchRunId,
      source_count AS sourceCount, practice_count AS practiceCount,
      query_summary_json AS querySummaryJson, output_json AS outputJson,
      created_at AS createdAt
    FROM knowledge_snapshots
    ORDER BY created_at DESC, id DESC LIMIT 1`).get() as {
      id: string;
      scope: KnowledgeSnapshotScope;
      topic: string | null;
      snapshotVersion: string;
      promptVersion: string;
      status: 'completed' | 'failed';
      researchRunId: string | null;
      sourceCount: number;
      practiceCount: number;
      querySummaryJson: string;
      outputJson: string;
      createdAt: string;
    } | undefined;
}

function parseJson<T>(raw: string, fallback: T): T {
  try { return JSON.parse(raw) as T; } catch { return fallback; }
}

function serializeSnapshot(row: ReturnType<typeof latestSnapshot>) {
  if (!row) return null;
  const { querySummaryJson, outputJson, ...snapshot } = row;
  return {
    ...snapshot,
    querySummary: parseJson<Record<string, unknown>>(querySummaryJson, {}),
    output: parseJson<Record<string, unknown>>(outputJson, {}),
  };
}

function weeklyResearchTopics(): string[] {
  const report = getDb().prepare(`SELECT output_json AS outputJson
    FROM analysis_runs
    WHERE analysis_type = 'behavior_report' AND status = 'completed' AND output_json IS NOT NULL
    ORDER BY created_at DESC, id DESC LIMIT 1`).get() as { outputJson: string } | undefined;
  if (!report) return ['current coding-agent workflow practices'];
  const parsed = parseJson<{
    headline?: unknown;
    summary?: unknown;
    dimensions?: Array<{ label?: unknown; observation?: unknown }>;
    bottlenecks?: Array<{ title?: unknown; explanation?: unknown }>;
  }>(report.outputJson, {});
  return [
    typeof parsed.headline === 'string' ? parsed.headline : '',
    typeof parsed.summary === 'string' ? parsed.summary : '',
    ...(parsed.dimensions ?? []).slice(0, 4).map((item) =>
      [item.label, item.observation].filter((value) => typeof value === 'string').join(': ')),
    ...(parsed.bottlenecks ?? []).slice(0, 3).map((item) =>
      [item.title, item.explanation].filter((value) => typeof value === 'string').join(': ')),
  ].filter((topic) => topic.length > 0).slice(0, 8);
}

function weeklyResearchTopicSource(): 'general-bootstrap' | 'local-analysis' {
  const report = getDb().prepare(`SELECT 1
    FROM analysis_runs
    WHERE analysis_type = 'behavior_report' AND status = 'completed' AND output_json IS NOT NULL
    LIMIT 1`).get();
  return report ? 'local-analysis' : 'general-bootstrap';
}

export function getKnowledgeResearchGenerationStatus(): GenerationState {
  return { ...generation };
}

export function triggerKnowledgeResearch(
  scope: KnowledgeSnapshotScope,
  rawTopics: string[],
): boolean {
  if (generation.running) return false;
  generation.running = true;
  generation.queued = false;
  generation.scope = scope;
  generation.startedAt = new Date().toISOString();
  generation.lastError = null;
  void runKnowledgeResearch({ scope, rawTopics })
    .then((snapshot) => {
      generation.lastCompletedAt = snapshot.createdAt;
    })
    .catch((error: unknown) => {
      generation.lastError = error instanceof Error ? error.message : '知识检索失败';
    })
    .finally(() => {
      generation.running = false;
      generation.scope = null;
      generation.startedAt = null;
    });
  return true;
}

function maybeStartWeeklyResearch(): boolean {
  const authorization = researchAuthorization();
  if (!authorization.enabled || !authorization.authorizedAt || generation.running) {
    generation.queued = false;
    return false;
  }
  if (!isWeeklyKnowledgeRefreshDue(getDb())) {
    generation.queued = false;
    generation.scope = null;
    return false;
  }
  if (localPipelineIsWriting()) {
    generation.queued = true;
    generation.scope = 'weekly';
    generation.startedAt = null;
    generation.lastError = null;
    return false;
  }
  return triggerKnowledgeResearch('weekly', weeklyResearchTopics());
}

const PIPELINE_BUSY_RETRY_MS = 30_000;
let weeklyResearchTimer: ReturnType<typeof setTimeout> | null = null;

function localPipelineIsWriting(): boolean {
  const db = getDb();
  const activeAnalysis = db.prepare(`SELECT 1 FROM analysis_queue
    WHERE status = 'processing'
      AND datetime(started_at) >= datetime('now', '-1 hour')
    LIMIT 1`).get();
  if (activeAnalysis) return true;
  return Boolean(db.prepare(`SELECT 1 FROM ingestion_runs
    WHERE status = 'running'
      AND datetime(started_at) >= datetime('now', '-1 hour')
    LIMIT 1`).get());
}

function cancelScheduledWeeklyResearch(): void {
  if (weeklyResearchTimer) clearTimeout(weeklyResearchTimer);
  weeklyResearchTimer = null;
  if (!generation.running) {
    generation.queued = false;
    generation.scope = null;
  }
}

function scheduleWeeklyResearch(delayMs = 0): void {
  if (weeklyResearchTimer) return;
  weeklyResearchTimer = setTimeout(() => {
    weeklyResearchTimer = null;
    try {
      const started = maybeStartWeeklyResearch();
      if (!started && generation.queued) scheduleWeeklyResearch(PIPELINE_BUSY_RETRY_MS);
    } catch (error) {
      generation.queued = false;
      generation.scope = null;
      generation.lastError = error instanceof Error ? error.message : '知识检索调度失败';
    }
  }, delayMs);
  weeklyResearchTimer.unref();
}

export function startKnowledgeResearchScheduler(): { close: () => void } {
  const timer = setInterval(() => { scheduleWeeklyResearch(); }, 6 * 60 * 60 * 1000);
  timer.unref();
  scheduleWeeklyResearch();
  return {
    close: () => {
      clearInterval(timer);
      cancelScheduledWeeklyResearch();
    },
  };
}

app.get('/status', (c) => {
  const authorization = researchAuthorization();
  return c.json({
    authorization,
    topicSource: weeklyResearchTopicSource(),
    due: authorization.enabled && authorization.authorizedAt
      ? isWeeklyKnowledgeRefreshDue(getDb())
      : false,
    generation: getKnowledgeResearchGenerationStatus(),
    latestSnapshot: serializeSnapshot(latestSnapshot()),
    boundary: {
      externalPayload: '仅发送经 LLM 提炼且通过本地隐私门的行为或技术标签',
      excluded: ['原始提示词', '代码', '日志', '仓库名', '本地路径', '私有或登录地址'],
      localEffect: '外部证据不等于本地有效，需进入改进追踪后复盘',
    },
  });
});

app.post('/authorization', async (c) => {
  const body = await c.req.json<unknown>();
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return c.json({ error: 'Invalid authorization body' }, 400);
  }
  const value = body as Record<string, unknown>;
  if (value.acknowledgedExternalResearch !== true || Object.keys(value).length !== 1) {
    return c.json({ error: 'External research acknowledgement is required' }, 400);
  }
  const current = loadConfig();
  const authorizedAt = new Date().toISOString();
  saveConfig({
    sync: current?.sync ?? { excludeProjects: [] },
    ...(current?.telemetry === undefined ? {} : { telemetry: current.telemetry }),
    dashboard: {
      ...current?.dashboard,
      knowledgeResearch: { enabled: true, authorizedAt },
    },
  });
  generation.lastError = null;
  scheduleWeeklyResearch();
  return c.json({ enabled: true, authorizedAt }, 201);
});

app.patch('/authorization', async (c) => {
  const body = await c.req.json<unknown>();
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return c.json({ error: 'Invalid authorization body' }, 400);
  }
  const value = body as Record<string, unknown>;
  if (typeof value.enabled !== 'boolean' || Object.keys(value).length !== 1) {
    return c.json({ error: 'Authorization enabled state is required' }, 400);
  }
  const current = loadConfig();
  const authorizedAt = value.enabled ? new Date().toISOString() : null;
  saveConfig({
    sync: current?.sync ?? { excludeProjects: [] },
    ...(current?.telemetry === undefined ? {} : { telemetry: current.telemetry }),
    dashboard: {
      ...current?.dashboard,
      knowledgeResearch: value.enabled ? { enabled: true, authorizedAt: authorizedAt! } : { enabled: false },
    },
  });
  if (value.enabled) {
    generation.lastError = null;
    scheduleWeeklyResearch();
  } else {
    cancelScheduledWeeklyResearch();
  }
  return c.json({ enabled: value.enabled, authorizedAt });
});

app.post('/refresh', async (c) => {
  const authorization = researchAuthorization();
  if (!authorization.enabled || !authorization.authorizedAt) {
    return c.json({ error: 'External research authorization is required' }, 403);
  }
  const body = await c.req.json<unknown>();
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return c.json({ error: 'Invalid research request' }, 400);
  }
  const value = body as Record<string, unknown>;
  const topic = value.topic;
  if (topic !== undefined && (typeof topic !== 'string' || topic.trim().length < 3 || topic.length > 2_000)) {
    return c.json({ error: 'Topic must contain 3 to 2000 characters' }, 400);
  }
  const expectedKeys = topic === undefined ? [] : ['topic'];
  if (Object.keys(value).some((key) => !expectedKeys.includes(key))) {
    return c.json({ error: 'Invalid research request fields' }, 400);
  }
  const scope: KnowledgeSnapshotScope = typeof topic === 'string' ? 'topic' : 'weekly';
  const rawTopics = typeof topic === 'string' ? [topic] : weeklyResearchTopics();
  cancelScheduledWeeklyResearch();
  if (!triggerKnowledgeResearch(scope, rawTopics)) {
    return c.json({ error: 'Knowledge research is already running' }, 409);
  }
  return c.json({
    accepted: true,
    scope,
    message: '已进入检索队列；公开检索仅接收经过提炼与隐私检查的标签。',
  }, 202);
});

app.get('/', (c) => {
  const snapshotId = c.req.query('snapshotId');
  const trust = c.req.query('trust');
  const relevance = c.req.query('relevance');
  const tag = c.req.query('tag');
  if (trust && !['official', 'high', 'medium', 'limited'].includes(trust)) {
    return c.json({ error: 'Invalid trust filter' }, 400);
  }
  if (relevance && !['high', 'medium', 'low', 'unknown'].includes(relevance)) {
    return c.json({ error: 'Invalid relevance filter' }, 400);
  }
  const conditions: string[] = [];
  const params: string[] = [];
  if (snapshotId) { conditions.push('practice.snapshot_id = ?'); params.push(snapshotId); }
  if (trust) { conditions.push('practice.source_trust = ?'); params.push(trust); }
  if (relevance) { conditions.push('practice.local_relevance = ?'); params.push(relevance); }
  if (tag) { conditions.push(`EXISTS (
    SELECT 1 FROM json_each(practice.tags_json) WHERE json_each.value = ?
  )`); params.push(tag); }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const rows = getDb().prepare(`SELECT practice.id, practice.snapshot_id AS snapshotId,
      practice.title, practice.summary, practice.applicability,
      practice.source_trust AS sourceTrust,
      practice.discussion_breadth AS discussionBreadth,
      practice.recency, practice.local_relevance AS localRelevance,
      practice.local_effect_status AS localEffectStatus, practice.rationale,
      practice.tags_json AS tagsJson, practice.source_refs_json AS sourceRefsJson,
      practice.conflicts_json AS conflictsJson, practice.created_at AS createdAt,
      snapshot.scope, snapshot.created_at AS snapshotCreatedAt
    FROM knowledge_practices practice
    JOIN knowledge_snapshots snapshot ON snapshot.id = practice.snapshot_id
    ${where}
    ORDER BY snapshot.created_at DESC,
      CASE practice.source_trust
        WHEN 'official' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
      practice.title LIMIT 200`).all(...params) as Array<{
        id: string; snapshotId: string; title: string; summary: string; applicability: string;
        sourceTrust: string; discussionBreadth: string; recency: string; localRelevance: string;
        localEffectStatus: string; rationale: string; tagsJson: string; sourceRefsJson: string;
        conflictsJson: string; createdAt: string; scope: string; snapshotCreatedAt: string;
      }>;
  return c.json({
    practices: rows.map(({ tagsJson, sourceRefsJson, conflictsJson, ...row }) => ({
      ...row,
      tags: parseJson<string[]>(tagsJson, []),
      sourceRefs: parseJson<Array<Record<string, unknown>>>(sourceRefsJson, []),
      conflicts: parseJson<string[]>(conflictsJson, []),
    })),
  });
});

export default app;
