import { createHash, randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { discoverRepositoryDeliveries, listDeliveries } from './deliveries.js';
import { gitCommitExists, repositoryIdentity } from './delivery-repository.js';

export type BuildermarkMatchKind = 'exact' | 'formatting' | 'fallback' | 'deletion';
export type BuildermarkGateStatus = 'disabled' | 'testing' | 'passed' | 'failed';

export interface BuildermarkEvidenceEnvelope {
  schemaVersion: 'agent-analytics.buildermark-evidence.v1';
  helper: { name: 'buildermark'; version: string; sourceCommit: string };
  mode: 'synthetic' | 'real';
  safety: { offline: boolean; remoteWrites: boolean; historyMutated: boolean };
  commits: Array<{
    objectId: string;
    candidates: Array<{
      taskRef: string;
      status: 'candidate' | 'abstained';
      evidence: Array<{ kind: BuildermarkMatchKind; matchedLines: number; confidence: number }>;
      diagnostics: string[];
    }>;
  }>;
  review: { reviewedCandidates: number; obviousMisattributions: number };
}

export interface BuildermarkGateReport {
  id: string;
  helper: 'buildermark';
  helperVersion: string;
  helperSourceCommit: string;
  evidenceSchemaVersion: string;
  mode: 'synthetic' | 'real';
  status: 'testing' | 'passed' | 'failed';
  importedCommits: number;
  referencedCommits: number;
  candidates: number;
  reviewedCandidates: number;
  obviousMisattributions: number;
  evidenceCounts: Record<BuildermarkMatchKind, number>;
  diagnosticCodes: string[];
  failureCodes: string[];
  reportHash: string;
  completedAt: string;
}

export interface BuildermarkGateState {
  status: BuildermarkGateStatus;
  candidateEnabled: boolean;
  latestRun: BuildermarkGateReport | null;
  realGatePassed: boolean;
  syntheticGatePassed: boolean;
  stateError: 'corrupt-report' | null;
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

const FORBIDDEN_RAW_FIELDS = new Set([
  'prompt', 'content', 'diff', 'path', 'projectPath', 'repositoryPath',
  'email', 'subject', 'message', 'code', 'raw', 'conversationTitle',
]);

function assertNoRawFields(value: unknown, seen = new WeakSet<object>()): void {
  if (value === null || typeof value !== 'object' || seen.has(value)) return;
  seen.add(value);
  if (Array.isArray(value)) {
    for (const item of value) assertNoRawFields(item, seen);
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_RAW_FIELDS.has(key)) throw new Error(`Buildermark evidence contains forbidden raw field: ${key}`);
    assertNoRawFields(child, seen);
  }
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Invalid Buildermark evidence ${label}`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, allowed: string[]): void {
  const allowedSet = new Set(allowed);
  const unexpected = Object.keys(value).find((key) => !allowedSet.has(key));
  if (unexpected) throw new Error(`Buildermark evidence has unexpected field: ${unexpected}`);
  const missing = allowed.find((key) => !(key in value));
  if (missing) throw new Error(`Buildermark evidence is missing field: ${missing}`);
}

const MAX_GATE_COUNT = 1_000_000_000;

function nonNegativeInteger(value: unknown): boolean {
  return Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= MAX_GATE_COUNT;
}

function positiveInteger(value: unknown): boolean {
  return Number.isSafeInteger(value) && Number(value) > 0 && Number(value) <= MAX_GATE_COUNT;
}

export function parseBuildermarkEvidence(value: unknown): BuildermarkEvidenceEnvelope {
  assertNoRawFields(value);
  const root = record(value, 'root');
  exactKeys(root, ['schemaVersion', 'helper', 'mode', 'safety', 'commits', 'review']);
  if (root.schemaVersion !== 'agent-analytics.buildermark-evidence.v1') {
    throw new Error('Unsupported Buildermark evidence contract');
  }
  if (!['synthetic', 'real'].includes(String(root.mode))) throw new Error('Invalid Buildermark evidence mode');

  const helper = record(root.helper, 'helper');
  exactKeys(helper, ['name', 'version', 'sourceCommit']);
  if (helper.name !== 'buildermark' || helper.version !== 'v1.1.0'
      || helper.sourceCommit !== '6c6374bd6b09eaf30595e3b81143baa4c92678ce') {
    throw new Error('Unsupported Buildermark helper version');
  }

  const safety = record(root.safety, 'safety');
  exactKeys(safety, ['offline', 'remoteWrites', 'historyMutated']);
  if (typeof safety.offline !== 'boolean' || typeof safety.remoteWrites !== 'boolean'
      || typeof safety.historyMutated !== 'boolean') throw new Error('Invalid Buildermark safety evidence');

  if (!Array.isArray(root.commits)) throw new Error('Invalid Buildermark commit evidence');
  const seenCommits = new Set<string>();
  let candidateCount = 0;
  let matchedLineCount = 0;
  for (const rawCommit of root.commits) {
    const commit = record(rawCommit, 'commit');
    exactKeys(commit, ['objectId', 'candidates']);
    if (typeof commit.objectId !== 'string' || !/^[a-f0-9]{40}([a-f0-9]{24})?$/.test(commit.objectId)) {
      throw new Error('Invalid Buildermark commit object id');
    }
    if (seenCommits.has(commit.objectId)) throw new Error('Duplicate Buildermark commit object id');
    seenCommits.add(commit.objectId);
    if (!Array.isArray(commit.candidates)) throw new Error('Invalid Buildermark candidates');
    for (const rawCandidate of commit.candidates) {
      candidateCount += 1;
      if (candidateCount > MAX_GATE_COUNT) throw new Error('Invalid Buildermark candidates');
      const candidate = record(rawCandidate, 'candidate');
      exactKeys(candidate, ['taskRef', 'status', 'evidence', 'diagnostics']);
      if (typeof candidate.taskRef !== 'string' || !/^task:sha256:[a-f0-9]{64}$/.test(candidate.taskRef)) {
        throw new Error('Invalid Buildermark opaque task reference');
      }
      if (!['candidate', 'abstained'].includes(String(candidate.status))) {
        throw new Error('Invalid Buildermark candidate status');
      }
      if (!Array.isArray(candidate.evidence) || !Array.isArray(candidate.diagnostics)) {
        throw new Error('Invalid Buildermark candidate evidence');
      }
      for (const rawMatch of candidate.evidence) {
        const match = record(rawMatch, 'match');
        exactKeys(match, ['kind', 'matchedLines', 'confidence']);
        if (!['exact', 'formatting', 'fallback', 'deletion'].includes(String(match.kind))
            || !positiveInteger(match.matchedLines)
            || typeof match.confidence !== 'number' || !Number.isFinite(match.confidence)
            || match.confidence < 0 || match.confidence > 1) {
          throw new Error('Invalid Buildermark match evidence');
        }
        matchedLineCount += Number(match.matchedLines);
        if (matchedLineCount > MAX_GATE_COUNT) throw new Error('Invalid Buildermark match evidence');
      }
      if (!candidate.diagnostics.every((code) => typeof code === 'string'
        && /^[a-z0-9][a-z0-9-]{0,63}$/.test(code))) {
        throw new Error('Invalid Buildermark diagnostic code');
      }
    }
  }

  const review = record(root.review, 'review');
  exactKeys(review, ['reviewedCandidates', 'obviousMisattributions']);
  if (!nonNegativeInteger(review.reviewedCandidates) || !nonNegativeInteger(review.obviousMisattributions)
      || Number(review.obviousMisattributions) > Number(review.reviewedCandidates)) {
    throw new Error('Invalid Buildermark review counts');
  }
  return root as unknown as BuildermarkEvidenceEnvelope;
}

function parseReport(value: unknown): BuildermarkGateReport | null {
  if (typeof value !== 'string') return null;
  try {
    const parsed = record(JSON.parse(value), 'stored gate report');
    exactKeys(parsed, [
      'id', 'helper', 'helperVersion', 'helperSourceCommit', 'evidenceSchemaVersion', 'mode',
      'status', 'importedCommits', 'referencedCommits', 'candidates', 'reviewedCandidates',
      'obviousMisattributions', 'evidenceCounts', 'diagnosticCodes', 'failureCodes',
      'completedAt', 'reportHash',
    ]);
    const counts = record(parsed.evidenceCounts, 'stored evidence counts');
    exactKeys(counts, ['exact', 'formatting', 'fallback', 'deletion']);
    if (parsed.helper !== 'buildermark' || parsed.helperVersion !== 'v1.1.0'
        || parsed.helperSourceCommit !== '6c6374bd6b09eaf30595e3b81143baa4c92678ce'
        || parsed.evidenceSchemaVersion !== 'agent-analytics.buildermark-evidence.v1'
        || !['synthetic', 'real'].includes(String(parsed.mode))
        || !['passed', 'failed'].includes(String(parsed.status))
        || !['importedCommits', 'referencedCommits', 'candidates', 'reviewedCandidates', 'obviousMisattributions']
          .every((key) => nonNegativeInteger(parsed[key]))
        || !Object.values(counts).every(nonNegativeInteger)
        || !Array.isArray(parsed.diagnosticCodes) || !parsed.diagnosticCodes.every((code) => typeof code === 'string')
        || !Array.isArray(parsed.failureCodes) || !parsed.failureCodes.every((code) => typeof code === 'string')
        || typeof parsed.completedAt !== 'string' || !Number.isFinite(Date.parse(parsed.completedAt))
        || typeof parsed.reportHash !== 'string') return null;
    const { reportHash, ...withoutHash } = parsed;
    if (reportHash !== `sha256:${hash(JSON.stringify(withoutHash))}`) return null;
    return parsed as unknown as BuildermarkGateReport;
  } catch {
    return null;
  }
}

function evaluate(
  evidence: BuildermarkEvidenceEnvelope,
  importedCommits: number,
): Omit<BuildermarkGateReport, 'id' | 'helper' | 'helperVersion' | 'helperSourceCommit'
  | 'evidenceSchemaVersion' | 'mode' | 'status' | 'reportHash' | 'completedAt'> & { failureCodes: string[] } {
  const evidenceCounts: Record<BuildermarkMatchKind, number> = {
    exact: 0, formatting: 0, fallback: 0, deletion: 0,
  };
  const diagnostics = new Set<string>();
  let candidates = 0;
  let explainableCandidates = 0;
  for (const commit of evidence.commits) {
    for (const candidate of commit.candidates) {
      candidates += 1;
      if (candidate.status === 'candidate' && candidate.evidence.length > 0) explainableCandidates += 1;
      for (const record of candidate.evidence) evidenceCounts[record.kind] += record.matchedLines;
      for (const code of candidate.diagnostics) diagnostics.add(code);
    }
  }

  const failureCodes: string[] = [];
  if (!evidence.safety.offline) failureCodes.push('network-not-disabled');
  if (evidence.safety.remoteWrites) failureCodes.push('remote-write-detected');
  if (evidence.safety.historyMutated) failureCodes.push('history-mutation-detected');
  if (importedCommits !== evidence.commits.length || importedCommits === 0) failureCodes.push('commit-import-incomplete');
  if (explainableCandidates === 0 || Object.values(evidenceCounts).every((count) => count === 0)) {
    failureCodes.push('no-explainable-candidate');
  }
  if (evidence.mode === 'synthetic') {
    for (const kind of Object.keys(evidenceCounts) as BuildermarkMatchKind[]) {
      if (evidenceCounts[kind] === 0) failureCodes.push(`missing-${kind}-evidence`);
    }
    if (diagnostics.size === 0) failureCodes.push('missing-error-diagnostic');
  }
  if (evidence.mode === 'real') {
    if (evidence.review.reviewedCandidates === 0) failureCodes.push('real-review-missing');
    if (evidence.review.obviousMisattributions > 0) failureCodes.push('obvious-misattribution');
  }
  return {
    importedCommits,
    referencedCommits: evidence.commits.length,
    candidates,
    reviewedCandidates: evidence.review.reviewedCandidates,
    obviousMisattributions: evidence.review.obviousMisattributions,
    evidenceCounts,
    diagnosticCodes: [...diagnostics].sort(),
    failureCodes,
  };
}

function persistGateReport(
  db: Database.Database,
  input: { id: string; evidence: BuildermarkEvidenceEnvelope; evaluated: ReturnType<typeof evaluate> },
): BuildermarkGateReport {
  const { id, evidence, evaluated } = input;
  const completedAt = new Date().toISOString();
  const status: BuildermarkGateReport['status'] = evaluated.failureCodes.length === 0 ? 'passed' : 'failed';
  const reportWithoutHash = {
    id, helper: 'buildermark' as const, helperVersion: evidence.helper.version,
    helperSourceCommit: evidence.helper.sourceCommit,
    evidenceSchemaVersion: evidence.schemaVersion, mode: evidence.mode, status,
    ...evaluated, completedAt,
  };
  const report: BuildermarkGateReport = {
    ...reportWithoutHash,
    reportHash: `sha256:${hash(JSON.stringify(reportWithoutHash))}`,
  };
  db.prepare(`UPDATE buildermark_gate_runs
    SET status = ?, report_json = ?, failure_codes_json = ?, completed_at = ? WHERE id = ?`)
    .run(status, JSON.stringify(report), JSON.stringify(report.failureCodes), completedAt, id);
  return report;
}

export function runBuildermarkGate(
  db: Database.Database,
  input: { repositoryPath: string; evidence: BuildermarkEvidenceEnvelope },
): BuildermarkGateReport {
  const evidence = parseBuildermarkEvidence(input.evidence);
  const startedAt = new Date().toISOString();
  const id = `buildermark-gate:${randomUUID()}`;
  const repoIdentity = repositoryIdentity(input.repositoryPath);
  db.prepare(`INSERT INTO buildermark_gate_runs (
    id, helper_version, helper_source_commit, evidence_schema_version, mode, status,
    repository_identity, started_at
  ) VALUES (?, ?, ?, ?, ?, 'testing', ?, ?)`).run(
    id, evidence.helper.version, evidence.helper.sourceCommit, evidence.schemaVersion,
    evidence.mode, repoIdentity, startedAt,
  );

  let evaluated: ReturnType<typeof evaluate>;
  try {
    discoverRepositoryDeliveries(db, { repositoryPath: input.repositoryPath });
    const referenced = new Set(evidence.commits.map((commit) => commit.objectId));
    const currentCommits = new Set([...referenced]
      .filter((objectId) => gitCommitExists(input.repositoryPath, objectId)));
    const importedCommits = listDeliveries(db)
      .filter((delivery) => delivery.kind === 'git-commit'
        && delivery.repositoryIdentity === repoIdentity && currentCommits.has(delivery.resultIdentity)).length;
    evaluated = evaluate(evidence, importedCommits);
  } catch {
    evaluated = evaluate(evidence, 0);
    evaluated.failureCodes = [
      'commit-import-failed',
      ...evaluated.failureCodes.filter((code) => code !== 'commit-import-incomplete'),
    ];
  }
  return persistGateReport(db, { id, evidence, evaluated });
}

export function readBuildermarkGateState(db: Database.Database): BuildermarkGateState {
  const latest = db.prepare(`SELECT status, report_json AS reportJson
    FROM buildermark_gate_runs ORDER BY sequence DESC LIMIT 1`)
    .get() as { status: 'testing' | 'passed' | 'failed'; reportJson: string | null } | undefined;
  const latestReport = parseReport(latest?.reportJson);
  const latestModes = db.prepare(`SELECT mode, status, report_json AS reportJson
    FROM buildermark_gate_runs run
    WHERE sequence = (SELECT MAX(sequence) FROM buildermark_gate_runs WHERE mode = run.mode)`)
    .all() as Array<{
      mode: 'synthetic' | 'real';
      status: 'testing' | 'passed' | 'failed';
      reportJson: string | null;
    }>;
  const latestModeReports = latestModes.map((row) => ({ row, report: parseReport(row.reportJson) }));
  const corruptReport = (latest !== undefined && latest.status !== 'testing'
      && (latestReport === null || latestReport.status !== latest.status))
    || latestModeReports.some(({ row, report }) => row.status !== 'testing'
      && (report === null || report.mode !== row.mode || report.status !== row.status));
  if (corruptReport) {
    return {
      status: 'failed', candidateEnabled: false, latestRun: null,
      realGatePassed: false, syntheticGatePassed: false, stateError: 'corrupt-report',
    };
  }
  const modeStatus = new Map(latestModes.map((row) => [row.mode, row.status]));
  const realGatePassed = modeStatus.get('real') === 'passed';
  const syntheticGatePassed = modeStatus.get('synthetic') === 'passed';
  return {
    status: latest?.status ?? 'disabled',
    candidateEnabled: realGatePassed && syntheticGatePassed && latest?.status === 'passed',
    latestRun: latestReport,
    realGatePassed,
    syntheticGatePassed,
    stateError: null,
  };
}
