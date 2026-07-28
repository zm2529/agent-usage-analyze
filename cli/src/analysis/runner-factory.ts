import { loadConfig } from '../utils/config.js';
import { ClaudeNativeRunner } from './native-runner.js';
import { CodexNativeRunner } from './codex-native-runner.js';
import { ProviderRunner } from './provider-runner.js';
import {
  resolveAnalysisExecutionPolicy,
  type AnalysisExecutionState,
} from './execution-policy.js';
import type { AnalysisRunner } from './runner-types.js';

export interface SelectedAnalysisRunner {
  state: AnalysisExecutionState;
  runner: AnalysisRunner;
}

/** Build the model runner selected by the same policy shown in Settings. */
export function createAnalysisRunnerFromPolicy(options: {
  codexTimeoutMs?: number;
  codexReasoningEffort?: 'low' | 'medium' | 'high';
} = {}): SelectedAnalysisRunner {
  const state = resolveAnalysisExecutionPolicy(loadConfig());
  switch (state.effectiveRunner) {
    case 'provider':
      return { state, runner: ProviderRunner.fromConfig() };
    case 'codex-native':
      return {
        state,
        runner: new CodexNativeRunner({
          model: state.model,
          reasoningEffort: options.codexReasoningEffort,
          timeoutMs: options.codexTimeoutMs,
        }),
      };
    case 'claude-native':
      return { state, runner: new ClaudeNativeRunner() };
    default:
      throw new Error(`Automatic LLM analysis is unavailable: ${state.reason}`);
  }
}
