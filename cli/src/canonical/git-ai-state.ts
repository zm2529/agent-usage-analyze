import { createHash } from 'node:crypto';
import type Database from 'better-sqlite3';
import {
  inspectGitAiSidecar,
  readGitAiSidecarConfig,
  type GitAiSidecarConfig,
} from '../sidecars/git-ai-manager.js';

export type GitAiScenarioKind =
  | 'clean'
  | 'pre-existing-dirty'
  | 'missing-baseline'
  | 'partial-stage'
  | 'amend'
  | 'rebase'
  | 'linked-worktree'
  | 'same-worktree-concurrent'
  | 'unsupported-client';

export interface GitAiScenarioReport {
  kind: GitAiScenarioKind;
  support: 'supported' | 'limited' | 'abstained';
  outcome: 'candidate' | 'abstained';
  reason: string | null;
}

export interface GitAiGateReport {
  id: string;
  status: 'passed' | 'failed';
  sourceVersion: '1.6.16';
  sourceCommit: typeof SOURCE_COMMIT;
  notesSchema: 'authorship/3.0.0';
  notesExportPolicy: 'local-explicit';
  candidateEvidence: number;
  abstentions: number;
  scenarios: GitAiScenarioReport[];
  failureCodes: string[];
  completedAt: string;
  reportHash: string;
}

export interface GitAiSidecarState {
  status: 'disabled' | 'testing' | 'passed' | 'failed';
  gatePassed: boolean;
  configured: boolean;
  configuredEnabled: boolean;
  binaryHealthy: boolean;
  binaryVersion: string | null;
  consumptionEnabled: boolean;
  sourceVersion: '1.6.16';
  sourceCommit: typeof SOURCE_COMMIT;
  notesSchema: 'authorship/3.0.0';
  notesExportPolicy: GitAiSidecarConfig['notesExportPolicy'];
  automaticRepositoryMutation: false;
  latestRun: GitAiGateReport | null;
  stateError: 'corrupt-report' | 'corrupt-config' | 'config-unavailable'
    | 'sidecar-health-check-failed' | null;
}

export const SOURCE_COMMIT = 'da79071f21f3b018aa7d4ee4e7d5fa8bf3555a88' as const;
export const REQUIRED_SCENARIOS: GitAiScenarioKind[] = [
  'clean', 'pre-existing-dirty', 'missing-baseline', 'partial-stage', 'amend', 'rebase',
  'linked-worktree', 'same-worktree-concurrent', 'unsupported-client',
];
const CODE = /^[a-z0-9][a-z0-9-]{0,63}$/;

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid record');
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, keys: string[]): void {
  if (Object.keys(value).length !== keys.length
      || Object.keys(value).some((key) => !keys.includes(key))
      || keys.some((key) => !(key in value))) throw new Error('invalid keys');
}

export function parseGitAiGateReport(value: unknown): GitAiGateReport | null {
  if (typeof value !== 'string') return null;
  try {
    const parsed = record(JSON.parse(value));
    exactKeys(parsed, [
      'id', 'status', 'sourceVersion', 'sourceCommit', 'notesSchema', 'notesExportPolicy',
      'candidateEvidence', 'abstentions', 'scenarios', 'failureCodes', 'completedAt', 'reportHash',
    ]);
    if (typeof parsed.id !== 'string' || !/^git-ai-gate:[0-9a-f-]{36}$/.test(parsed.id)
        || !['passed', 'failed'].includes(String(parsed.status))
        || parsed.sourceVersion !== '1.6.16' || parsed.sourceCommit !== SOURCE_COMMIT
        || parsed.notesSchema !== 'authorship/3.0.0' || parsed.notesExportPolicy !== 'local-explicit'
        || !Number.isSafeInteger(parsed.candidateEvidence) || Number(parsed.candidateEvidence) < 0
        || Number(parsed.candidateEvidence) > REQUIRED_SCENARIOS.length
        || !Number.isSafeInteger(parsed.abstentions) || Number(parsed.abstentions) < 0
        || Number(parsed.abstentions) > REQUIRED_SCENARIOS.length
        || Number(parsed.candidateEvidence) + Number(parsed.abstentions) > REQUIRED_SCENARIOS.length
        || !Array.isArray(parsed.scenarios) || !Array.isArray(parsed.failureCodes)
        || !parsed.failureCodes.every((code) => typeof code === 'string' && CODE.test(code))
        || typeof parsed.completedAt !== 'string' || !Number.isFinite(Date.parse(parsed.completedAt))
        || typeof parsed.reportHash !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(parsed.reportHash)) return null;
    const scenarioKinds = new Set<string>();
    for (const rawScenario of parsed.scenarios) {
      const scenario = record(rawScenario);
      exactKeys(scenario, ['kind', 'support', 'outcome', 'reason']);
      if (!REQUIRED_SCENARIOS.includes(scenario.kind as GitAiScenarioKind)
          || scenarioKinds.has(String(scenario.kind))
          || !['supported', 'limited', 'abstained'].includes(String(scenario.support))
          || !['candidate', 'abstained'].includes(String(scenario.outcome))
          || !(scenario.reason === null || (typeof scenario.reason === 'string' && CODE.test(scenario.reason)))) return null;
      scenarioKinds.add(String(scenario.kind));
    }
    if (parsed.status === 'passed' && (parsed.failureCodes.length !== 0
        || scenarioKinds.size !== REQUIRED_SCENARIOS.length
        || Number(parsed.candidateEvidence) !== 5 || Number(parsed.abstentions) !== 4)) return null;
    const { reportHash, ...withoutHash } = parsed;
    if (reportHash !== `sha256:${hash(JSON.stringify(withoutHash))}`) return null;
    return parsed as unknown as GitAiGateReport;
  } catch {
    return null;
  }
}

export function readGitAiSidecarState(db: Database.Database): GitAiSidecarState {
  const latest = db.prepare(`SELECT status, report_json AS reportJson
    FROM git_ai_gate_runs ORDER BY sequence DESC LIMIT 1`).get() as {
    status: 'testing' | 'passed' | 'failed'; reportJson: string | null;
  } | undefined;
  const report = parseGitAiGateReport(latest?.reportJson);
  const corrupt = latest !== undefined && latest.status !== 'testing'
    && (report === null || report.status !== latest.status);
  const configRead = readGitAiSidecarConfig();
  const config = configRead.status === 'ready' ? configRead.config : null;
  let binaryHealthy = false;
  let binaryVersion: string | null = null;
  let healthCheckFailed = false;
  if (config) {
    try {
      const inspection = inspectGitAiSidecar();
      binaryHealthy = inspection.healthy;
      binaryVersion = inspection.binaryVersion;
    } catch {
      healthCheckFailed = true;
    }
  }
  if (corrupt) {
    return {
      status: 'failed', gatePassed: false, configured: config !== null,
      configuredEnabled: config?.enabled ?? false, binaryHealthy, binaryVersion, consumptionEnabled: false,
      sourceVersion: '1.6.16', sourceCommit: SOURCE_COMMIT, notesSchema: 'authorship/3.0.0',
      notesExportPolicy: config?.notesExportPolicy ?? 'local-only', automaticRepositoryMutation: false,
      latestRun: null, stateError: 'corrupt-report',
    };
  }
  const gatePassed = latest?.status === 'passed';
  const stateError = configRead.status === 'corrupt' ? 'corrupt-config'
    : configRead.status === 'unavailable' ? 'config-unavailable'
      : healthCheckFailed ? 'sidecar-health-check-failed' : null;
  return {
    status: latest?.status ?? 'disabled', gatePassed, configured: config !== null,
    configuredEnabled: config?.enabled ?? false, binaryHealthy, binaryVersion,
    consumptionEnabled: gatePassed && (config?.enabled ?? false) && binaryHealthy && stateError === null,
    sourceVersion: '1.6.16', sourceCommit: SOURCE_COMMIT, notesSchema: 'authorship/3.0.0',
    notesExportPolicy: config?.notesExportPolicy ?? 'local-only', automaticRepositoryMutation: false,
    latestRun: report, stateError,
  };
}

export function gitAiConsumptionEnabled(db: Database.Database): boolean {
  return readGitAiSidecarState(db).consumptionEnabled;
}
