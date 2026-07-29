import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Hono } from 'hono';
import { getDb } from 'agent-usage-analyze/db/client';
import { getQueueStatus } from 'agent-usage-analyze/db/queue';
import { BEHAVIOR_REPORT_PROMPT_VERSION } from 'agent-usage-analyze/analysis/behavior-report';
import { getConfigDir } from 'agent-usage-analyze/utils/config';
import { inspectCodexHook } from 'agent-usage-analyze/utils/codex-hooks';
import { loadConfig } from 'agent-usage-analyze/utils/config';
import { isWeeklyKnowledgeRefreshDue } from 'agent-usage-analyze/analysis/knowledge-research';
import { getBehaviorReportGenerationStatus } from './behavior-report.js';
import { getKnowledgeResearchGenerationStatus } from './practices.js';

type StageState = 'healthy' | 'running' | 'waiting' | 'stale' | 'failed' | 'not-configured';

interface RuntimeStage {
  state: StageState;
  label: string;
  lastSuccessAt: string | null;
  backlog: number;
  failures: number;
  action: { label: string; href: string } | null;
  detail: string;
}

interface HookEventStatus {
  status?: string;
  reason?: string;
  observedAt?: string;
  recoveredFailureAt?: string;
  recoveredFailureReason?: string;
}

const RECENT_HOOK_RECOVERY_MS = 10 * 60 * 1_000;

export function hookEventLabel(event: HookEventStatus, now = Date.now()): {
  label: string;
  detail: string;
} {
  if (event.status === 'recorded') {
    const recoveredAt = event.recoveredFailureAt ? Date.parse(event.recoveredFailureAt) : Number.NaN;
    if (Number.isFinite(recoveredAt) && now - recoveredAt <= RECENT_HOOK_RECOVERY_MS) return {
      label: '已自动恢复',
      detail: event.recoveredFailureReason === 'database-busy'
        ? '短暂写入繁忙，后续事件已成功记录'
        : '短暂失败后，后续事件已成功记录',
    };
    return { label: '最近事件已收到', detail: 'Hook 已安装并记录真实事件' };
  }
  if (event.status === 'failed') return {
    label: event.reason === 'database-busy' ? '写入繁忙，等待重试' : '最近事件失败',
    detail: event.reason === 'database-busy'
      ? '本地数据正在写入；下个事件会自动重试'
      : event.reason ?? 'Hook 处理失败',
  };
  return { label: '等待有效事件', detail: event.reason ?? event.status ?? '未知状态' };
}

interface SemanticQueueSnapshot {
  settling: number;
  pending: number;
  processing: number;
  awaitingCapability: number;
  awaitingSource: number;
  failed: number;
  hasPreviousSuccess: boolean;
}

export function semanticQueuePresentation(snapshot: SemanticQueueSnapshot): {
  state: StageState;
  label: string;
  detail: string;
} {
  const {
    settling, pending, processing, awaitingCapability, awaitingSource, failed,
    hasPreviousSuccess,
  } = snapshot;
  if (processing > 0) return {
    state: 'running',
    label: '任务分析处理中',
    detail: `等待稳定 ${settling} · 排队 ${pending} · 分析中 ${processing}`,
  };
  if (pending > 0) return {
    state: 'waiting',
    label: '任务分析排队中',
    detail: `等待稳定 ${settling} · 排队 ${pending} · 分析中 0`,
  };
  if (awaitingCapability > 0) return {
    state: 'waiting',
    label: hasPreviousSuccess ? '任务分析待重试' : '等待分析能力',
    detail: `待重试 ${awaitingCapability} · 排队 0 · 分析中 0`,
  };
  if (awaitingSource > 0) return {
    state: 'waiting',
    label: '等待会话记录',
    detail: `${awaitingSource} 个会话记录尚未可读；记录出现后自动继续`,
  };
  if (failed > 0) return {
    state: 'failed',
    label: '部分任务分析失败',
      detail: `${failed} 个最近任务分析失败`,
  };
  if (settling > 0) return {
    state: 'waiting',
    label: '等待会话稳定',
    detail: `${settling} 个最近会话将在停止变化后自动分析`,
  };
  return {
    state: 'healthy',
    label: '任务分析可用',
    detail: '新会话会在稳定后自动分析',
  };
}

function hookStage(): RuntimeStage {
  const inspected = inspectCodexHook();
  const statusFile = join(getConfigDir(), 'codex-hook-status.json');
  let event: HookEventStatus | null = null;
  let eventParseFailed = false;
  if (existsSync(statusFile)) {
    try {
      event = JSON.parse(readFileSync(statusFile, 'utf8')) as HookEventStatus;
    } catch {
      eventParseFailed = true;
    }
  }
  if (inspected.parseError || eventParseFailed) return {
    state: 'failed', label: 'Hook 配置异常', lastSuccessAt: null, backlog: 0, failures: 1,
    action: { label: '查看设置', href: '/settings#pipeline-status' },
    detail: inspected.parseError ?? '最近 Hook 状态无法读取',
  };
  if (!inspected.installed) return {
    state: 'not-configured', label: 'Hook 未安装', lastSuccessAt: null, backlog: 0, failures: 0,
    action: { label: '查看设置', href: '/settings#pipeline-status' }, detail: '尚未安装 Codex Hook',
  };
  if (inspected.stale) return {
    state: 'stale', label: 'Hook 需要更新', lastSuccessAt: event?.status === 'recorded' ? event.observedAt ?? null : null,
    backlog: 0, failures: 0, action: { label: '查看设置', href: '/settings#pipeline-status' },
    detail: '已安装的 Hook 指向旧版本命令',
  };
  if (!event) return {
    state: 'waiting', label: '等待首个事件', lastSuccessAt: null, backlog: 0, failures: 0,
    action: { label: '查看设置', href: '/settings#pipeline-status' }, detail: 'Hook 已安装，尚未收到事件',
  };
  if (event.status !== 'recorded') return {
    state: event.status === 'failed' ? 'failed' : 'waiting',
    label: hookEventLabel(event).label,
    lastSuccessAt: null, backlog: 0, failures: event.status === 'failed' ? 1 : 0,
    action: { label: '查看设置', href: '/settings#pipeline-status' },
    detail: hookEventLabel(event).detail,
  };
  const ageMs = event.observedAt ? Date.now() - Date.parse(event.observedAt) : Number.POSITIVE_INFINITY;
  const presentation = hookEventLabel(event);
  return {
    state: ageMs > 7 * 24 * 60 * 60 * 1_000 ? 'stale' : 'healthy',
    label: ageMs > 7 * 24 * 60 * 60 * 1_000 ? '长时间未收到事件' : presentation.label,
    lastSuccessAt: event.observedAt ?? null, backlog: 0, failures: 0,
    action: { label: '查看记录', href: '/sessions' }, detail: presentation.detail,
  };
}

function ingestionStage(): RuntimeStage {
  const health = getDb().prepare(`
    SELECT status, started_at AS startedAt, completed_at AS completedAt,
           discovered_count AS discovered, processed_source_count AS processedSources,
           failed_count AS failed
    FROM ingestion_runs
    ORDER BY started_at DESC, rowid DESC
    LIMIT 1
  `).get() as {
    status: 'running' | 'completed' | 'completed-with-errors' | 'failed';
    startedAt: string;
    completedAt: string | null;
    discovered: number;
    processedSources: number;
    failed: number;
  } | undefined;
  if (!health) return {
    state: 'waiting', label: '尚未导入', lastSuccessAt: null, backlog: 0, failures: 0,
    action: { label: '同步历史', href: '/dashboard' }, detail: '等待首次本地历史导入',
  };
  const failures = health.failed;
  if (health.status === 'running') return {
    state: 'running', label: '正在导入', lastSuccessAt: null,
    backlog: Math.max(0, health.discovered - health.processedSources),
    failures, action: { label: '查看导入', href: '/settings#pipeline-status' },
    detail: `已处理 ${health.processedSources}/${health.discovered} 个来源`,
  };
  return {
    state: health.status === 'failed' ? 'failed' : failures > 0 ? 'stale' : 'healthy',
    label: health.status === 'failed' ? '最近导入失败' : failures > 0 ? '部分来源未导入' : '最近导入成功',
    lastSuccessAt: health.status === 'failed' ? null : health.completedAt,
    backlog: 0, failures, action: { label: '查看导入', href: '/settings#pipeline-status' },
    detail: `最近一次处理 ${health.processedSources}/${health.discovered} 个来源`,
  };
}

function semanticStage(): RuntimeStage {
  const db = getDb();
  const queue = getQueueStatus(db);
  const lastSuccess = db.prepare(`SELECT completed_at AS completedAt FROM analysis_queue
    WHERE status = 'completed' AND completed_at IS NOT NULL
    ORDER BY completed_at DESC LIMIT 1`).get() as { completedAt: string } | undefined;
  const recent = db.prepare(`SELECT
      SUM(CASE WHEN status = 'awaiting-capability'
        AND diagnostic IS NOT 'source-not-found' THEN 1 ELSE 0 END) AS awaitingCapability,
      SUM(CASE WHEN status = 'awaiting-capability'
        AND diagnostic = 'source-not-found' THEN 1 ELSE 0 END) AS awaitingSource,
      SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed
    FROM analysis_queue
    WHERE ? IS NULL OR datetime(enqueued_at) > datetime(?)`).get(
      lastSuccess?.completedAt ?? null,
      lastSuccess?.completedAt ?? null,
    ) as {
      awaitingCapability: number | null;
      awaitingSource: number | null;
      failed: number | null;
    };
  const currentAwaiting = recent.awaitingCapability ?? 0;
  const currentAwaitingSource = recent.awaitingSource ?? 0;
  const currentFailed = recent.failed ?? 0;
  const backlog = queue.settling + queue.pending + queue.processing
    + currentAwaiting + currentAwaitingSource;
  const presentation = semanticQueuePresentation({
    settling: queue.settling,
    pending: queue.pending,
    processing: queue.processing,
    awaitingCapability: currentAwaiting,
    awaitingSource: currentAwaitingSource,
    failed: currentFailed,
    hasPreviousSuccess: Boolean(lastSuccess),
  });
  return {
    state: presentation.state,
    label: presentation.label,
    lastSuccessAt: lastSuccess?.completedAt ?? null,
    backlog,
    failures: currentFailed,
    action: { label: '查看状态', href: '/settings#pipeline-status' },
    detail: presentation.detail,
  };
}

function reportStage(): RuntimeStage {
  const db = getDb();
  const latest = db.prepare(`SELECT status, created_at AS createdAt
    FROM analysis_runs WHERE analysis_type = 'behavior_report'
    ORDER BY created_at DESC, id DESC LIMIT 1`).get() as {
      status: string; createdAt: string;
    } | undefined;
  const current = db.prepare(`SELECT prompt_version AS promptVersion, created_at AS createdAt
    FROM analysis_runs
    WHERE analysis_type = 'behavior_report' AND status = 'completed' AND prompt_version = ?
    ORDER BY created_at DESC, id DESC LIMIT 1`).get(BEHAVIOR_REPORT_PROMPT_VERSION) as {
      promptVersion: string; createdAt: string;
    } | undefined;
  const generation = getBehaviorReportGenerationStatus();
  if (generation.running) return {
    state: 'running', label: '跨任务报告生成中', lastSuccessAt: current?.createdAt ?? null,
    backlog: 1, failures: 0, action: { label: '查看分析', href: '/analysis' },
    detail: `开始于 ${generation.startedAt ?? '未知时间'} · 目标版本 ${BEHAVIOR_REPORT_PROMPT_VERSION}`,
  };
  if (!current) return {
    state: latest?.status === 'failed' ? 'failed' : 'waiting',
    label: latest?.status === 'failed' ? '报告生成失败' : '等待当前报告',
    lastSuccessAt: null, backlog: 0, failures: latest?.status === 'failed' ? 1 : 0,
    action: { label: '查看分析', href: '/analysis' },
    detail: `目标版本 ${BEHAVIOR_REPORT_PROMPT_VERSION}`,
  };
  return {
    state: 'healthy', label: '当前报告可用', lastSuccessAt: current.createdAt,
    backlog: 0, failures: latest?.status === 'failed' ? 1 : 0,
    action: { label: '查看分析', href: '/analysis' }, detail: current.promptVersion,
  };
}

function knowledgeStage(): RuntimeStage {
  const research = loadConfig()?.dashboard?.knowledgeResearch;
  const generation = getKnowledgeResearchGenerationStatus();
  const latest = getDb().prepare(`SELECT created_at AS createdAt
    FROM knowledge_snapshots WHERE status = 'completed'
    ORDER BY created_at DESC, id DESC LIMIT 1`).get() as { createdAt: string } | undefined;
  const lastFailed = getDb().prepare(`SELECT created_at AS createdAt
    FROM analysis_runs WHERE analysis_type = 'knowledge_research' AND status = 'failed'
    ORDER BY created_at DESC, id DESC LIMIT 1`).get() as { createdAt: string } | undefined;
  if (research?.enabled !== true || typeof research.authorizedAt !== 'string') return {
    state: 'not-configured',
    label: '公开检索未授权',
    lastSuccessAt: latest?.createdAt ?? null,
    backlog: 0,
    failures: lastFailed ? 1 : 0,
    action: { label: '了解并授权', href: '/practices' },
    detail: '只会发送经 LLM 提炼并通过本地隐私门的公开研究标签',
  };
  if (generation.running) return {
    state: 'running',
    label: generation.scope === 'topic' ? '主题检索中' : '实践快照更新中',
    lastSuccessAt: latest?.createdAt ?? null,
    backlog: 1,
    failures: 0,
    action: { label: '查看实践库', href: '/practices' },
    detail: generation.startedAt ? `开始于 ${generation.startedAt}` : '正在检索公开来源',
  };
  if (generation.queued) return {
    state: 'waiting',
    label: '等待本地任务完成',
    lastSuccessAt: latest?.createdAt ?? null,
    backlog: 1,
    failures: 0,
    action: { label: '查看实践库', href: '/practices' },
    detail: '导入或任务分析完成后将自动开始公开检索',
  };
  if (generation.lastError) return {
    state: 'failed',
    label: '最近检索失败',
    lastSuccessAt: latest?.createdAt ?? null,
    backlog: isWeeklyKnowledgeRefreshDue(getDb()) ? 1 : 0,
    failures: 1,
    action: { label: '查看详情', href: '/practices' },
    detail: generation.lastError,
  };
  const due = isWeeklyKnowledgeRefreshDue(getDb());
  return {
    state: due ? 'waiting' : 'healthy',
    label: due ? '等待实践快照' : '实践快照已更新',
    lastSuccessAt: latest?.createdAt ?? null,
    backlog: due ? 1 : 0,
    failures: lastFailed && (!latest || lastFailed.createdAt > latest.createdAt) ? 1 : 0,
    action: { label: '查看实践库', href: '/practices' },
    detail: due ? '已授权，将在调度可用时更新' : '当前证据快照可追溯',
  };
}

const app = new Hono();

app.get('/', (c) => c.json({
  generatedAt: new Date().toISOString(),
  stages: {
    hook: hookStage(),
    ingestion: ingestionStage(),
    semanticAnalysis: semanticStage(),
    behaviorReport: reportStage(),
    knowledgeResearch: knowledgeStage(),
  },
}));

export default app;
