import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ClaudeInsightConfig } from '../types.js';
import { detectCodexAuthentication, resolveAnalysisExecutionPolicy } from './execution-policy.js';

const originalEnv = { ...process.env };
const tempDirs: string[] = [];

function installFakeCodex(output: string, status = 0): void {
  const dir = mkdtempSync(join(tmpdir(), 'agent-analytics-fake-codex-auth-'));
  tempDirs.push(dir);
  const executable = join(dir, 'codex');
  writeFileSync(executable, `#!/usr/bin/env node
if (process.argv[2] !== 'login' || process.argv[3] !== 'status') process.exit(91);
process.stdout.write(${JSON.stringify(output)});
process.exit(${status});
`, { mode: 0o700 });
  chmodSync(executable, 0o700);
  process.env.PATH = `${dir}${delimiter}${originalEnv.PATH ?? ''}`;
}

const config: ClaudeInsightConfig = {
  sync: { claudeDir: '~/.claude/projects', excludeProjects: [] },
  dashboard: {},
};

beforeEach(() => {
  Object.keys(process.env).forEach((key) => delete process.env[key]);
  Object.assign(process.env, originalEnv);
});

afterEach(() => {
  Object.keys(process.env).forEach((key) => delete process.env[key]);
  Object.assign(process.env, originalEnv);
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('Codex authentication boundary with a fake CLI', () => {
  it.each([
    ['Logged in using ChatGPT', 'chatgpt', 'codex-native'],
    ['Logged in using API key', 'api-key', 'local-only'],
    ['Logged in using access token', 'access-token', 'local-only'],
    ['Logged in through a future auth route', 'unknown', 'local-only'],
  ] as const)('classifies %s without consuming a model turn', (output, authentication, runner) => {
    installFakeCodex(output);
    expect(detectCodexAuthentication()).toMatchObject({ kind: authentication });
    expect(resolveAnalysisExecutionPolicy(config)).toMatchObject({
      authentication, effectiveRunner: runner,
    });
  });

  it('distinguishes an explicit logged-out response', () => {
    installFakeCodex('Not logged in. Run codex login.', 1);
    expect(detectCodexAuthentication()).toMatchObject({ kind: 'not-logged-in' });
  });
});
