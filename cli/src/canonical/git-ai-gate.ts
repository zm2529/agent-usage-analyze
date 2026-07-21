import { createHash, randomUUID } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import type Database from 'better-sqlite3';
import { discoverRepositoryDeliveries, listDeliveries } from './deliveries.js';
import { gitCommitExists, repositoryIdentity } from './delivery-repository.js';
import { tryRecordObserverOverhead } from './observer-overhead.js';
import {
  inspectGitAiSidecar,
} from '../sidecars/git-ai-manager.js';
import {
  REQUIRED_SCENARIOS,
  SOURCE_COMMIT,
  type GitAiGateReport,
  type GitAiScenarioKind,
  type GitAiScenarioReport as ScenarioReport,
} from './git-ai-state.js';

export { readGitAiSidecarState } from './git-ai-state.js';
export type { GitAiGateReport, GitAiScenarioKind, GitAiSidecarState } from './git-ai-state.js';

export interface GitAiProspectiveEvidenceEnvelope {
  schemaVersion: 'agent-analytics.git-ai-prospective-evidence.v1';
  sidecar: {
    name: 'git-ai';
    version: '1.6.16';
    sourceCommit: 'da79071f21f3b018aa7d4ee4e7d5fa8bf3555a88';
    notesSchema: 'authorship/3.0.0';
    patchStack: string[];
  };
  safety: {
    offline: boolean;
    disposableRepository: boolean;
    automaticHookInstall: boolean;
    notesPushed: boolean;
    userHistoryMutated: boolean;
  };
  scenarios: Array<{
    kind: GitAiScenarioKind;
    taskRef: string;
    commitObjectId: string;
    client: 'git-cli' | 'trace2-compatible' | 'unsupported';
    baseline: 'clean' | 'dirty' | 'missing';
    worktree: 'primary' | 'linked' | 'shared-concurrent';
    operation: 'commit' | 'partial-stage' | 'amend' | 'rebase';
    outcome: 'candidate' | 'abstained';
    confidence: 'high' | 'limited' | 'none';
    limitations: string[];
    abstainReason: string | null;
    noteExpected: boolean;
  }>;
}

const FORBIDDEN_RAW_FIELDS = new Set([
  'prompt', 'promptsText', 'messages', 'messages_url', 'content', 'diff', 'path', 'filePath',
  'repositoryPath', 'email', 'subject', 'message', 'code', 'raw', 'linesFromAgent',
  'percentage', 'ratio', 'total_additions', 'total_deletions', 'accepted_lines', 'overriden_lines',
]);
const CODE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const OID = /^[a-f0-9]{40}([a-f0-9]{24})?$/;

function hash(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Invalid Git AI ${label}`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, keys: string[]): void {
  const expected = new Set(keys);
  const unexpected = Object.keys(value).find((key) => !expected.has(key));
  const missing = keys.find((key) => !(key in value));
  if (unexpected) throw new Error(`Unexpected Git AI evidence field: ${unexpected}`);
  if (missing) throw new Error(`Missing Git AI evidence field: ${missing}`);
}

function assertNoRawFields(value: unknown, seen = new WeakSet<object>()): void {
  if (value === null || typeof value !== 'object' || seen.has(value)) return;
  seen.add(value);
  if (Array.isArray(value)) {
    for (const child of value) assertNoRawFields(child, seen);
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_RAW_FIELDS.has(key)) throw new Error(`Forbidden Git AI raw field: ${key}`);
    assertNoRawFields(child, seen);
  }
}

export function parseGitAiProspectiveEvidence(value: unknown): GitAiProspectiveEvidenceEnvelope {
  assertNoRawFields(value);
  const root = record(value, 'evidence root');
  exactKeys(root, ['schemaVersion', 'sidecar', 'safety', 'scenarios']);
  if (root.schemaVersion !== 'agent-analytics.git-ai-prospective-evidence.v1') {
    throw new Error('Unsupported Git AI evidence schema');
  }
  const sidecar = record(root.sidecar, 'sidecar identity');
  exactKeys(sidecar, ['name', 'version', 'sourceCommit', 'notesSchema', 'patchStack']);
  if (sidecar.name !== 'git-ai' || sidecar.version !== '1.6.16'
      || sidecar.sourceCommit !== SOURCE_COMMIT || sidecar.notesSchema !== 'authorship/3.0.0'
      || !Array.isArray(sidecar.patchStack) || sidecar.patchStack.length !== 0) {
    throw new Error('Unsupported managed Git AI source');
  }
  const safety = record(root.safety, 'safety');
  exactKeys(safety, [
    'offline', 'disposableRepository', 'automaticHookInstall', 'notesPushed', 'userHistoryMutated',
  ]);
  if (!Object.values(safety).every((item) => typeof item === 'boolean')) {
    throw new Error('Invalid Git AI safety evidence');
  }
  if (!Array.isArray(root.scenarios) || root.scenarios.length > REQUIRED_SCENARIOS.length) {
    throw new Error('Invalid Git AI scenario matrix');
  }
  const seen = new Set<string>();
  const seenCommits = new Set<string>();
  for (const raw of root.scenarios) {
    const scenario = record(raw, 'scenario');
    exactKeys(scenario, [
      'kind', 'taskRef', 'commitObjectId', 'client', 'baseline', 'worktree', 'operation',
      'outcome', 'confidence', 'limitations', 'abstainReason', 'noteExpected',
    ]);
    if (!REQUIRED_SCENARIOS.includes(scenario.kind as GitAiScenarioKind) || seen.has(String(scenario.kind))) {
      throw new Error('Invalid or duplicate Git AI scenario kind');
    }
    seen.add(String(scenario.kind));
    if (typeof scenario.taskRef !== 'string' || scenario.taskRef.length === 0 || scenario.taskRef.length > 256
        || !/^[A-Za-z0-9._:-]+$/.test(scenario.taskRef)
        || typeof scenario.commitObjectId !== 'string' || !OID.test(scenario.commitObjectId)
        || !['git-cli', 'trace2-compatible', 'unsupported'].includes(String(scenario.client))
        || !['clean', 'dirty', 'missing'].includes(String(scenario.baseline))
        || !['primary', 'linked', 'shared-concurrent'].includes(String(scenario.worktree))
        || !['commit', 'partial-stage', 'amend', 'rebase'].includes(String(scenario.operation))
        || !['candidate', 'abstained'].includes(String(scenario.outcome))
        || !['high', 'limited', 'none'].includes(String(scenario.confidence))
        || !Array.isArray(scenario.limitations) || scenario.limitations.length > 16
        || !scenario.limitations.every((code) => typeof code === 'string' && CODE.test(code))
        || !(scenario.abstainReason === null
          || (typeof scenario.abstainReason === 'string' && CODE.test(scenario.abstainReason)))
        || typeof scenario.noteExpected !== 'boolean') {
      throw new Error('Invalid Git AI scenario evidence');
    }
    if (seenCommits.has(scenario.commitObjectId as string)) {
      throw new Error('Duplicate Git AI scenario commit');
    }
    seenCommits.add(scenario.commitObjectId as string);
  }
  return root as unknown as GitAiProspectiveEvidenceEnvelope;
}

function expectedPolicy(scenario: GitAiProspectiveEvidenceEnvelope['scenarios'][number]): boolean {
  const onlyLimitation = (code: string) => scenario.limitations.length === 1
    && scenario.limitations[0] === code;
  const commonAbstain = scenario.outcome === 'abstained' && scenario.confidence === 'none'
    && scenario.noteExpected === false && scenario.abstainReason !== null
    && onlyLimitation(scenario.abstainReason);
  switch (scenario.kind) {
    case 'clean':
      return scenario.baseline === 'clean' && scenario.worktree === 'primary'
        && scenario.operation === 'commit' && scenario.client === 'git-cli'
        && scenario.outcome === 'candidate' && scenario.confidence === 'high'
        && scenario.noteExpected && scenario.limitations.length === 0 && scenario.abstainReason === null;
    case 'pre-existing-dirty':
      return scenario.baseline === 'dirty' && scenario.worktree === 'primary'
        && scenario.operation === 'commit' && scenario.client === 'git-cli' && commonAbstain
        && scenario.abstainReason === 'pre-existing-dirty';
    case 'missing-baseline':
      return scenario.baseline === 'missing' && scenario.worktree === 'primary'
        && scenario.operation === 'commit' && scenario.client === 'git-cli' && commonAbstain
        && scenario.abstainReason === 'missing-baseline';
    case 'partial-stage':
      return scenario.baseline === 'clean' && scenario.operation === 'partial-stage'
        && scenario.worktree === 'primary' && scenario.client === 'git-cli'
        && scenario.outcome === 'candidate' && scenario.confidence === 'limited'
        && scenario.noteExpected && scenario.abstainReason === null
        && onlyLimitation('uncommitted-changes-excluded');
    case 'amend':
    case 'rebase':
      return scenario.baseline === 'clean' && scenario.operation === scenario.kind
        && scenario.worktree === 'primary' && scenario.client === 'git-cli'
        && scenario.outcome === 'candidate' && scenario.confidence === 'limited'
        && scenario.noteExpected && scenario.abstainReason === null
        && onlyLimitation('history-rewrite-limited');
    case 'linked-worktree':
      return scenario.baseline === 'clean' && scenario.worktree === 'linked'
        && scenario.operation === 'commit' && scenario.client === 'git-cli'
        && scenario.outcome === 'candidate' && scenario.confidence === 'high'
        && scenario.noteExpected && scenario.limitations.length === 0 && scenario.abstainReason === null;
    case 'same-worktree-concurrent':
      return scenario.baseline === 'clean' && scenario.worktree === 'shared-concurrent'
        && scenario.operation === 'commit' && scenario.client === 'git-cli' && commonAbstain
        && scenario.abstainReason === 'same-worktree-concurrent';
    case 'unsupported-client':
      return scenario.baseline === 'clean' && scenario.worktree === 'primary'
        && scenario.operation === 'commit' && scenario.client === 'unsupported' && commonAbstain
        && scenario.abstainReason === 'unsupported-client';
  }
}

function gitValue(repositoryPath: string, args: string[]): string {
  return execFileSync('git', ['-C', repositoryPath, ...args], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 10_000, maxBuffer: 1024 * 1024,
  }).trim();
}

function worktreeIdentity(repositoryPath: string): string {
  return realpathSync(gitValue(repositoryPath, ['rev-parse', '--show-toplevel']));
}

function commonDirectoryIdentity(repositoryPath: string): string {
  return realpathSync(gitValue(repositoryPath, ['rev-parse', '--path-format=absolute', '--git-common-dir']));
}

interface TaskContext {
  id: string;
  threadId: string;
  eraId: string;
  worktreePath: string | null;
  startedAt: string;
  endedAt: string | null;
}

function readTask(db: Database.Database, taskRef: string): TaskContext | null {
  return db.prepare(`SELECT id, thread_id AS threadId, era_id AS eraId,
    started_at AS startedAt, ended_at AS endedAt,
    COALESCE(worktree_path, repo_root) AS worktreePath FROM work_tasks WHERE id = ? AND id = root_task_id`)
    .get(taskRef) as TaskContext | undefined ?? null;
}

type NoteReadResult =
  | { status: 'present'; note: string }
  | { status: 'missing' }
  | { status: 'failed' };

function inspectNote(repositoryPath: string, oid: string): NoteReadResult {
  const options = {
    encoding: 'utf8' as const,
    stdio: ['ignore', 'pipe', 'pipe'] as ['ignore', 'pipe', 'pipe'],
    timeout: 10_000,
    maxBuffer: 1024 * 1024,
    env: { ...process.env, LC_ALL: 'C' },
  };
  const listed = spawnSync('git', ['-C', repositoryPath, 'notes', '--ref=ai', 'list', oid], options);
  const stdout = listed.stdout?.trim() ?? '';
  const stderr = listed.stderr?.trim() ?? '';
  if (listed.status === 1 && stdout === '' && stderr === `error: no note found for object ${oid}.`) {
    return { status: 'missing' };
  }
  if (listed.error || listed.signal || listed.status !== 0 || !OID.test(stdout)) {
    return { status: 'failed' };
  }
  const shown = spawnSync('git', ['-C', repositoryPath, 'notes', '--ref=ai', 'show', oid], options);
  if (shown.error || shown.signal || shown.status !== 0 || typeof shown.stdout !== 'string') {
    return { status: 'failed' };
  }
  return { status: 'present', note: shown.stdout };
}

function readNote(repositoryPath: string, oid: string): string {
  const result = inspectNote(repositoryPath, oid);
  if (result.status !== 'present') throw new Error(`note-${result.status}`);
  return result.note;
}

function validateNote(repositoryPath: string, oid: string, task: TaskContext): string {
  const note = readNote(repositoryPath, oid);
  if (Buffer.byteLength(note) > 1024 * 1024) throw new Error('oversized-note');
  const lines = note.replace(/\r\n/g, '\n').split('\n');
  const dividers = lines.map((line, index) => line === '---' ? index : -1).filter((index) => index >= 0);
  if (dividers.length !== 1 || dividers[0] === 0) throw new Error('invalid-note-envelope');
  const metadata = record(JSON.parse(lines.slice(dividers[0]! + 1).join('\n')), 'note metadata');
  assertNoRawFields(metadata);
  if (metadata.schema_version !== 'authorship/3.0.0' || metadata.git_ai_version !== '1.6.16'
      || typeof metadata.base_commit_sha !== 'string' || !OID.test(metadata.base_commit_sha)
      || !gitCommitExists(repositoryPath, metadata.base_commit_sha)) throw new Error('invalid-note-metadata');
  const parents = gitValue(repositoryPath, ['rev-list', '--parents', '-n', '1', oid]).split(/\s+/);
  if (parents.length !== 2 || parents[1] !== metadata.base_commit_sha) throw new Error('invalid-note-base');
  const prompts = record(metadata.prompts, 'note prompts');
  if (Object.keys(prompts).length !== 0) throw new Error('legacy-note-not-supported');
  const sessions = record(metadata.sessions, 'note sessions');
  const sessionId = `s_${hash(`codex:${task.threadId}`).slice(0, 14)}`;
  const session = record(sessions[sessionId], 'note session');
  const agent = record(session.agent_id, 'note agent');
  if (agent.tool !== 'codex' || agent.id !== task.threadId || typeof agent.model !== 'string'
      || agent.model.length === 0 || agent.model.length > 128) throw new Error('note-task-mismatch');
  const attestation = lines.slice(0, dividers[0]!);
  let filePath: string | null = null;
  let matched = false;
  for (const line of attestation) {
    if (!line.startsWith('  ')) {
      if (!line || line.startsWith('/') || line.split('/').includes('..') || Buffer.byteLength(line) > 4096) {
        throw new Error('invalid-note-path');
      }
      filePath = line;
      continue;
    }
    const match = line.match(new RegExp(
      `^  ${sessionId}::t_[a-f0-9]{14} ([1-9][0-9]*(?:-[1-9][0-9]*)?(?:,(?:[1-9][0-9]*(?:-[1-9][0-9]*)?))*)$`,
    ));
    if (!match) continue;
    if (!filePath) throw new Error('note-attestation-missing-path');
    const changedLines = new Set<number>();
    const diff = gitValue(repositoryPath, [
      'diff', '--unified=0', '--no-ext-diff', metadata.base_commit_sha as string, oid, '--', filePath,
    ]);
    for (const hunk of diff.matchAll(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/gm)) {
      const start = Number(hunk[1]);
      const count = hunk[2] === undefined ? 1 : Number(hunk[2]);
      for (let lineNumber = start; lineNumber < start + count; lineNumber += 1) changedLines.add(lineNumber);
    }
    const attestedLines = match[1]!.split(',').flatMap((range) => {
      const [startText, endText = startText] = range.split('-');
      const start = Number(startText);
      const end = Number(endText);
      if (end < start || end - start > 100_000) throw new Error('invalid-note-range');
      return Array.from({ length: end - start + 1 }, (_, index) => start + index);
    });
    if (attestedLines.length === 0 || attestedLines.some((lineNumber) => !changedLines.has(lineNumber))) {
      throw new Error('note-attestation-outside-commit');
    }
    matched = true;
  }
  if (!matched) throw new Error('note-attestation-missing');
  return `git-ai-note:sha256:${hash(note)}`;
}

function scenarioReport(
  scenario: GitAiProspectiveEvidenceEnvelope['scenarios'][number],
): ScenarioReport {
  return {
    kind: scenario.kind,
    support: scenario.outcome === 'abstained' ? 'abstained'
      : scenario.confidence === 'limited' ? 'limited' : 'supported',
    outcome: scenario.outcome,
    reason: scenario.abstainReason ?? scenario.limitations[0] ?? null,
  };
}

interface CandidatePlan {
  scenario: GitAiProspectiveEvidenceEnvelope['scenarios'][number];
  task: TaskContext;
  deliveryId: string;
  factRef: string;
}

function persistCandidates(db: Database.Database, plans: CandidatePlan[]): void {
  const insertCandidate = db.prepare(`INSERT OR IGNORE INTO task_delivery_candidates (
    id, task_id, delivery_id, algorithm_version, coverage, confidence, machine_status
  ) VALUES (?, ?, ?, 'git-ai-provenance-v1', ?, ?, ?)`);
  const insertEvidence = db.prepare(`INSERT OR IGNORE INTO evidence_records (
    id, evidence_type, subject_ref, position, source_category, algorithm_version,
    coverage, confidence, era_compatibility, era_ids_json, human_status, fact_refs_json
  ) VALUES (?, ?, ?, ?, 'deterministic', 'git-ai-provenance-v1', ?, ?, ?, ?, 'unreviewed', ?)`);
  db.transaction(() => {
    for (const plan of plans) {
      const status = plan.scenario.outcome;
      const confidence = plan.scenario.confidence === 'high' ? 0.95
        : plan.scenario.confidence === 'limited' ? 0.6 : 0;
      const coverage = status === 'candidate' ? 1 : 0;
      const candidateId = `candidate:git-ai:${hash(`${plan.task.id}\0${plan.deliveryId}\0git-ai-provenance-v1`)}`;
      insertCandidate.run(candidateId, plan.task.id, plan.deliveryId, coverage, confidence, status);
      const evidenceType = status === 'candidate'
        ? 'git-ai-note-provenance' : `git-ai-${plan.scenario.abstainReason}`;
      const evidenceId = `evidence:git-ai:${hash(`${candidateId}\0${plan.scenario.kind}\0${plan.factRef}`)}`;
      insertEvidence.run(
        evidenceId, evidenceType, candidateId, status === 'candidate' ? 'supports' : 'limits',
        coverage, confidence, plan.scenario.confidence === 'high' ? 'compatible' : 'limited',
        JSON.stringify([plan.task.eraId]),
        JSON.stringify([{ deliveryId: plan.deliveryId, taskId: plan.task.id, factRef: plan.factRef }]),
      );
    }
  })();
}

function persistReport(
  db: Database.Database,
  input: { id: string; failureCodes: string[]; scenarios: ScenarioReport[]; candidateEvidence: number; abstentions: number },
): GitAiGateReport {
  const completedAt = new Date().toISOString();
  const withoutHash = {
    id: input.id,
    status: input.failureCodes.length === 0 ? 'passed' as const : 'failed' as const,
    sourceVersion: '1.6.16' as const,
    sourceCommit: SOURCE_COMMIT,
    notesSchema: 'authorship/3.0.0' as const,
    notesExportPolicy: 'local-explicit' as const,
    candidateEvidence: input.candidateEvidence,
    abstentions: input.abstentions,
    scenarios: input.scenarios,
    failureCodes: [...new Set(input.failureCodes)].sort(),
    completedAt,
  };
  const report: GitAiGateReport = {
    ...withoutHash,
    reportHash: `sha256:${hash(JSON.stringify(withoutHash))}`,
  };
  db.prepare(`UPDATE git_ai_gate_runs SET status = ?, report_json = ?,
    failure_codes_json = ?, completed_at = ? WHERE id = ?`).run(
    report.status, JSON.stringify(report), JSON.stringify(report.failureCodes), completedAt, input.id,
  );
  return report;
}

export function runGitAiProspectiveGate(
  db: Database.Database,
  input: { repositoryPath: string; evidence: GitAiProspectiveEvidenceEnvelope },
): GitAiGateReport {
  const overheadStartedAt = Date.now();
  const evidence = parseGitAiProspectiveEvidence(input.evidence);
  const repoIdentity = repositoryIdentity(input.repositoryPath);
  const id = `git-ai-gate:${randomUUID()}`;
  db.prepare(`INSERT INTO git_ai_gate_runs (
    id, status, repository_identity, source_version, source_commit, notes_schema, started_at
  ) VALUES (?, 'testing', ?, '1.6.16', ?, 'authorship/3.0.0', ?)`)
    .run(id, repoIdentity, SOURCE_COMMIT, new Date().toISOString());

  const failureCodes: string[] = [];
  let sidecarEnabled = false;
  try {
    const inspection = inspectGitAiSidecar({ repositoryPath: input.repositoryPath });
    sidecarEnabled = inspection.enabled;
    if (!inspection.configured) failureCodes.push('sidecar-not-configured');
    else if (!inspection.healthy) failureCodes.push(`sidecar-${inspection.healthError ?? 'unhealthy'}`);
  } catch {
    failureCodes.push('sidecar-health-check-failed');
  }
  const matrix = new Map(evidence.scenarios.map((scenario) => [scenario.kind, scenario]));
  if (!evidence.safety.offline) failureCodes.push('network-not-disabled');
  if (!evidence.safety.disposableRepository) failureCodes.push('repository-not-disposable');
  if (evidence.safety.automaticHookInstall) failureCodes.push('automatic-hook-install-detected');
  if (evidence.safety.notesPushed) failureCodes.push('notes-push-detected');
  if (evidence.safety.userHistoryMutated) failureCodes.push('user-history-mutation-detected');
  for (const kind of REQUIRED_SCENARIOS) {
    if (!matrix.has(kind)) failureCodes.push(`missing-${kind}-scenario`);
  }

  const plans: CandidatePlan[] = [];
  try {
    const gateWorktree = worktreeIdentity(input.repositoryPath);
    const gateCommonDirectory = commonDirectoryIdentity(input.repositoryPath);
    discoverRepositoryDeliveries(db, { repositoryPath: input.repositoryPath });
    const deliveries = new Map(listDeliveries(db, { repositoryIdentity: repoIdentity })
      .filter((delivery) => delivery.kind === 'git-commit')
      .map((delivery) => [delivery.resultIdentity, delivery]));
    for (const scenario of evidence.scenarios) {
      if (!expectedPolicy(scenario)) {
        failureCodes.push(`unsafe-${scenario.kind}-policy`);
        continue;
      }
      const task = readTask(db, scenario.taskRef);
      const delivery = deliveries.get(scenario.commitObjectId);
      if (!task) {
        failureCodes.push(`unknown-task-${scenario.kind}`);
        continue;
      }
      if (!delivery || !gitCommitExists(input.repositoryPath, scenario.commitObjectId)) {
        failureCodes.push(`missing-commit-${scenario.kind}`);
        continue;
      }
      try {
        if (!task.worktreePath) throw new Error('missing task worktree');
        const taskWorktree = worktreeIdentity(task.worktreePath);
        const taskCommonDirectory = commonDirectoryIdentity(task.worktreePath);
        if (scenario.worktree === 'linked') {
          if (taskWorktree === gateWorktree || taskCommonDirectory !== gateCommonDirectory) {
            failureCodes.push('linked-worktree-not-isolated');
            continue;
          }
        } else if (taskWorktree !== gateWorktree || taskCommonDirectory !== gateCommonDirectory) {
          failureCodes.push(`task-worktree-mismatch-${scenario.kind}`);
          continue;
        }
      } catch {
        failureCodes.push(scenario.worktree === 'linked'
          ? 'linked-worktree-not-isolated' : `task-worktree-mismatch-${scenario.kind}`);
        continue;
      }
      if (scenario.kind === 'missing-baseline') {
        const commitAndParents = gitValue(input.repositoryPath, [
          'rev-list', '--parents', '-n', '1', scenario.commitObjectId,
        ]).split(/\s+/);
        if (commitAndParents.length !== 1) {
          failureCodes.push('missing-baseline-has-parent');
          continue;
        }
      }
      if (scenario.kind === 'same-worktree-concurrent') {
        const taskPaths = db.prepare(`SELECT COALESCE(worktree_path, repo_root) AS worktreePath,
          started_at AS startedAt, ended_at AS endedAt
          FROM work_tasks WHERE id = root_task_id AND id <> ?`).all(task.id) as Array<{
          worktreePath: string | null; startedAt: string; endedAt: string | null;
        }>;
        const taskStart = Date.parse(task.startedAt);
        const taskEnd = task.endedAt ? Date.parse(task.endedAt) : Number.POSITIVE_INFINITY;
        const concurrent = taskPaths.some((row) => {
          const otherStart = Date.parse(row.startedAt);
          const otherEnd = row.endedAt ? Date.parse(row.endedAt) : Number.POSITIVE_INFINITY;
          try {
            return row.worktreePath !== null && worktreeIdentity(row.worktreePath) === gateWorktree
              && Number.isFinite(taskStart) && Number.isFinite(otherStart)
              && taskStart <= otherEnd && otherStart <= taskEnd;
          } catch { return false; }
        });
        if (!concurrent) {
          failureCodes.push('same-worktree-concurrency-not-observed');
          continue;
        }
      }
      let factRef = `git-ai-gate:${scenario.kind}`;
      if (scenario.outcome === 'candidate') {
        try {
          factRef = validateNote(input.repositoryPath, scenario.commitObjectId, task);
        } catch {
          failureCodes.push(`invalid-note-${scenario.kind}`);
          continue;
        }
      } else {
        const note = inspectNote(input.repositoryPath, scenario.commitObjectId);
        if (note.status === 'present') {
          failureCodes.push(`unexpected-note-${scenario.kind}`);
          continue;
        }
        if (note.status === 'failed') {
          failureCodes.push(`note-read-failed-${scenario.kind}`);
          continue;
        }
        // The abstention path is proven only when Git explicitly reports no Note for the commit.
      }
      plans.push({ scenario, task, deliveryId: delivery.id, factRef });
    }
  } catch {
    failureCodes.push('gate-execution-failed');
  }

  if (failureCodes.length === 0 && sidecarEnabled) {
    try {
      persistCandidates(db, plans);
    } catch {
      failureCodes.push('candidate-persistence-failed');
    }
  }
  const reports = REQUIRED_SCENARIOS.flatMap((kind) => matrix.has(kind) ? [scenarioReport(matrix.get(kind)!)] : []);
  const report = persistReport(db, {
    id,
    failureCodes,
    scenarios: reports,
    candidateEvidence: plans.filter((plan) => plan.scenario.outcome === 'candidate').length,
    abstentions: plans.filter((plan) => plan.scenario.outcome === 'abstained').length,
  });
  const elapsedMs = Date.now() - overheadStartedAt;
  tryRecordObserverOverhead(db, {
    category: 'sidecar', observerRunId: id, wallMs: elapsedMs, sidecarMs: elapsedMs,
    evidenceRefs: [id],
  });
  return report;
}
