import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { runMigrations } from '../db/migrate.js';
import { configureGitAiSidecar } from '../sidecars/git-ai-manager.js';
import { readDeliveryDetail, listDeliveries } from './deliveries.js';
import {
  parseGitAiProspectiveEvidence,
  readGitAiSidecarState,
  runGitAiProspectiveGate,
  type GitAiProspectiveEvidenceEnvelope,
  type GitAiScenarioKind,
} from './git-ai-gate.js';

const created: string[] = [];
const REAL_GIT = execFileSync('/usr/bin/which', ['git'], { encoding: 'utf8' }).trim();

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function sessionKey(threadId: string): string {
  return `s_${createHash('sha256').update(`codex:${threadId}`).digest('hex').slice(0, 14)}`;
}

function createRepository(): string {
  const repository = mkdtempSync(join(tmpdir(), 'agent-analytics-git-ai-gate-'));
  created.push(repository);
  git(repository, ['init', '-q', '-b', 'main']);
  git(repository, ['config', 'user.name', 'Gate Test']);
  git(repository, ['config', 'user.email', 'gate@example.invalid']);
  git(repository, ['config', 'commit.gpgSign', 'false']);
  git(repository, ['config', 'core.hooksPath', '/dev/null']);
  git(repository, ['remote', 'add', 'origin', 'https://example.invalid/team/repository.git']);
  writeFileSync(join(repository, 'baseline.txt'), 'baseline\n');
  git(repository, ['add', 'baseline.txt']);
  git(repository, ['commit', '-q', '-m', 'baseline']);
  return repository;
}

function createSidecarBinary(directory: string): string {
  const binary = join(directory, 'git-ai-frozen');
  writeFileSync(binary, `#!/bin/sh
if [ "$1" = "--version" ]; then printf 'git-ai 1.6.16\\n'; exit 0; fi
if [ "$1" = "config" ]; then printf '{"telemetry_oss_disabled":true,"prompt_storage":"local","default_prompt_storage":"local","disable_version_checks":true,"disable_auto_updates":true,"feature_flags":{"daemon_log_upload":false,"transcript_streaming":false,"transcript_sweep":false}}\\n'; exit 0; fi
if [ "$1" = "status" ] && [ "$2" = "--json" ]; then printf '{"checkpoints":[]}\\n'; exit 0; fi
exit 1
`);
  chmodSync(binary, 0o755);
  return binary;
}

function createNotesFailureGitWrapper(directory: string, oid: string): void {
  const wrapper = join(directory, 'git');
  writeFileSync(wrapper, `#!/bin/sh
if [ "$1" = "-C" ] && [ "$3" = "notes" ] && [ "$4" = "--ref=ai" ] && [ "$5" = "list" ] && [ "$6" = "${oid}" ]; then
  printf 'simulated notes ref read failure\\n' >&2
  exit 128
fi
exec "${REAL_GIT}" "$@"
`);
  chmodSync(wrapper, 0o755);
}

function commitFile(repository: string, label: string): string {
  writeFileSync(join(repository, `${label}.txt`), `${label}\n`);
  git(repository, ['add', `${label}.txt`]);
  git(repository, ['commit', '-q', '-m', label]);
  return git(repository, ['rev-parse', 'HEAD']);
}

function attachNote(repository: string, oid: string, threadId: string, overrides: {
  path?: string;
  range?: string;
  base?: string;
} = {}): void {
  const key = sessionKey(threadId);
  const base = overrides.base ?? git(repository, ['rev-parse', `${oid}^`]);
  const changedPath = git(repository, ['diff', '--name-only', base, oid]).split('\n').filter(Boolean)[0]!;
  const note = [
    overrides.path ?? changedPath,
    `  ${key}::t_${createHash('sha256').update(oid).digest('hex').slice(0, 14)} ${overrides.range ?? '1'}`,
    '---',
    JSON.stringify({
      schema_version: 'authorship/3.0.0',
      git_ai_version: '1.6.16',
      base_commit_sha: base,
      prompts: {},
      sessions: {
        [key]: { agent_id: { tool: 'codex', id: threadId, model: 'gpt-5' } },
      },
    }),
  ].join('\n');
  git(repository, ['notes', '--ref=ai', 'add', '-f', '-m', note, oid]);
}

function seedTask(db: Database.Database, input: {
  id: string;
  threadId: string;
  repository: string;
  worktree?: string;
}): void {
  db.prepare(`INSERT INTO work_tasks (
    id, root_task_id, thread_id, role, status, started_at, ended_at, era_id,
    repo_root, worktree_path, git_branch
  ) VALUES (?, ?, ?, 'root', 'completed', '2026-07-21T08:00:00.000Z',
    '2026-07-21T10:00:00.000Z', 'git-ai-era', ?, ?, 'main')`)
    .run(input.id, input.id, input.threadId, input.repository, input.worktree ?? input.repository);
}

afterEach(() => {
  delete process.env.AGENT_ANALYTICS_CONFIG_DIR;
  for (const path of created.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe('Git AI prospective sidecar gate', () => {
  it('accepts only the explicit clean/limited/abstain matrix and records explainable delivery evidence', () => {
    const repository = createRepository();
    const configDir = mkdtempSync(join(tmpdir(), 'agent-analytics-git-ai-sidecar-'));
    created.push(configDir);
    process.env.AGENT_ANALYTICS_CONFIG_DIR = configDir;
    const binaryPath = createSidecarBinary(configDir);
    configureGitAiSidecar({
      binaryPath,
      enabled: false,
      notesExportPolicy: 'local-only',
    });
    const db = new Database(':memory:');
    runMigrations(db);
    db.prepare(`INSERT INTO observation_eras
      (id, name, mode, parser_version, capabilities_json, starts_at)
      VALUES ('git-ai-era', 'Git AI prospective', 'continuous-observation', 'git-ai-provenance-v1',
        '["git-ai-notes-v3"]', '2026-07-21T00:00:00.000Z')`).run();
    seedTask(db, { id: 'task-main', threadId: 'thread-main', repository });

    const commits = new Map<GitAiScenarioKind, string>();
    commits.set('clean', commitFile(repository, 'clean'));

    writeFileSync(join(repository, 'dirty.txt'), 'pre-existing\n');
    expect(git(repository, ['status', '--porcelain', '--', 'dirty.txt'])).toBe('?? dirty.txt');
    writeFileSync(join(repository, 'dirty.txt'), 'pre-existing\nagent change\n');
    expect(git(repository, ['status', '--porcelain', '--', 'dirty.txt'])).toBe('?? dirty.txt');
    git(repository, ['add', 'dirty.txt']);
    git(repository, ['commit', '-q', '-m', 'dirty']);
    commits.set('pre-existing-dirty', git(repository, ['rev-parse', 'HEAD']));
    const rootTree = git(repository, ['rev-parse', 'HEAD^{tree}']);
    const missingBaseline = git(repository, ['commit-tree', rootTree, '-m', 'missing-baseline']);
    git(repository, ['update-ref', 'refs/heads/missing-baseline-gate', missingBaseline]);
    commits.set('missing-baseline', missingBaseline);
    expect(git(repository, ['rev-list', '--parents', '-n', '1', missingBaseline]).split(/\s+/)).toHaveLength(1);

    writeFileSync(join(repository, 'partial.txt'), 'committed\n');
    writeFileSync(join(repository, 'leftover.txt'), 'not committed\n');
    git(repository, ['add', 'partial.txt']);
    git(repository, ['commit', '-q', '-m', 'partial-stage']);
    commits.set('partial-stage', git(repository, ['rev-parse', 'HEAD']));
    rmSync(join(repository, 'leftover.txt'));

    const amendOriginal = commitFile(repository, 'amend');
    writeFileSync(join(repository, 'amend.txt'), 'amended\n');
    git(repository, ['add', 'amend.txt']);
    git(repository, ['commit', '--amend', '-q', '-m', 'amended']);
    commits.set('amend', git(repository, ['rev-parse', 'HEAD']));
    expect(commits.get('amend')).not.toBe(amendOriginal);

    git(repository, ['checkout', '-q', '-b', 'feature']);
    const preRebase = commitFile(repository, 'feature-change');
    git(repository, ['checkout', '-q', 'main']);
    commitFile(repository, 'new-base');
    git(repository, ['checkout', '-q', 'feature']);
    git(repository, ['rebase', 'main']);
    commits.set('rebase', git(repository, ['rev-parse', 'HEAD']));
    expect(commits.get('rebase')).not.toBe(preRebase);

    const linkedPath = join(tmpdir(), `agent-analytics-linked-${randomUUID()}`);
    created.push(linkedPath);
    git(repository, ['worktree', 'add', '-q', '-b', 'linked-gate', linkedPath, 'main']);
    commits.set('linked-worktree', commitFile(linkedPath, 'linked-worktree'));
    seedTask(db, { id: 'task-linked', threadId: 'thread-linked', repository, worktree: linkedPath });

    commits.set('same-worktree-concurrent', commitFile(repository, 'concurrent'));
    commits.set('unsupported-client', commitFile(repository, 'unsupported-client'));
    seedTask(db, { id: 'task-concurrent', threadId: 'thread-concurrent', repository });

    for (const kind of ['clean', 'partial-stage', 'amend', 'rebase'] as GitAiScenarioKind[]) {
      attachNote(repository, commits.get(kind)!, 'thread-main');
    }
    attachNote(repository, commits.get('linked-worktree')!, 'thread-linked');

    const scenario = (
      kind: GitAiScenarioKind,
      overrides: Partial<GitAiProspectiveEvidenceEnvelope['scenarios'][number]>,
    ): GitAiProspectiveEvidenceEnvelope['scenarios'][number] => ({
      kind,
      taskRef: kind === 'linked-worktree' ? 'task-linked' : 'task-main',
      commitObjectId: commits.get(kind)!,
      client: 'git-cli',
      baseline: 'clean',
      worktree: kind === 'linked-worktree' ? 'linked' : 'primary',
      operation: 'commit',
      outcome: 'candidate',
      confidence: 'high',
      limitations: [],
      abstainReason: null,
      noteExpected: true,
      ...overrides,
    });
    const evidence: GitAiProspectiveEvidenceEnvelope = {
      schemaVersion: 'agent-analytics.git-ai-prospective-evidence.v1',
      sidecar: {
        name: 'git-ai', version: '1.6.16',
        sourceCommit: 'da79071f21f3b018aa7d4ee4e7d5fa8bf3555a88',
        notesSchema: 'authorship/3.0.0', patchStack: [],
      },
      safety: {
        offline: true, disposableRepository: true, automaticHookInstall: false,
        notesPushed: false, userHistoryMutated: false,
      },
      scenarios: [
        scenario('clean', { operation: 'commit' }),
        scenario('pre-existing-dirty', {
          baseline: 'dirty', outcome: 'abstained', confidence: 'none', noteExpected: false,
          limitations: ['pre-existing-dirty'], abstainReason: 'pre-existing-dirty',
        }),
        scenario('missing-baseline', {
          baseline: 'missing', outcome: 'abstained', confidence: 'none', noteExpected: false,
          limitations: ['missing-baseline'], abstainReason: 'missing-baseline',
        }),
        scenario('partial-stage', {
          operation: 'partial-stage', confidence: 'limited',
          limitations: ['uncommitted-changes-excluded'],
        }),
        scenario('amend', {
          operation: 'amend', confidence: 'limited', limitations: ['history-rewrite-limited'],
        }),
        scenario('rebase', {
          operation: 'rebase', confidence: 'limited', limitations: ['history-rewrite-limited'],
        }),
        scenario('linked-worktree', { operation: 'commit' }),
        scenario('same-worktree-concurrent', {
          worktree: 'shared-concurrent', outcome: 'abstained', confidence: 'none', noteExpected: false,
          limitations: ['same-worktree-concurrent'], abstainReason: 'same-worktree-concurrent',
        }),
        scenario('unsupported-client', {
          client: 'unsupported', outcome: 'abstained', confidence: 'none', noteExpected: false,
          limitations: ['unsupported-client'], abstainReason: 'unsupported-client',
        }),
      ],
    };

    const disabledReport = runGitAiProspectiveGate(db, { repositoryPath: repository, evidence });
    expect(disabledReport).toMatchObject({ status: 'passed', candidateEvidence: 5, abstentions: 4 });
    expect(readGitAiSidecarState(db)).toMatchObject({
      status: 'passed', gatePassed: true, configuredEnabled: false, consumptionEnabled: false,
    });
    expect(db.prepare(`SELECT COUNT(*) AS count FROM task_delivery_candidates
      WHERE algorithm_version = 'git-ai-provenance-v1'`).get()).toEqual({ count: 0 });

    configureGitAiSidecar({ binaryPath, enabled: true, notesExportPolicy: 'local-only' });
    db.exec(`CREATE TRIGGER observer_insert_failure BEFORE INSERT ON observer_overhead_events
      BEGIN SELECT RAISE(ABORT, 'observer ledger unavailable'); END;`);
    const report = runGitAiProspectiveGate(db, { repositoryPath: repository, evidence });

    expect(report).toMatchObject({
      status: 'passed', candidateEvidence: 5, abstentions: 4,
      sourceVersion: '1.6.16', notesSchema: 'authorship/3.0.0', notesExportPolicy: 'local-explicit',
    });
    expect(report.scenarios).toEqual([
      { kind: 'clean', support: 'supported', outcome: 'candidate', reason: null },
      { kind: 'pre-existing-dirty', support: 'abstained', outcome: 'abstained', reason: 'pre-existing-dirty' },
      { kind: 'missing-baseline', support: 'abstained', outcome: 'abstained', reason: 'missing-baseline' },
      { kind: 'partial-stage', support: 'limited', outcome: 'candidate', reason: 'uncommitted-changes-excluded' },
      { kind: 'amend', support: 'limited', outcome: 'candidate', reason: 'history-rewrite-limited' },
      { kind: 'rebase', support: 'limited', outcome: 'candidate', reason: 'history-rewrite-limited' },
      { kind: 'linked-worktree', support: 'supported', outcome: 'candidate', reason: null },
      { kind: 'same-worktree-concurrent', support: 'abstained', outcome: 'abstained', reason: 'same-worktree-concurrent' },
      { kind: 'unsupported-client', support: 'abstained', outcome: 'abstained', reason: 'unsupported-client' },
    ]);
    const state = readGitAiSidecarState(db);
    expect(state).toMatchObject({ status: 'passed', gatePassed: true, consumptionEnabled: true });
    expect(JSON.stringify(report)).not.toContain(repository);
    expect(JSON.stringify(report)).not.toContain('thread-main');
    expect(JSON.stringify(report)).not.toContain('result.txt');

    const cleanDelivery = listDeliveries(db).find((delivery) => delivery.resultIdentity === commits.get('clean'))!;
    expect(readDeliveryDetail(db, cleanDelivery.id)?.candidates).toEqual(expect.arrayContaining([
      expect.objectContaining({
        taskId: 'task-main', status: 'candidate', algorithmVersion: 'git-ai-provenance-v1',
        evidence: expect.arrayContaining([expect.objectContaining({
          evidenceType: 'git-ai-note-provenance', position: 'supports', confidence: 0.95,
        })]),
      }),
    ]));
    const dirtyDelivery = listDeliveries(db).find((delivery) => delivery.resultIdentity === commits.get('pre-existing-dirty'))!;
    expect(readDeliveryDetail(db, dirtyDelivery.id)?.candidates).toEqual(expect.arrayContaining([
      expect.objectContaining({
        status: 'abstained',
        evidence: expect.arrayContaining([expect.objectContaining({
          evidenceType: 'git-ai-pre-existing-dirty', position: 'limits', confidence: 0,
        })]),
      }),
    ]));

    attachNote(repository, commits.get('clean')!, 'thread-main', { path: 'baseline.txt' });
    const fakePath = runGitAiProspectiveGate(db, { repositoryPath: repository, evidence });
    expect(fakePath).toMatchObject({ status: 'failed' });
    expect(fakePath.failureCodes).toContain('invalid-note-clean');
    expect(readDeliveryDetail(db, cleanDelivery.id)?.candidates)
      .not.toEqual(expect.arrayContaining([expect.objectContaining({ algorithmVersion: 'git-ai-provenance-v1' })]));

    attachNote(repository, commits.get('clean')!, 'thread-main', { range: '999' });
    const outOfRange = runGitAiProspectiveGate(db, { repositoryPath: repository, evidence });
    expect(outOfRange).toMatchObject({ status: 'failed' });
    expect(outOfRange.failureCodes).toContain('invalid-note-clean');

    attachNote(repository, commits.get('clean')!, 'thread-main', {
      base: commits.get('missing-baseline')!,
    });
    const wrongBase = runGitAiProspectiveGate(db, { repositoryPath: repository, evidence });
    expect(wrongBase).toMatchObject({ status: 'failed' });
    expect(wrongBase.failureCodes).toContain('invalid-note-clean');

    attachNote(repository, commits.get('clean')!, 'thread-main');
    expect(runGitAiProspectiveGate(db, { repositoryPath: repository, evidence }))
      .toMatchObject({ status: 'passed' });

    const gitWrapper = mkdtempSync(join(tmpdir(), 'agent-analytics-failing-git-'));
    created.push(gitWrapper);
    createNotesFailureGitWrapper(gitWrapper, commits.get('pre-existing-dirty')!);
    const originalPath = process.env.PATH;
    try {
      process.env.PATH = `${gitWrapper}:${originalPath ?? ''}`;
      const noteReadFailure = runGitAiProspectiveGate(db, { repositoryPath: repository, evidence });
      expect(noteReadFailure).toMatchObject({ status: 'failed' });
      expect(noteReadFailure.failureCodes).toContain('note-read-failed-pre-existing-dirty');
    } finally {
      process.env.PATH = originalPath;
    }

    const crossContaminated = structuredClone(evidence);
    crossContaminated.scenarios.find((item) => item.kind === 'pre-existing-dirty')!.client = 'unsupported';
    const crossContamination = runGitAiProspectiveGate(db, {
      repositoryPath: repository, evidence: crossContaminated,
    });
    expect(crossContamination.failureCodes).toContain('unsafe-pre-existing-dirty-policy');

    const separateRepository = createRepository();
    seedTask(db, { id: 'task-separate', threadId: 'thread-separate', repository: separateRepository });
    const unrelatedPrimary = structuredClone(evidence);
    unrelatedPrimary.scenarios.find((item) => item.kind === 'clean')!.taskRef = 'task-separate';
    expect(runGitAiProspectiveGate(db, { repositoryPath: repository, evidence: unrelatedPrimary }).failureCodes)
      .toContain('task-worktree-mismatch-clean');

    const separateLinked = structuredClone(evidence);
    separateLinked.scenarios.find((item) => item.kind === 'linked-worktree')!.taskRef = 'task-separate';
    expect(runGitAiProspectiveGate(db, { repositoryPath: repository, evidence: separateLinked }).failureCodes)
      .toContain('linked-worktree-not-isolated');

    const aliasPath = join(tmpdir(), `agent-analytics-alias-${randomUUID()}`);
    created.push(aliasPath);
    symlinkSync(repository, aliasPath, 'dir');
    seedTask(db, { id: 'task-alias', threadId: 'thread-alias', repository, worktree: aliasPath });
    const aliasLinked = structuredClone(evidence);
    aliasLinked.scenarios.find((item) => item.kind === 'linked-worktree')!.taskRef = 'task-alias';
    expect(runGitAiProspectiveGate(db, { repositoryPath: repository, evidence: aliasLinked }).failureCodes)
      .toContain('linked-worktree-not-isolated');

    const beforeUnsafe = db.prepare('SELECT COUNT(*) AS count FROM task_delivery_candidates').get() as { count: number };
    const unsafeEvidence = structuredClone(evidence);
    const dirty = unsafeEvidence.scenarios.find((item) => item.kind === 'pre-existing-dirty')!;
    dirty.outcome = 'candidate';
    dirty.confidence = 'high';
    dirty.noteExpected = true;
    dirty.limitations = [];
    dirty.abstainReason = null;
    const unsafe = runGitAiProspectiveGate(db, { repositoryPath: repository, evidence: unsafeEvidence });
    expect(unsafe).toMatchObject({ status: 'failed' });
    expect(unsafe.failureCodes).toContain('unsafe-pre-existing-dirty-policy');
    expect(readGitAiSidecarState(db)).toMatchObject({
      status: 'failed', gatePassed: false, consumptionEnabled: false,
    });
    expect(readDeliveryDetail(db, cleanDelivery.id)?.candidates)
      .not.toEqual(expect.arrayContaining([expect.objectContaining({ algorithmVersion: 'git-ai-provenance-v1' })]));
    expect(db.prepare('SELECT COUNT(*) AS count FROM task_delivery_candidates').get()).toEqual(beforeUnsafe);

    const duplicateCommit = structuredClone(evidence);
    duplicateCommit.scenarios[1]!.commitObjectId = duplicateCommit.scenarios[0]!.commitObjectId;
    expect(() => runGitAiProspectiveGate(db, { repositoryPath: repository, evidence: duplicateCommit }))
      .toThrow('Duplicate Git AI scenario commit');

    const stored = db.prepare(`SELECT report_json AS reportJson FROM git_ai_gate_runs
      WHERE sequence = (SELECT MAX(sequence) FROM git_ai_gate_runs)`).get() as { reportJson: string };
    const malformed = JSON.parse(stored.reportJson) as Record<string, unknown>;
    const scenarios = malformed.scenarios as Array<Record<string, unknown>>;
    scenarios[0]!.kind = 'unknown-scenario';
    const { reportHash: _oldHash, ...withoutHash } = malformed;
    malformed.reportHash = `sha256:${createHash('sha256').update(JSON.stringify(withoutHash)).digest('hex')}`;
    db.prepare(`UPDATE git_ai_gate_runs SET report_json = ?
      WHERE sequence = (SELECT MAX(sequence) FROM git_ai_gate_runs)`).run(JSON.stringify(malformed));
    expect(readGitAiSidecarState(db)).toMatchObject({
      status: 'failed', gatePassed: false, consumptionEnabled: false,
      latestRun: null, stateError: 'corrupt-report',
    });
    writeFileSync(binaryPath, '#!/bin/sh\n# binary changed after configuration\nexit 0\n');
    chmodSync(binaryPath, 0o755);
    const changedBinary = runGitAiProspectiveGate(db, { repositoryPath: repository, evidence });
    expect(changedBinary.failureCodes).toContain('sidecar-binary-changed');
    writeFileSync(join(configDir, 'git-ai-sidecar.json'), '{broken');
    expect(readGitAiSidecarState(db)).toMatchObject({
      configured: false, consumptionEnabled: false, stateError: 'corrupt-config',
    });
    db.close();
  }, 20_000);

  it('rejects raw prompts and line-percentage fields at the product boundary', () => {
    expect(() => parseGitAiProspectiveEvidence({ prompt: 'private request' }))
      .toThrow('Forbidden Git AI raw field: prompt');
    expect(() => parseGitAiProspectiveEvidence({ linesFromAgent: 42 }))
      .toThrow('Forbidden Git AI raw field: linesFromAgent');
  });
});
