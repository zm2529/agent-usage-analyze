import { Hono } from 'hono';
import { getDb } from 'agent-usage-analyze/db/client';
import { listAnalysisRuns } from 'agent-usage-analyze/analysis/analysis-run-db';
import {
  BEHAVIOR_REPORT_PROMPT_VERSION,
  behaviorReportUnavailableReason,
  buildBehaviorReportDataset,
} from 'agent-usage-analyze/analysis/behavior-report';
import type { BehaviorReportDataset } from 'agent-usage-analyze/analysis/behavior-report';
import {
  getAutomaticBehaviorReportState,
  spawnManualBehaviorReport,
} from 'agent-usage-analyze/analysis/behavior-report-scheduler';

const app = new Hono();
let activeBehaviorReportJob: Promise<void> | null = null;
let activeBehaviorReportStartedAt: string | null = null;
let activeBehaviorReportSnapshot: ReturnType<typeof latestState> | null = null;
let lastServedBehaviorReportSnapshot: ReturnType<typeof latestState> | null = null;

export function getBehaviorReportGenerationStatus() {
  return {
    running: activeBehaviorReportJob !== null,
    startedAt: activeBehaviorReportStartedAt,
  };
}

function latestState() {
  const db = getDb();
  const runs = listAnalysisRuns({ analysisType: 'behavior_report', limit: 100 }, db);
  const latestAttempt = runs[0] ?? null;
  const currentCompletedRun = runs.find((candidate) => candidate.status === 'completed'
    && candidate.promptVersion === BEHAVIOR_REPORT_PROMPT_VERSION
    && candidate.outputJson);
  const run = currentCompletedRun ?? latestAttempt;
  const latestAttemptIsCurrentVersion = latestAttempt?.promptVersion === BEHAVIOR_REPORT_PROMPT_VERSION;
  const datasetSourceRun = currentCompletedRun ?? latestAttempt;
  const cachedInput = datasetSourceRun?.inputSummary;
  const cachedLeverage = cachedInput?.leverage as BehaviorReportDataset['leverage'] | undefined;
  const hasCurrentEvidenceSnapshot = Boolean(
    cachedInput?.window
      && cachedInput?.basis
      && cachedInput?.coverage
      && cachedInput?.activity
      && cachedInput?.promptSignals
      && cachedInput?.runtimeUsage
      && cachedInput?.contextDocuments
      && cachedInput?.tokenEfficiency
      && cachedLeverage?.skills?.items?.every((item) => Array.isArray(item.weeklyInvocations)),
  );
  const dataset = hasCurrentEvidenceSnapshot
    ? structuredClone(cachedInput) as unknown as BehaviorReportDataset
    : buildBehaviorReportDataset(db, new Date());
  if (hasCurrentEvidenceSnapshot) {
    const latestSession = db.prepare(`SELECT MAX(ended_at) AS latestSessionAt FROM sessions`)
      .get() as { latestSessionAt: string | null };
    if (latestSession.latestSessionAt) {
      dataset.basis.latestSessionAt = latestSession.latestSessionAt;
    }
  }
  let report: unknown = null;
  if (currentCompletedRun?.outputJson) {
    try { report = JSON.parse(currentCompletedRun.outputJson) as unknown; } catch { report = null; }
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
      (!currentCompletedRun && Boolean(run))
      || latestAttemptFailed,
    ),
    automation: getAutomaticBehaviorReportState(db, new Date(), dataset),
    generation: {
      running: activeBehaviorReportJob !== null,
      startedAt: activeBehaviorReportStartedAt,
    },
  };
}

function summaryState() {
  const db = getDb();
  const latestAttempt = db.prepare(`SELECT status, prompt_version AS promptVersion,
      unavailable_reason AS unavailableReason, created_at AS createdAt
    FROM analysis_runs WHERE analysis_type = 'behavior_report'
    ORDER BY created_at DESC, id DESC LIMIT 1`).get() as {
      status: 'completed' | 'unavailable' | 'failed' | 'rejected';
      promptVersion: string;
      unavailableReason: string | null;
      createdAt: string;
    } | undefined;
  const current = db.prepare(`SELECT prompt_version AS promptVersion,
      input_summary_json AS inputSummaryJson, output_json AS outputJson,
      created_at AS createdAt
    FROM analysis_runs
    WHERE analysis_type = 'behavior_report' AND status = 'completed'
      AND prompt_version = ? AND output_json IS NOT NULL
    ORDER BY created_at DESC, id DESC LIMIT 1`).get(BEHAVIOR_REPORT_PROMPT_VERSION) as {
      promptVersion: string;
      inputSummaryJson: string;
      outputJson: string;
      createdAt: string;
    } | undefined;
  let headline: string | null = null;
  if (current?.outputJson) {
    try {
      const parsed = JSON.parse(current.outputJson) as { headline?: unknown };
      headline = typeof parsed.headline === 'string' ? parsed.headline : null;
    } catch { /* malformed historical output is reported as unavailable */ }
  }
  let inputSummary: Record<string, unknown> = {};
  try {
    inputSummary = current?.inputSummaryJson
      ? JSON.parse(current.inputSummaryJson) as Record<string, unknown> : {};
  } catch { /* malformed historical input summary has no usable cutoff */ }
  const basis = inputSummary.basis;
  const evidenceCutoff = basis && typeof basis === 'object' && !Array.isArray(basis)
    && typeof (basis as Record<string, unknown>).latestSessionAt === 'string'
    ? String((basis as Record<string, unknown>).latestSessionAt)
    : null;
  return {
    promptVersion: BEHAVIOR_REPORT_PROMPT_VERSION,
    report: current ? {
      headline,
      generatedAt: current.createdAt,
      evidenceCutoff,
      promptVersion: current.promptVersion,
    } : null,
    latestAttempt: latestAttempt ? {
      status: latestAttempt.status,
      createdAt: latestAttempt.createdAt,
      promptVersion: latestAttempt.promptVersion,
      unavailableReason: latestAttempt.unavailableReason,
    } : null,
    generation: getBehaviorReportGenerationStatus(),
  };
}

app.get('/summary', (c) => c.json(summaryState()));

app.get('/', (c) => {
  if (activeBehaviorReportSnapshot) return c.json({
      ...activeBehaviorReportSnapshot,
      generation: { running: true, startedAt: activeBehaviorReportStartedAt },
    });
  const state = latestState();
  lastServedBehaviorReportSnapshot = state;
  return c.json(state);
});

app.post('/run', (c) => {
  if (!activeBehaviorReportJob) {
    activeBehaviorReportStartedAt = new Date().toISOString();
    activeBehaviorReportSnapshot = lastServedBehaviorReportSnapshot;
    activeBehaviorReportJob = spawnManualBehaviorReport()
      .catch((error) => { console.error('Behavior report generation failed', error); })
      .finally(() => {
        activeBehaviorReportJob = null;
        activeBehaviorReportStartedAt = null;
        activeBehaviorReportSnapshot = null;
        lastServedBehaviorReportSnapshot = null;
      });
  }
  return c.json({
    accepted: true,
    generation: {
      running: activeBehaviorReportJob !== null,
      startedAt: activeBehaviorReportStartedAt,
    },
  });
});

export default app;
