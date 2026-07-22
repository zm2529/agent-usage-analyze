import { describe, expect, it } from 'vitest';
import { classifyCodexLoginResult, resolveAnalysisExecutionPolicy } from './execution-policy.js';
import type { ClaudeInsightConfig } from '../types.js';

const baseConfig = (overrides: Partial<ClaudeInsightConfig['dashboard']> = {}): ClaudeInsightConfig => ({
  sync: { claudeDir: '~/.claude/projects', excludeProjects: [] },
  dashboard: overrides,
});

describe('resolveAnalysisExecutionPolicy', () => {
  it('preserves an explicitly configured provider in auto mode', () => {
    const result = resolveAnalysisExecutionPolicy(baseConfig({
      llm: { provider: 'ollama', model: 'qwen3:14b' },
    }), { codexAuth: () => ({ kind: 'chatgpt' }), claudeAvailable: () => true });

    expect(result).toMatchObject({
      mode: 'auto', effectiveRunner: 'provider', authentication: 'provider', locality: 'local',
      reason: 'configured-provider',
    });
  });

  it('uses Codex only when auto mode can prove ChatGPT authentication', () => {
    const result = resolveAnalysisExecutionPolicy(baseConfig(), {
      codexAuth: () => ({ kind: 'chatgpt' }), claudeAvailable: () => true,
    });

    expect(result).toMatchObject({
      mode: 'auto', effectiveRunner: 'codex-native', authentication: 'chatgpt', locality: 'remote',
      reason: 'codex-chatgpt-auth',
    });
  });

  it.each([
    ['api-key', 'codex-api-key-not-automatic'],
    ['access-token', 'codex-access-token-not-automatic'],
    ['unknown', 'codex-auth-unknown'],
    ['not-logged-in', 'codex-not-logged-in'],
    ['cli-missing', 'codex-cli-missing'],
  ] as const)('falls back locally for %s authentication without calling another runner', (kind, reason) => {
    const result = resolveAnalysisExecutionPolicy(baseConfig(), {
      codexAuth: () => ({ kind }), claudeAvailable: () => true,
    });

    expect(result).toMatchObject({ effectiveRunner: 'local-only', authentication: kind, reason });
  });

  it('honours every explicit mode without discarding its diagnostic', () => {
    const auth = { codexAuth: () => ({ kind: 'api-key' as const }), claudeAvailable: () => false };
    expect(resolveAnalysisExecutionPolicy(baseConfig({ analysis: { mode: 'codex-native' } }), auth))
      .toMatchObject({ effectiveRunner: 'codex-native', authentication: 'api-key', reason: 'explicit-codex-native-metered' });
    expect(resolveAnalysisExecutionPolicy(baseConfig({ analysis: { mode: 'claude-native' } }), {
      codexAuth: auth.codexAuth, claudeAvailable: () => true,
    })).toMatchObject({
      effectiveRunner: 'claude-native', authentication: 'claude-auth-unverified',
      reason: 'explicit-claude-native-auth-unverified',
    });
    expect(resolveAnalysisExecutionPolicy(baseConfig({ analysis: { mode: 'provider' } }), auth))
      .toMatchObject({ effectiveRunner: 'unavailable', reason: 'provider-not-configured' });
    expect(resolveAnalysisExecutionPolicy(baseConfig({ analysis: { mode: 'local-only' } }), auth))
      .toMatchObject({ effectiveRunner: 'local-only', locality: 'local' });
    expect(resolveAnalysisExecutionPolicy(baseConfig({ analysis: { mode: 'off' } }), auth))
      .toMatchObject({ effectiveRunner: 'off', locality: 'local' });
  });

  it('does not run explicit Codex mode when authentication is unknown', () => {
    expect(resolveAnalysisExecutionPolicy(baseConfig({ analysis: { mode: 'codex-native' } }), {
      codexAuth: () => ({ kind: 'unknown' }), claudeAvailable: () => false,
    })).toMatchObject({ effectiveRunner: 'unavailable', authentication: 'unknown', reason: 'codex-auth-unknown' });
  });
});

describe('classifyCodexLoginResult', () => {
  it('distinguishes an execution failure from an explicit logged-out result', () => {
    expect(classifyCodexLoginResult({ status: null, stdout: '', stderr: '', errorCode: 'ETIMEDOUT' }))
      .toEqual({ kind: 'unknown' });
    expect(classifyCodexLoginResult({ status: 1, stdout: '', stderr: 'Not logged in' }))
      .toEqual({ kind: 'not-logged-in', detail: 'Not logged in' });
  });
});
