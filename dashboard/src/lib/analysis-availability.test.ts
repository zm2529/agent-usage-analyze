import { describe, expect, it } from 'vitest';
import { isAutomaticAnalysisAvailable } from './analysis-availability';
import type { LLMConfig } from './types';

function config(effectiveRunner: LLMConfig['analysis']['effectiveRunner']): LLMConfig {
  return {
    dashboardPort: 7890,
    semanticAnalysisEnabled: false,
    analysis: {
      mode: 'auto', effectiveRunner, authentication: 'chatgpt',
      locality: 'remote', reason: 'test',
    },
    capabilities: {
      hookCapture: true,
      sessionLlmAnalysis: true,
      automaticBehaviorReport: true,
      contextDocumentAnalysis: true,
      tokenEfficiencyAnalysis: true,
      skillOpportunityAnalysis: true,
    },
  };
}

describe('isAutomaticAnalysisAvailable', () => {
  it.each(['provider', 'codex-native', 'claude-native'] as const)(
    'accepts the resolved %s runner without requiring provider/model fields',
    (runner) => expect(isAutomaticAnalysisAvailable(config(runner))).toBe(true),
  );

  it.each(['local-only', 'off', 'unavailable'] as const)(
    'rejects the non-LLM %s state',
    (runner) => expect(isAutomaticAnalysisAvailable(config(runner))).toBe(false),
  );
});
