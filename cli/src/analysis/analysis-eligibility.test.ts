import { describe, expect, it } from 'vitest';
import { assessAnalysisEligibility } from './analysis-eligibility.js';
import type { SQLiteMessageRow } from './prompt-types.js';

function row(id: string, type: SQLiteMessageRow['type'], content: string, toolCalls = '[]'): SQLiteMessageRow {
  return {
    id, session_id: 'session-1', type, content, thinking: null,
    tool_calls: toolCalls, tool_results: '[]', usage: null,
    timestamp: `2026-07-22T00:00:0${id.length}Z`, parent_id: null,
  };
}

describe('assessAnalysisEligibility', () => {
  it('rejects tool-only evidence instead of manufacturing a score', () => {
    const result = assessAnalysisEligibility([
      row('a', 'assistant', '', JSON.stringify([{ name: 'exec_command' }, { name: 'read_file' }])),
    ], 'prompt_quality');

    expect(result).toMatchObject({
      eligible: false, reason: 'no-human-messages', humanMessageCount: 0,
      assistantMessageCount: 1, toolExchangeCount: 2,
    });
  });

  it('allows session insight extraction after one complete turn but not prompt scoring', () => {
    const messages = [row('u', 'user', 'Fix the issue.'), row('a', 'assistant', 'Done.')];

    expect(assessAnalysisEligibility(messages, 'session')).toMatchObject({ eligible: true, completeTurnCount: 1 });
    expect(assessAnalysisEligibility(messages, 'prompt_quality')).toMatchObject({
      eligible: false, reason: 'insufficient-human-messages',
    });
  });

  it('ignores stored tool-result rows when counting human messages', () => {
    const messages = [
      row('u1', 'user', 'First prompt.'),
      row('tool', 'user', '[{"type":"tool_result","content":"ok"}]'),
      row('a1', 'assistant', 'First response.'),
      row('u2', 'user', 'Continue.'),
    ];

    expect(assessAnalysisEligibility(messages, 'prompt_quality')).toMatchObject({
      eligible: true, humanMessageCount: 2, assistantMessageCount: 1, completeTurnCount: 1,
    });
  });
});
