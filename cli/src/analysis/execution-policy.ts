import { spawnSync } from 'child_process';
import type {
  AnalysisExecutionMode,
  ClaudeInsightConfig,
  LLMProviderConfig,
} from '../types.js';
import { semanticProviderLocality } from '../canonical/semantic-analysis.js';

export type CodexAuthentication =
  | 'chatgpt'
  | 'api-key'
  | 'access-token'
  | 'not-logged-in'
  | 'unknown'
  | 'cli-missing';

export type EffectiveAnalysisRunner =
  | 'provider'
  | 'codex-native'
  | 'claude-native'
  | 'local-only'
  | 'off'
  | 'unavailable';

export interface AnalysisExecutionState {
  mode: AnalysisExecutionMode;
  effectiveRunner: EffectiveAnalysisRunner;
  authentication: CodexAuthentication | 'provider' | 'claude-auth-unverified' | 'none';
  locality: 'local' | 'remote';
  reason: string;
  provider?: string;
  model?: string;
}

export interface AnalysisCapabilityProbe {
  codexAuth(): { kind: CodexAuthentication; detail?: string };
  claudeAvailable(): boolean;
}

const MODES = new Set<AnalysisExecutionMode>([
  'auto', 'codex-native', 'claude-native', 'provider', 'local-only', 'off',
]);

export function isAnalysisExecutionMode(value: unknown): value is AnalysisExecutionMode {
  return typeof value === 'string' && MODES.has(value as AnalysisExecutionMode);
}

export interface CodexLoginProcessResult {
  status: number | null;
  stdout: string;
  stderr: string;
  errorCode?: string;
}

export function classifyCodexLoginResult(result: CodexLoginProcessResult): { kind: CodexAuthentication; detail?: string } {
  if (result.errorCode === 'ENOENT') return { kind: 'cli-missing' };
  if (result.errorCode) return { kind: 'unknown' };
  const detail = `${result.stdout}\n${result.stderr}`.trim();
  if (result.status !== 0) {
    return /not logged in|login required|please log in/i.test(detail)
      ? { kind: 'not-logged-in', detail }
      : { kind: 'unknown', ...(detail ? { detail } : {}) };
  }
  if (/logged in using chatgpt/i.test(detail)) return { kind: 'chatgpt' };
  if (/api key/i.test(detail)) return { kind: 'api-key' };
  if (/access token/i.test(detail)) return { kind: 'access-token' };
  return { kind: 'unknown', ...(detail ? { detail } : {}) };
}

export function detectCodexAuthentication(): { kind: CodexAuthentication; detail?: string } {
  const result = spawnSync('codex', ['login', 'status'], {
    encoding: 'utf8', timeout: 5_000, stdio: ['ignore', 'pipe', 'pipe'],
  });
  return classifyCodexLoginResult({
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    errorCode: result.error ? (result.error as NodeJS.ErrnoException).code : undefined,
  });
}

export function detectClaudeAvailable(): boolean {
  const result = spawnSync('claude', ['--version'], {
    encoding: 'utf8', timeout: 5_000, stdio: 'ignore',
  });
  return !result.error && result.status === 0;
}

const defaultProbe: AnalysisCapabilityProbe = {
  codexAuth: detectCodexAuthentication,
  claudeAvailable: detectClaudeAvailable,
};

function providerState(mode: AnalysisExecutionMode, llm: LLMProviderConfig): AnalysisExecutionState {
  return {
    mode,
    effectiveRunner: 'provider',
    authentication: 'provider',
    locality: semanticProviderLocality(llm.provider, llm.baseUrl),
    reason: 'configured-provider',
    provider: llm.provider,
    model: llm.model,
  };
}

function unavailable(mode: AnalysisExecutionMode, reason: string, authentication: AnalysisExecutionState['authentication'] = 'none'): AnalysisExecutionState {
  return { mode, effectiveRunner: 'unavailable', authentication, locality: 'local', reason };
}

export function resolveAnalysisExecutionPolicy(
  config: ClaudeInsightConfig | null,
  probe: AnalysisCapabilityProbe = defaultProbe,
): AnalysisExecutionState {
  const configuredMode = config?.dashboard?.analysis?.mode;
  const mode = isAnalysisExecutionMode(configuredMode) ? configuredMode : 'auto';
  const llm = config?.dashboard?.llm;

  if (mode === 'off') {
    return { mode, effectiveRunner: 'off', authentication: 'none', locality: 'local', reason: 'explicit-off' };
  }
  if (mode === 'local-only') {
    return { mode, effectiveRunner: 'local-only', authentication: 'none', locality: 'local', reason: 'explicit-local-only' };
  }
  if (mode === 'provider') {
    return llm?.provider && llm.model ? providerState(mode, llm) : unavailable(mode, 'provider-not-configured');
  }
  if (mode === 'claude-native') {
    return probe.claudeAvailable()
      ? {
        mode, effectiveRunner: 'claude-native', authentication: 'claude-auth-unverified',
        locality: 'remote', reason: 'explicit-claude-native-auth-unverified',
      }
      : unavailable(mode, 'claude-cli-missing');
  }

  if (mode === 'auto' && llm?.provider && llm.model) return providerState(mode, llm);

  const auth = probe.codexAuth().kind;
  if (mode === 'codex-native') {
    if (auth === 'cli-missing') return unavailable(mode, 'codex-cli-missing', auth);
    if (auth === 'not-logged-in') return unavailable(mode, 'codex-not-logged-in', auth);
    if (auth === 'unknown') return unavailable(mode, 'codex-auth-unknown', auth);
    const suffix = auth === 'api-key' ? '-metered' : auth === 'access-token' ? '-access-token' : '';
    return {
      mode, effectiveRunner: 'codex-native', authentication: auth, locality: 'remote',
      reason: `explicit-codex-native${suffix}`,
      model: config?.dashboard?.analysis?.codexModel,
    };
  }
  if (auth === 'chatgpt') {
    return {
      mode, effectiveRunner: 'codex-native', authentication: auth, locality: 'remote',
      reason: 'codex-chatgpt-auth', model: config?.dashboard?.analysis?.codexModel,
    };
  }
  const reasons: Record<Exclude<CodexAuthentication, 'chatgpt'>, string> = {
    'api-key': 'codex-api-key-not-automatic',
    'access-token': 'codex-access-token-not-automatic',
    unknown: 'codex-auth-unknown',
    'not-logged-in': 'codex-not-logged-in',
    'cli-missing': 'codex-cli-missing',
  };
  return {
    mode, effectiveRunner: 'local-only', authentication: auth, locality: 'local', reason: reasons[auth],
  };
}
