// Re-exports from agent-usage-analyze/analysis/message-format.
// Moved to CLI package so the CLI can use message formatting for native analysis (--native mode).
export {
  classifyStoredUserMessage,
  formatMessagesForAnalysis,
  formatSessionMetaLine,
} from 'agent-usage-analyze/analysis/message-format';
