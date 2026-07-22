import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CodexNativeRunner } from './codex-native-runner.js';

const tempDirs: string[] = [];
const originalEnv = { ...process.env };

function installFakeCodex(scenario: string): { capturePath: string } {
  const dir = mkdtempSync(join(tmpdir(), 'agent-analytics-fake-codex-'));
  tempDirs.push(dir);
  const capturePath = join(dir, 'capture.json');
  const executable = join(dir, 'codex');
  writeFileSync(executable, `#!/usr/bin/env node
const fs = require('node:fs');
const capturePath = ${JSON.stringify(capturePath)};
const scenario = ${JSON.stringify(scenario)};
let stdin = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { stdin += chunk; });
process.stdin.on('end', () => {
  fs.writeFileSync(capturePath, JSON.stringify({
    argv: process.argv.slice(2), stdin, cwd: process.cwd(),
    schema: JSON.parse(fs.readFileSync(process.argv[process.argv.indexOf('--output-schema') + 1], 'utf8')),
    recursion: process.env.AGENT_ANALYTICS_HOOK_ACTIVE,
    codeHome: process.env.CODEX_HOME,
    credentials: {
      openaiApiKey: process.env.OPENAI_API_KEY,
      codexApiKey: process.env.CODEX_API_KEY,
      openaiAccessToken: process.env.OPENAI_ACCESS_TOKEN,
      codexAccessToken: process.env.CODEX_ACCESS_TOKEN,
      unrelatedSecret: process.env.UNRELATED_PARENT_SECRET,
    },
  }));
  if (scenario === 'timeout') return setTimeout(() => {}, 60_000);
  if (scenario === 'nonzero') {
    process.stderr.write('simulated codex failure');
    process.exit(17);
  }
  if (scenario === 'malformed') {
    process.stdout.write('{not-json}\\n');
    return;
  }
  if (scenario === 'failed-event') {
    process.stdout.write(JSON.stringify({ type: 'turn.failed', error: { message: 'model failed' } }) + '\\n');
    return;
  }
  if (scenario === 'missing-usage') {
    process.stdout.write([
      { type: 'thread.started', thread_id: 'thread-1' },
      { type: 'turn.started' },
      { type: 'item.completed', item: { id: 'final', type: 'agent_message', text: '{}' } },
    ].map((event) => JSON.stringify(event)).join('\\n') + '\\n');
    return;
  }
  if (scenario === 'tool-call') {
    process.stdout.write([
      { type: 'thread.started', thread_id: 'thread-1' },
      { type: 'turn.started' },
      { type: 'item.completed', item: { id: 'tool', type: 'command_execution', command: 'env' } },
    ].map((event) => JSON.stringify(event)).join('\\n') + '\\n');
    return;
  }
  process.stdout.write([
    { type: 'thread.started', thread_id: 'thread-1' },
    { type: 'turn.started' },
    { type: 'item.completed', item: { id: 'intermediate', type: 'agent_message', text: '{\"stage\":\"working\"}' } },
    { type: 'item.completed', item: { id: 'final', type: 'agent_message', text: '{\"answer\":\"safe\"}' } },
    { type: 'turn.completed', usage: {
      input_tokens: 101, cached_input_tokens: 41, cache_write_input_tokens: 7,
      output_tokens: 23, reasoning_output_tokens: 11,
    } },
  ].map((event) => JSON.stringify(event)).join('\\n') + '\\n');
});
`, { mode: 0o700 });
  chmodSync(executable, 0o700);
  process.env.PATH = `${dir}${delimiter}${originalEnv.PATH ?? ''}`;
  return { capturePath };
}

beforeEach(() => {
  Object.keys(process.env).forEach((key) => delete process.env[key]);
  Object.assign(process.env, originalEnv);
});

afterEach(() => {
  Object.keys(process.env).forEach((key) => delete process.env[key]);
  Object.assign(process.env, originalEnv);
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('CodexNativeRunner', () => {
  it('runs an isolated argument-array Codex exec and strictly returns the final event with usage', async () => {
    const { capturePath } = installFakeCodex('success');
    process.env.CODEX_HOME = '/safe/chatgpt-login';
    process.env.OPENAI_API_KEY = 'must-not-leak';
    process.env.CODEX_API_KEY = 'must-not-leak';
    process.env.OPENAI_ACCESS_TOKEN = 'must-not-leak';
    process.env.CODEX_ACCESS_TOKEN = 'must-not-leak';
    process.env.UNRELATED_PARENT_SECRET = 'must-not-leak';
    const runner = new CodexNativeRunner();

    const result = await runner.runAnalysis({
      systemPrompt: 'SYSTEM', userPrompt: 'USER',
      jsonSchema: {
        type: 'object', required: ['answer'],
        properties: { answer: { type: 'string' }, optional: { type: 'string' } },
      },
    });

    expect(result).toMatchObject({
      rawJson: '{"answer":"safe"}', provider: 'codex-native', model: 'codex-default',
      inputTokens: 101, cacheReadTokens: 41, cacheCreationTokens: 7,
      outputTokens: 23, reasoningTokens: 11,
    });
    const capture = JSON.parse(readFileSync(capturePath, 'utf8')) as {
      argv: string[]; stdin: string; cwd: string; recursion?: string; codeHome?: string;
      credentials: Record<string, string | undefined>;
      schema: { required: string[]; additionalProperties: boolean };
    };
    expect(capture.argv).toEqual(expect.arrayContaining([
      'exec', '--ephemeral', '--skip-git-repo-check',
      '--ignore-user-config', '--ignore-rules', '--disable', 'hooks', '--output-schema',
      expect.stringMatching(/schema\.json$/), '--json', '--color', 'never', '--cd', '-',
    ]));
    expect(capture.argv[capture.argv.indexOf('--cd') + 1]).toMatch(/agent-analytics-codex-native-/);
    expect(capture.argv).not.toContain('--model');
    expect(capture.stdin).toContain('SYSTEM');
    expect(capture.stdin).toContain('USER');
    expect(capture.recursion).toBe('1');
    expect(capture.codeHome).toBe('/safe/chatgpt-login');
    expect(capture.credentials).toEqual({});
    expect(capture.argv).toEqual(expect.arrayContaining([
      '--strict-config', '--disable', 'shell_tool', '--disable', 'multi_agent',
      '--config', 'web_search="disabled"',
    ]));
    expect(capture.argv.join(' ')).toContain('permissions.agent_analytics.filesystem');
    expect(capture.argv).not.toContain('--sandbox');
    expect(capture.schema).toMatchObject({
      required: ['answer', 'optional'], additionalProperties: false,
    });
    expect(capture.cwd).toMatch(/agent-analytics-codex-native-/);
  });

  it('passes an explicitly configured model without inventing a default override', async () => {
    const { capturePath } = installFakeCodex('success');
    const result = await new CodexNativeRunner({ model: 'gpt-explicit' }).runAnalysis({
      systemPrompt: 's', userPrompt: 'u', jsonSchema: { type: 'object' },
    });
    const capture = JSON.parse(readFileSync(capturePath, 'utf8')) as { argv: string[] };
    expect(capture.argv.slice(capture.argv.indexOf('--model'), capture.argv.indexOf('--model') + 2))
      .toEqual(['--model', 'gpt-explicit']);
    expect(result.model).toBe('gpt-explicit');
  });

  it.each([
    ['malformed', /invalid JSONL/i],
    ['failed-event', /failed turn/i],
    ['missing-usage', /turn\.completed/i],
    ['nonzero', /exit code 17/i],
    ['tool-call', /disabled tool/i],
  ])('rejects %s output without accepting partial analysis', async (scenario, message) => {
    installFakeCodex(scenario);
    await expect(new CodexNativeRunner().runAnalysis({
      systemPrompt: 's', userPrompt: 'u', jsonSchema: { type: 'object' },
    })).rejects.toThrow(message);
  });

  it('terminates a hung Codex subprocess at the configured deadline', async () => {
    installFakeCodex('timeout');
    await expect(new CodexNativeRunner({ timeoutMs: 30 }).runAnalysis({
      systemPrompt: 's', userPrompt: 'u', jsonSchema: { type: 'object' },
    })).rejects.toThrow(/timed out/i);
  });
});
