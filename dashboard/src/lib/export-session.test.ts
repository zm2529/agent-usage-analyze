import { describe, expect, it } from 'vitest';
import { buildSessionMarkdown } from './export-session';
import type { Message, Session } from './types';

const session = {
  id: 'codex:session',
  project_name: 'codex-vibe-coding',
  generated_title: 'Analyze my Codex habits',
  custom_title: null,
  started_at: '2026-07-21T07:56:00.000Z',
  ended_at: '2026-07-21T08:04:00.000Z',
} as Session;

const messages = [
  {
    id: 'user', session_id: session.id, type: 'user',
    content: 'Analyze my real Codex usage.', thinking: null,
    tool_calls: '[]', tool_results: '[]', usage: null,
    timestamp: '2026-07-21T07:56:00.000Z', parent_id: null,
  },
  {
    id: 'assistant', session_id: session.id, type: 'assistant',
    content: 'You are already operating as an AI engineering orchestrator.',
    thinking: 'Reviewed the local history.',
    tool_calls: '[]', tool_results: '[]', usage: null,
    timestamp: '2026-07-21T07:57:00.000Z', parent_id: null,
  },
] as Message[];

describe('session markdown export', () => {
  it('includes the complete visible conversation even when no summary or insights exist', () => {
    const result = buildSessionMarkdown(session, [], null, messages, 'plain');

    expect(result.content).toContain('## Conversation');
    expect(result.content).toContain('Analyze my real Codex usage.');
    expect(result.content).toContain('You are already operating as an AI engineering orchestrator.');
    expect(result.content).toContain('Reviewed the local history.');
    expect(result.filename).toBe('session-codex-vibe-coding-2026-07-21.md');
  });
});
