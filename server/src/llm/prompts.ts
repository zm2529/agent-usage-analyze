// Re-exports from @agent-analytics/cli/analysis/prompts.
// Moved to CLI package so the CLI can use prompt builders for native analysis (--native mode).
export {
  SHARED_ANALYST_SYSTEM_PROMPT,
  buildCacheableConversationBlock,
  buildSessionAnalysisInstructions,
  buildPromptQualityInstructions,
  buildFacetOnlyInstructions,
} from '@agent-analytics/cli/analysis/prompts';
