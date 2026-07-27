import Database from 'better-sqlite3';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runMigrations } from '../db/migrate.js';
import {
  parseBuildermarkEvidence,
  readBuildermarkGateState,
  runBuildermarkGate,
  type BuildermarkEvidenceEnvelope,
} from './buildermark-gate.js';

const created: string[] = [];
const FIXTURE_TASK_REF = `task:sha256:${'a'.repeat(64)}`;
const AMBIGUOUS_TASK_REF = `task:sha256:${'b'.repeat(64)}`;

function disposableRepository(): { path: string; commit: string } {
  const path = mkdtempSync(join(tmpdir(), 'agent-analytics-buildermark-gate-'));
  created.push(path);
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: path });
  execFileSync('git', ['config', 'user.name', 'Gate Test'], { cwd: path });
  execFileSync('git', ['config', 'user.email', 'gate@example.invalid'], { cwd: path });
  execFileSync('git', ['config', 'commit.gpgSign', 'false'], { cwd: path });
  execFileSync('git', ['config', 'core.hooksPath', '/dev/null'], { cwd: path });
  writeFileSync(join(path, 'result.ts'), 'export const result = true;\n');
  execFileSync('git', ['add', 'result.ts'], { cwd: path });
  execFileSync('git', ['commit', '-q', '-m', 'controlled gate fixture'], { cwd: path });
  return {
    path,
    commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: path, encoding: 'utf8' }).trim(),
  };
}

afterEach(() => {
  for (const path of created.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe('Buildermark historical helper gate', () => {
  it('imports a disposable commit and passes only with layered explainable evidence and ambiguity diagnostics', () => {
    const repository = disposableRepository();
    const db = new Database(':memory:');
    runMigrations(db);

    const report = runBuildermarkGate(db, {
      repositoryPath: repository.path,
      evidence: {
        schemaVersion: 'agent-analytics.buildermark-evidence.v1',
        helper: { name: 'buildermark', version: 'v1.1.0', sourceCommit: '6c6374bd6b09eaf30595e3b81143baa4c92678ce' },
        mode: 'synthetic',
        safety: { offline: true, remoteWrites: false, historyMutated: false },
        commits: [{
          objectId: repository.commit,
          candidates: [
            {
              taskRef: FIXTURE_TASK_REF, status: 'candidate',
              evidence: [
                { kind: 'exact', matchedLines: 2, confidence: 0.95 },
                { kind: 'formatting', matchedLines: 1, confidence: 0.8 },
                { kind: 'fallback', matchedLines: 10, confidence: 0.55 },
                { kind: 'deletion', matchedLines: 1, confidence: 0.4 },
              ],
              diagnostics: [],
            },
            {
              taskRef: AMBIGUOUS_TASK_REF, status: 'abstained', evidence: [],
              diagnostics: ['ambiguous-common-line'],
            },
          ],
        }],
        review: { reviewedCandidates: 0, obviousMisattributions: 0 },
      },
    });

    expect(report).toMatchObject({
      status: 'passed', mode: 'synthetic', importedCommits: 1, candidates: 2,
      evidenceCounts: { exact: 2, formatting: 1, fallback: 10, deletion: 1 },
      diagnosticCodes: ['ambiguous-common-line'],
    });
    expect(readBuildermarkGateState(db)).toMatchObject({ status: 'passed', candidateEnabled: false });
    expect(JSON.stringify(report)).not.toContain(repository.path);
    expect(JSON.stringify(report)).not.toContain('export const result');
    db.close();
  });

  it('enables candidate use only after a reviewed real gate and disables it after an obvious misattribution', () => {
    const repository = disposableRepository();
    const db = new Database(':memory:');
    runMigrations(db);
    const base = {
      schemaVersion: 'agent-analytics.buildermark-evidence.v1' as const,
      helper: { name: 'buildermark' as const, version: 'v1.1.0', sourceCommit: '6c6374bd6b09eaf30595e3b81143baa4c92678ce' },
      safety: { offline: true, remoteWrites: false, historyMutated: false },
      commits: [{
        objectId: repository.commit,
        candidates: [{
          taskRef: FIXTURE_TASK_REF, status: 'candidate' as const,
          evidence: [{ kind: 'exact' as const, matchedLines: 2, confidence: 0.95 }],
          diagnostics: [],
        }],
      }],
    };
    runBuildermarkGate(db, {
      repositoryPath: repository.path,
      evidence: {
        ...base, mode: 'synthetic',
        commits: [{ ...base.commits[0], candidates: [{
          ...base.commits[0]!.candidates[0]!,
          evidence: [
            { kind: 'exact', matchedLines: 2, confidence: 0.95 },
            { kind: 'formatting', matchedLines: 1, confidence: 0.8 },
            { kind: 'fallback', matchedLines: 10, confidence: 0.55 },
            { kind: 'deletion', matchedLines: 1, confidence: 0.4 },
          ],
          diagnostics: ['ambiguous-common-line'],
        }] }],
        review: { reviewedCandidates: 0, obviousMisattributions: 0 },
      },
    });
    const passed = runBuildermarkGate(db, {
      repositoryPath: repository.path,
      evidence: { ...base, mode: 'real', review: { reviewedCandidates: 1, obviousMisattributions: 0 } },
    });

    expect(passed).toMatchObject({ status: 'passed', reviewedCandidates: 1, obviousMisattributions: 0 });
    expect(readBuildermarkGateState(db)).toMatchObject({
      status: 'passed', candidateEnabled: true, realGatePassed: true, syntheticGatePassed: true,
    });

    const failed = runBuildermarkGate(db, {
      repositoryPath: repository.path,
      evidence: { ...base, mode: 'real', review: { reviewedCandidates: 1, obviousMisattributions: 1 } },
    });
    expect(failed).toMatchObject({ status: 'failed', failureCodes: ['obvious-misattribution'] });
    expect(readBuildermarkGateState(db)).toMatchObject({
      status: 'failed', candidateEnabled: false, realGatePassed: false,
    });
    expect(db.prepare('SELECT COUNT(*) AS count FROM buildermark_gate_runs').get()).toEqual({ count: 3 });
    db.close();
  });

  it('rejects helper JSON containing raw prompt-like fields before writing a gate run', () => {
    const repository = disposableRepository();
    const db = new Database(':memory:');
    runMigrations(db);
    const evidence = {
      schemaVersion: 'agent-analytics.buildermark-evidence.v1',
      helper: { name: 'buildermark', version: 'v1.1.0', sourceCommit: '6c6374bd6b09eaf30595e3b81143baa4c92678ce' },
      mode: 'real',
      safety: { offline: true, remoteWrites: false, historyMutated: false },
      commits: [{
        objectId: repository.commit,
        candidates: [{
          taskRef: FIXTURE_TASK_REF, status: 'candidate',
          evidence: [{ kind: 'exact', matchedLines: 2, confidence: 0.95 }],
          diagnostics: [],
          prompt: 'private user request',
        }],
      }],
      review: { reviewedCandidates: 1, obviousMisattributions: 0 },
    } as unknown as BuildermarkEvidenceEnvelope;

    expect(() => runBuildermarkGate(db, { repositoryPath: repository.path, evidence }))
      .toThrow('forbidden raw field: prompt');
    expect(db.prepare('SELECT COUNT(*) AS count FROM buildermark_gate_runs').get()).toEqual({ count: 0 });
    db.close();
  });

  it('rejects Buildermark line-percentage scoring fields at the product evidence boundary', () => {
    const repository = disposableRepository();
    const db = new Database(':memory:');
    runMigrations(db);
    const evidence = {
      schemaVersion: 'agent-analytics.buildermark-evidence.v1',
      helper: { name: 'buildermark', version: 'v1.1.0', sourceCommit: '6c6374bd6b09eaf30595e3b81143baa4c92678ce' },
      mode: 'real',
      safety: { offline: true, remoteWrites: false, historyMutated: false },
      commits: [{
        objectId: repository.commit,
        candidates: [{
          taskRef: FIXTURE_TASK_REF, status: 'candidate',
          evidence: [{ kind: 'exact', matchedLines: 2, confidence: 0.95 }],
          diagnostics: [],
          linesFromAgent: 2,
        }],
      }],
      review: { reviewedCandidates: 1, obviousMisattributions: 0 },
    } as unknown as BuildermarkEvidenceEnvelope;

    expect(() => runBuildermarkGate(db, { repositoryPath: repository.path, evidence }))
      .toThrow('unexpected field: linesFromAgent');
    expect(db.prepare('SELECT COUNT(*) AS count FROM buildermark_gate_runs').get()).toEqual({ count: 0 });
    db.close();
  });

  it('never enables candidate use when every explainable record abstains', () => {
    const repository = disposableRepository();
    const db = new Database(':memory:');
    runMigrations(db);
    const base = {
      schemaVersion: 'agent-analytics.buildermark-evidence.v1' as const,
      helper: { name: 'buildermark' as const, version: 'v1.1.0', sourceCommit: '6c6374bd6b09eaf30595e3b81143baa4c92678ce' },
      safety: { offline: true, remoteWrites: false, historyMutated: false },
      commits: [{
        objectId: repository.commit,
        candidates: [{
          taskRef: AMBIGUOUS_TASK_REF, status: 'abstained' as const,
          evidence: [
            { kind: 'exact' as const, matchedLines: 2, confidence: 0.95 },
            { kind: 'formatting' as const, matchedLines: 1, confidence: 0.8 },
            { kind: 'fallback' as const, matchedLines: 10, confidence: 0.55 },
            { kind: 'deletion' as const, matchedLines: 1, confidence: 0.4 },
          ],
          diagnostics: ['ambiguous-common-line'],
        }],
      }],
    };

    const synthetic = runBuildermarkGate(db, {
      repositoryPath: repository.path,
      evidence: { ...base, mode: 'synthetic', review: { reviewedCandidates: 0, obviousMisattributions: 0 } },
    });
    const real = runBuildermarkGate(db, {
      repositoryPath: repository.path,
      evidence: { ...base, mode: 'real', review: { reviewedCandidates: 1, obviousMisattributions: 0 } },
    });

    expect(synthetic).toMatchObject({ status: 'failed' });
    expect(synthetic.failureCodes).toContain('no-explainable-candidate');
    expect(real).toMatchObject({ status: 'failed' });
    expect(real.failureCodes).toContain('no-explainable-candidate');
    expect(readBuildermarkGateState(db)).toMatchObject({ candidateEnabled: false });
    db.close();
  });

  it('rejects any helper version other than the frozen audited release', () => {
    const repository = disposableRepository();
    const db = new Database(':memory:');
    runMigrations(db);
    const evidence = {
      schemaVersion: 'agent-analytics.buildermark-evidence.v1',
      helper: {
        name: 'buildermark', version: 'v1.1.0<script>',
        sourceCommit: '6c6374bd6b09eaf30595e3b81143baa4c92678ce',
      },
      mode: 'real',
      safety: { offline: true, remoteWrites: false, historyMutated: false },
      commits: [],
      review: { reviewedCandidates: 0, obviousMisattributions: 0 },
    } as unknown as BuildermarkEvidenceEnvelope;

    expect(() => runBuildermarkGate(db, { repositoryPath: repository.path, evidence }))
      .toThrow('Unsupported Buildermark helper version');
    expect(db.prepare('SELECT COUNT(*) AS count FROM buildermark_gate_runs').get()).toEqual({ count: 0 });
    db.close();
  });

  it('rejects unsafe or non-finite numeric evidence before a gate run is recorded', () => {
    const base = {
      schemaVersion: 'agent-analytics.buildermark-evidence.v1',
      helper: { name: 'buildermark', version: 'v1.1.0', sourceCommit: '6c6374bd6b09eaf30595e3b81143baa4c92678ce' },
      mode: 'real',
      safety: { offline: true, remoteWrites: false, historyMutated: false },
      commits: [{
        objectId: 'a'.repeat(40),
        candidates: [{
          taskRef: FIXTURE_TASK_REF, status: 'candidate',
          evidence: [{ kind: 'exact', matchedLines: 1, confidence: 0.95 }],
          diagnostics: [],
        }],
      }],
      review: { reviewedCandidates: 1, obviousMisattributions: 0 },
    };

    const unsafeLines = structuredClone(base);
    unsafeLines.commits[0]!.candidates[0]!.evidence[0]!.matchedLines = Number.MAX_SAFE_INTEGER + 1;
    expect(() => parseBuildermarkEvidence(unsafeLines)).toThrow('Invalid Buildermark match evidence');

    const unsafeReview = structuredClone(base);
    unsafeReview.review.reviewedCandidates = Number.MAX_SAFE_INTEGER + 1;
    expect(() => parseBuildermarkEvidence(unsafeReview)).toThrow('Invalid Buildermark review counts');

    const nonFiniteConfidence = structuredClone(base);
    nonFiniteConfidence.commits[0]!.candidates[0]!.evidence[0]!.confidence = Number.NaN;
    expect(() => parseBuildermarkEvidence(nonFiniteConfidence)).toThrow('Invalid Buildermark match evidence');
  });

  it('records a sanitized failed state instead of leaving testing stuck when commit import fails', () => {
    const repository = disposableRepository();
    rmSync(join(repository.path, '.git', 'objects', repository.commit.slice(0, 2), repository.commit.slice(2)), { force: true });
    const db = new Database(':memory:');
    runMigrations(db);
    const evidence: BuildermarkEvidenceEnvelope = {
      schemaVersion: 'agent-analytics.buildermark-evidence.v1',
      helper: { name: 'buildermark', version: 'v1.1.0', sourceCommit: '6c6374bd6b09eaf30595e3b81143baa4c92678ce' },
      mode: 'real',
      safety: { offline: true, remoteWrites: false, historyMutated: false },
      commits: [{ objectId: repository.commit, candidates: [] }],
      review: { reviewedCandidates: 0, obviousMisattributions: 0 },
    };

    const report = runBuildermarkGate(db, { repositoryPath: repository.path, evidence });

    expect(report).toMatchObject({ status: 'failed', importedCommits: 0 });
    expect(report.failureCodes).toContain('commit-import-failed');
    expect(readBuildermarkGateState(db)).toMatchObject({
      status: 'failed', candidateEnabled: false,
      latestRun: { status: 'failed' },
    });
    expect(JSON.stringify(report)).not.toContain(repository.path);
    db.close();
  });

  it('fails closed with a visible integrity reason when the stored report is corrupt', () => {
    const db = new Database(':memory:');
    runMigrations(db);
    db.prepare(`INSERT INTO buildermark_gate_runs (
      id, helper_version, helper_source_commit, evidence_schema_version, mode, status,
      repository_identity, report_json, failure_codes_json, started_at, completed_at
    ) VALUES (
      'corrupt', 'v1.1.0', '6c6374bd6b09eaf30595e3b81143baa4c92678ce',
      'agent-analytics.buildermark-evidence.v1', 'real', 'passed',
      'repository:sha256:opaque', '{broken', '[]',
      '2026-07-21T00:00:00.000Z', '2026-07-21T00:01:00.000Z'
    )`).run();

    expect(readBuildermarkGateState(db)).toEqual({
      status: 'failed', candidateEnabled: false, latestRun: null,
      realGatePassed: false, syntheticGatePassed: false, stateError: 'corrupt-report',
    });
    db.close();
  });

  it('fails closed when an older latest-per-mode report is corrupt', () => {
    const repository = disposableRepository();
    const db = new Database(':memory:');
    runMigrations(db);
    const base = {
      schemaVersion: 'agent-analytics.buildermark-evidence.v1' as const,
      helper: { name: 'buildermark' as const, version: 'v1.1.0', sourceCommit: '6c6374bd6b09eaf30595e3b81143baa4c92678ce' },
      safety: { offline: true, remoteWrites: false, historyMutated: false },
      commits: [{
        objectId: repository.commit,
        candidates: [{
          taskRef: FIXTURE_TASK_REF, status: 'candidate' as const,
          evidence: [
            { kind: 'exact' as const, matchedLines: 2, confidence: 0.95 },
            { kind: 'formatting' as const, matchedLines: 1, confidence: 0.8 },
            { kind: 'fallback' as const, matchedLines: 10, confidence: 0.55 },
            { kind: 'deletion' as const, matchedLines: 1, confidence: 0.4 },
          ],
          diagnostics: ['ambiguous-common-line'],
        }],
      }],
    };
    runBuildermarkGate(db, {
      repositoryPath: repository.path,
      evidence: { ...base, mode: 'real', review: { reviewedCandidates: 1, obviousMisattributions: 0 } },
    });
    runBuildermarkGate(db, {
      repositoryPath: repository.path,
      evidence: { ...base, mode: 'synthetic', review: { reviewedCandidates: 0, obviousMisattributions: 0 } },
    });
    db.prepare("UPDATE buildermark_gate_runs SET report_json = '{broken' WHERE mode = 'real'").run();

    expect(readBuildermarkGateState(db)).toEqual({
      status: 'failed', candidateEnabled: false, latestRun: null,
      realGatePassed: false, syntheticGatePassed: false, stateError: 'corrupt-report',
    });
    db.close();
  });

  it('does not reuse a stale delivery after the commit disappears from the current repository', () => {
    const repository = disposableRepository();
    const db = new Database(':memory:');
    runMigrations(db);
    const evidence: BuildermarkEvidenceEnvelope = {
      schemaVersion: 'agent-analytics.buildermark-evidence.v1',
      helper: { name: 'buildermark', version: 'v1.1.0', sourceCommit: '6c6374bd6b09eaf30595e3b81143baa4c92678ce' },
      mode: 'synthetic',
      safety: { offline: true, remoteWrites: false, historyMutated: false },
      commits: [{
        objectId: repository.commit,
        candidates: [{
          taskRef: FIXTURE_TASK_REF, status: 'candidate',
          evidence: [
            { kind: 'exact', matchedLines: 2, confidence: 0.95 },
            { kind: 'formatting', matchedLines: 1, confidence: 0.8 },
            { kind: 'fallback', matchedLines: 10, confidence: 0.55 },
            { kind: 'deletion', matchedLines: 1, confidence: 0.4 },
          ],
          diagnostics: ['ambiguous-common-line'],
        }],
      }],
      review: { reviewedCandidates: 0, obviousMisattributions: 0 },
    };
    expect(runBuildermarkGate(db, { repositoryPath: repository.path, evidence }).status).toBe('passed');

    execFileSync('git', ['update-ref', '-d', 'refs/heads/main'], { cwd: repository.path });
    execFileSync('git', ['reflog', 'expire', '--expire=now', '--all'], { cwd: repository.path });
    execFileSync('git', ['gc', '--prune=now'], { cwd: repository.path });
    expect(() => execFileSync('git', ['cat-file', '-e', `${repository.commit}^{commit}`], {
      cwd: repository.path, stdio: 'ignore',
    })).toThrow();

    const rerun = runBuildermarkGate(db, { repositoryPath: repository.path, evidence });
    expect(rerun).toMatchObject({ status: 'failed', importedCommits: 0 });
    expect(rerun.failureCodes).toContain('commit-import-incomplete');
    expect(readBuildermarkGateState(db)).toMatchObject({ candidateEnabled: false });
    db.close();
  });
});
