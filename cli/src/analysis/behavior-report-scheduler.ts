import { spawn } from 'child_process';
import { closeSync, existsSync, mkdirSync, openSync } from 'fs';
import { join, resolve } from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';
import { getDb, getDbPath } from '../db/client.js';
import { getConfigDir, loadConfig } from '../utils/config.js';
import { listAnalysisRuns } from './analysis-run-db.js';
import {
  BEHAVIOR_REPORT_PROMPT_VERSION,
  behaviorReportUnavailableReason,
  buildBehaviorReportDataset,
  generateBehaviorReport,
} from './behavior-report.js';

const CLI_ENTRY = resolve(fileURLToPath(import.meta.url), '../../index.js');
const REPORT_INTERVAL_MS = 24 * 60 * 60 * 1_000;

export interface AutomaticBehaviorReportState {
  enabled: boolean;
  due: boolean;
  reason: 'disabled' | 'insufficient-evidence' | 'up-to-date' | 'cooldown' | 'due';
  policy: 'hook-after-settle';
  intervalHours: 24;
  latestAttemptAt: string | null;
  latestSuccessfulAt: string | null;
  latestEvidenceAt: string | null;
  nextEligibleAt: string | null;
}

function reportEvidenceCutoff(run: ReturnType<typeof listAnalysisRuns>[number] | undefined): string | null {
  const basis = run?.inputSummary.basis;
  if (!basis || typeof basis !== 'object' || Array.isArray(basis)) return null;
  const value = (basis as Record<string, unknown>).latestSessionAt;
  return typeof value === 'string' ? value : null;
}

export function getAutomaticBehaviorReportState(
  db: Database.Database = getDb(),
  now = new Date(),
): AutomaticBehaviorReportState {
  const enabled = loadConfig()?.dashboard?.capabilities?.automaticBehaviorReport !== false;
  const runs = listAnalysisRuns({ analysisType: 'behavior_report', limit: 100 }, db);
  const latestAttempt = runs[0];
  const latestSuccessful = runs.find((run) => run.status === 'completed');
  const dataset = buildBehaviorReportDataset(db, now, { includeLeverage: false });
  const latestEvidenceAt = dataset.basis.latestSessionAt;
  const latestAttemptAt = latestAttempt?.createdAt ?? null;
  const latestSuccessfulAt = latestSuccessful?.createdAt ?? null;
  const nextEligibleAt = latestAttemptAt
    ? new Date(Date.parse(latestAttemptAt) + REPORT_INTERVAL_MS).toISOString()
    : null;

  if (!enabled) return {
    enabled, due: false, reason: 'disabled', policy: 'hook-after-settle', intervalHours: 24,
    latestAttemptAt, latestSuccessfulAt, latestEvidenceAt, nextEligibleAt,
  };
  if (behaviorReportUnavailableReason(dataset)) return {
    enabled, due: false, reason: 'insufficient-evidence', policy: 'hook-after-settle', intervalHours: 24,
    latestAttemptAt, latestSuccessfulAt, latestEvidenceAt, nextEligibleAt,
  };
  const cutoff = reportEvidenceCutoff(latestSuccessful);
  const currentVersion = latestSuccessful?.promptVersion === BEHAVIOR_REPORT_PROMPT_VERSION;
  const hasNewEvidence = Boolean(latestEvidenceAt && (!cutoff || Date.parse(latestEvidenceAt) > Date.parse(cutoff)));
  if (latestSuccessful && currentVersion && !hasNewEvidence) return {
    enabled, due: false, reason: 'up-to-date', policy: 'hook-after-settle', intervalHours: 24,
    latestAttemptAt, latestSuccessfulAt, latestEvidenceAt, nextEligibleAt,
  };
  if (nextEligibleAt && Date.parse(nextEligibleAt) > now.getTime()) return {
    enabled, due: false, reason: 'cooldown', policy: 'hook-after-settle', intervalHours: 24,
    latestAttemptAt, latestSuccessfulAt, latestEvidenceAt, nextEligibleAt,
  };
  return {
    enabled, due: true, reason: 'due', policy: 'hook-after-settle', intervalHours: 24,
    latestAttemptAt, latestSuccessfulAt, latestEvidenceAt, nextEligibleAt,
  };
}

function acquireReportLease(databasePath: string): { release(): void } | null {
  const root = `${databasePath}.behavior-report`;
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const lockDb = new Database(join(root, 'lock.db'));
  try {
    lockDb.pragma('busy_timeout = 0');
    lockDb.pragma('journal_mode = DELETE');
    lockDb.exec('CREATE TABLE IF NOT EXISTS worker_lock (id INTEGER PRIMARY KEY CHECK (id = 1));');
    lockDb.prepare('INSERT OR IGNORE INTO worker_lock (id) VALUES (1)').run();
    lockDb.exec('BEGIN EXCLUSIVE');
    lockDb.prepare('UPDATE worker_lock SET id = 1 WHERE id = 1').run();
    return { release: () => { try { if (lockDb.inTransaction) lockDb.exec('ROLLBACK'); } finally { lockDb.close(); } } };
  } catch (error) {
    lockDb.close();
    if ((error as { code?: unknown }).code === 'SQLITE_BUSY') return null;
    throw error;
  }
}

/**
 * Start one report job under the cross-process lease. A concurrent request is
 * deliberately ignored: it is neither queued nor surfaced as a user-facing
 * error.
 */
export function startBehaviorReportWithLease(
  work: () => Promise<unknown>,
  databasePath = getDbPath(),
): Promise<void> | null {
  const lease = acquireReportLease(databasePath);
  if (!lease) return null;
  return Promise.resolve()
    .then(work)
    .then(() => undefined)
    .finally(() => lease.release());
}

export async function runAutomaticBehaviorReport(): Promise<AutomaticBehaviorReportState> {
  const job = startBehaviorReportWithLease(async () => {
    const db = getDb();
    const state = getAutomaticBehaviorReportState(db);
    if (state.due) await generateBehaviorReport({ db });
  });
  if (job) await job;
  return getAutomaticBehaviorReportState();
}

/** Spawned only after a Hook frontier was settled; it never scans source directories. */
export function spawnAutomaticBehaviorReport(): void {
  const configDir = getConfigDir();
  if (!existsSync(configDir)) mkdirSync(configDir, { recursive: true, mode: 0o700 });
  const logFd = openSync(join(configDir, 'behavior-report.log'), 'a', 0o600);
  try {
    const child = spawn(process.execPath, [CLI_ENTRY, 'behavior-report-auto'], {
      detached: true,
      stdio: ['ignore', logFd, logFd],
      env: { ...process.env, AGENT_ANALYTICS_HOOK_ACTIVE: '1' },
    });
    child.on('error', () => {});
    child.unref();
  } finally {
    closeSync(logFd);
  }
}
