import { Hono } from 'hono';
import { getDb } from 'agent-usage-analyze/db/client';
import { listAnalysisRuns } from 'agent-usage-analyze/analysis/analysis-run-db';
import {
  BEHAVIOR_REPORT_PROMPT_VERSION,
  behaviorReportUnavailableReason,
  buildBehaviorReportDataset,
  generateBehaviorReport,
} from 'agent-usage-analyze/analysis/behavior-report';
import type { BehaviorReportDataset } from 'agent-usage-analyze/analysis/behavior-report';
import { getAutomaticBehaviorReportState } from 'agent-usage-analyze/analysis/behavior-report-scheduler';

const app = new Hono();
let activeBehaviorReportJob: Promise<void> | null = null;
let activeBehaviorReportStartedAt: string | null = null;
let activeBehaviorReportSnapshot: ReturnType<typeof latestState> | null = null;

function latestState() {
  const db = getDb();
  const run = listAnalysisRuns({ analysisType: 'behavior_report', limit: 1 }, db)[0] ?? null;
  const isCurrentVersion = run?.promptVersion === BEHAVIOR_REPORT_PROMPT_VERSION;
  const cachedLeverage = run?.inputSummary.leverage as BehaviorReportDataset['leverage'] | undefined;
  const hasCurrentEvidenceSnapshot = Boolean(
    isCurrentVersion && cachedLeverage?.skills?.items?.every((item) => Array.isArray(item.weeklyInvocations)),
  );
  const dataset = buildBehaviorReportDataset(db, new Date(), { includeLeverage: !hasCurrentEvidenceSnapshot });
  if (hasCurrentEvidenceSnapshot && cachedLeverage?.skills?.items && cachedLeverage?.tools?.families) {
    dataset.leverage = cachedLeverage;
  }
  let report: unknown = null;
  if (isCurrentVersion && run?.status === 'completed' && run.outputJson) {
    try { report = JSON.parse(run.outputJson) as unknown; } catch { report = null; }
  }
  return {
    dataset,
    eligibilityReason: behaviorReportUnavailableReason(dataset),
    run,
    report,
    needsRegeneration: Boolean(run && !isCurrentVersion),
    automation: getAutomaticBehaviorReportState(db),
    generation: {
      running: activeBehaviorReportJob !== null,
      startedAt: activeBehaviorReportStartedAt,
    },
  };
}

app.get('/', (c) => c.json(activeBehaviorReportSnapshot
  ? {
      ...activeBehaviorReportSnapshot,
      generation: { running: true, startedAt: activeBehaviorReportStartedAt },
    }
  : latestState()));

app.post('/run', (c) => {
  if (!activeBehaviorReportJob) {
    activeBehaviorReportStartedAt = new Date().toISOString();
    activeBehaviorReportSnapshot = latestState();
    activeBehaviorReportJob = generateBehaviorReport({ db: getDb() })
      .then(() => undefined)
      .catch((error) => { console.error('Behavior report generation failed', error); })
      .finally(() => {
        activeBehaviorReportJob = null;
        activeBehaviorReportStartedAt = null;
        activeBehaviorReportSnapshot = null;
      });
  }
  return c.json({
    ...(activeBehaviorReportSnapshot ?? latestState()),
    generation: { running: true, startedAt: activeBehaviorReportStartedAt },
  });
});

export default app;
