import { classifyStoredUserMessage } from './message-format.js';
import type { SQLiteMessageRow } from './prompt-types.js';

export type SessionAnalysisKind = 'session' | 'prompt_quality';
export type AnalysisUnavailableReason =
  | 'no-human-messages'
  | 'no-assistant-messages'
  | 'no-complete-turns'
  | 'insufficient-human-messages';

export interface AnalysisEligibility {
  eligible: boolean;
  kind: SessionAnalysisKind;
  reason: AnalysisUnavailableReason | null;
  humanMessageCount: number;
  assistantMessageCount: number;
  completeTurnCount: number;
  toolExchangeCount: number;
}

export class AnalysisEligibilityError extends Error {
  constructor(readonly eligibility: AnalysisEligibility) {
    super(analysisUnavailableMessage(eligibility));
    this.name = 'AnalysisEligibilityError';
  }
}

function countToolCalls(value: string): number {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.length : 0;
  } catch {
    return 0;
  }
}

export function assessAnalysisEligibility(
  messages: readonly SQLiteMessageRow[],
  kind: SessionAnalysisKind,
): AnalysisEligibility {
  let humanMessageCount = 0;
  let assistantMessageCount = 0;
  let completeTurnCount = 0;
  let toolExchangeCount = 0;
  let openHumanTurn = false;

  for (const message of messages) {
    toolExchangeCount += countToolCalls(message.tool_calls);
    if (message.type === 'user' && classifyStoredUserMessage(message.content) === 'human') {
      humanMessageCount += 1;
      openHumanTurn = true;
    } else if (message.type === 'assistant') {
      assistantMessageCount += 1;
      if (openHumanTurn) {
        completeTurnCount += 1;
        openHumanTurn = false;
      }
    }
  }

  let reason: AnalysisUnavailableReason | null = null;
  if (humanMessageCount === 0) reason = 'no-human-messages';
  else if (assistantMessageCount === 0) reason = 'no-assistant-messages';
  else if (completeTurnCount === 0) reason = 'no-complete-turns';
  else if (kind === 'prompt_quality' && humanMessageCount < 2) reason = 'insufficient-human-messages';

  return {
    eligible: reason === null,
    kind,
    reason,
    humanMessageCount,
    assistantMessageCount,
    completeTurnCount,
    toolExchangeCount,
  };
}

export function analysisUnavailableMessage(eligibility: AnalysisEligibility): string {
  switch (eligibility.reason) {
    case 'no-human-messages':
      return 'Analysis unavailable: no genuine user messages were imported for this session.';
    case 'no-assistant-messages':
      return 'Analysis unavailable: no assistant messages were imported for this session.';
    case 'no-complete-turns':
      return 'Analysis unavailable: the imported session contains no complete user-assistant turn.';
    case 'insufficient-human-messages':
      return 'Prompt quality analysis unavailable: at least 2 genuine user messages are required.';
    default:
      return 'Analysis is eligible.';
  }
}
