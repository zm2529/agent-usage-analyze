import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { closeDb } from '../db/client.js';
import { buildermarkGateCommand } from './buildermark-gate.js';

const created: string[] = [];

afterEach(() => {
  closeDb();
  delete process.env.AGENT_ANALYTICS_CONFIG_DIR;
  for (const path of created.splice(0)) rmSync(path, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('buildermark-gate command', () => {
  it('runs from an explicit evidence file and emits only the sanitized report', () => {
    const root = mkdtempSync(join(tmpdir(), 'agent-analytics-buildermark-command-'));
    created.push(root);
    const repository = join(root, 'repo');
    const config = join(root, 'config');
    execFileSync('git', ['init', '-q', '-b', 'main', repository]);
    execFileSync('git', ['config', 'user.name', 'Gate Test'], { cwd: repository });
    execFileSync('git', ['config', 'user.email', 'gate@example.invalid'], { cwd: repository });
    execFileSync('git', ['config', 'commit.gpgSign', 'false'], { cwd: repository });
    execFileSync('git', ['config', 'core.hooksPath', '/dev/null'], { cwd: repository });
    writeFileSync(join(repository, 'result.ts'), 'export const result = true;\n');
    execFileSync('git', ['add', 'result.ts'], { cwd: repository });
    execFileSync('git', ['commit', '-q', '-m', 'controlled gate fixture'], { cwd: repository });
    const objectId = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repository, encoding: 'utf8' }).trim();
    const evidencePath = join(root, 'evidence.json');
    writeFileSync(evidencePath, JSON.stringify({
      schemaVersion: 'agent-analytics.buildermark-evidence.v1',
      helper: { name: 'buildermark', version: 'v1.1.0', sourceCommit: '6c6374bd6b09eaf30595e3b81143baa4c92678ce' },
      mode: 'synthetic',
      safety: { offline: true, remoteWrites: false, historyMutated: false },
      commits: [{
        objectId,
        candidates: [{
          taskRef: `task:sha256:${'a'.repeat(64)}`, status: 'candidate',
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
    }));
    process.env.AGENT_ANALYTICS_CONFIG_DIR = config;
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    const report = buildermarkGateCommand(evidencePath, { repository });

    expect(report).toMatchObject({ status: 'passed', mode: 'synthetic', importedCommits: 1 });
    const output = log.mock.calls.flat().join('\n');
    expect(JSON.parse(output)).toMatchObject({ status: 'passed', evidenceCounts: { exact: 2 } });
    expect(output).not.toContain(repository);
    expect(output).not.toContain('export const result');
  });
});
