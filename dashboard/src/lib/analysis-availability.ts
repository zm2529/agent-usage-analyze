import type { LLMConfig } from './types';

const AUTOMATIC_RUNNERS = new Set(['provider', 'codex-native', 'claude-native']);

/** True when the product can analyze through its resolved automatic policy. */
export function isAutomaticAnalysisAvailable(config: LLMConfig | null | undefined): boolean {
  return Boolean(config?.analysis?.effectiveRunner
    && AUTOMATIC_RUNNERS.has(config.analysis.effectiveRunner));
}
