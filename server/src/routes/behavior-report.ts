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
import {
  getAutomaticBehaviorReportState,
  startBehaviorReportWithLease,
} from 'agent-usage-analyze/analysis/behavior-report-scheduler';

const app = new Hono();
let activeBehaviorReportJob: Promise<void> | null = null;
let activeBehaviorReportStartedAt: string | null = null;
let activeBehaviorReportSnapshot: ReturnType<typeof latestState> | null = null;

function latestState() {
  const db = getDb();
  const runs = listAnalysisRuns({ analysisType: 'behavior_report', limit: 100 }, db);
  const latestAttempt = runs[0] ?? null;
  const currentCompletedRun = runs.find((candidate) => candidate.status === 'completed'
    && candidate.promptVersion === BEHAVIOR_REPORT_PROMPT_VERSION
    && candidate.outputJson);
  const compatibleCompletedRun = currentCompletedRun ?? runs.find((candidate) => {
    const version = /^behavior-report-v(\d+)$/.exec(candidate.promptVersion);
    return candidate.status === 'completed' && Boolean(candidate.outputJson)
      && Number(version?.[1] ?? 0) >= 6;
  });
  const run = compatibleCompletedRun ?? latestAttempt;
  const latestAttemptIsCurrentVersion = latestAttempt?.promptVersion === BEHAVIOR_REPORT_PROMPT_VERSION;
  const cachedLeverage = latestAttempt?.inputSummary.leverage as BehaviorReportDataset['leverage'] | undefined;
  const hasCurrentEvidenceSnapshot = Boolean(
    latestAttemptIsCurrentVersion
      && cachedLeverage?.skills?.items?.every((item) => Array.isArray(item.weeklyInvocations)),
  );
  const dataset = buildBehaviorReportDataset(db, new Date(), { includeLeverage: !hasCurrentEvidenceSnapshot });
  if (hasCurrentEvidenceSnapshot && cachedLeverage?.skills?.items && cachedLeverage?.tools?.families) {
    dataset.leverage = cachedLeverage;
  }
  let report: unknown = null;
  if (compatibleCompletedRun?.outputJson) {
    try { report = JSON.parse(compatibleCompletedRun.outputJson) as unknown; } catch { report = null; }
  }
  const latestAttemptFailed = latestAttemptIsCurrentVersion
    && (latestAttempt?.status === 'failed' || latestAttempt?.status === 'rejected');
  return {
    dataset,
    eligibilityReason: behaviorReportUnavailableReason(dataset),
    run,
    latestAttempt,
    report,
    needsRegeneration: Boolean(
      (run && run.promptVersion !== BEHAVIOR_REPORT_PROMPT_VERSION)
      || latestAttemptFailed,
    ),
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
    const leasedJob = startBehaviorReportWithLease(() => generateBehaviorReport({ db: getDb() }));
    if (leasedJob) {
      activeBehaviorReportJob = leasedJob
        .catch((error) => { console.error('Behavior report generation failed', error); })
        .finally(() => {
          activeBehaviorReportJob = null;
          activeBehaviorReportStartedAt = null;
          activeBehaviorReportSnapshot = null;
        });
    } else {
      activeBehaviorReportJob = null;
      activeBehaviorReportStartedAt = null;
      activeBehaviorReportSnapshot = null;
    }
  }
  return c.json({
    ...(activeBehaviorReportSnapshot ?? latestState()),
    generation: {
      running: activeBehaviorReportJob !== null,
      startedAt: activeBehaviorReportStartedAt,
    },
  });
});

export default app;
