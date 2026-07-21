import { describe, it, expect } from 'vitest';
import { formatAgentRules } from './agent-rules.js';
import type { SessionRow, InsightRow } from './knowledge-base.js';

// ──────────────────────────────────────────────────────
// Factories
// ──────────────────────────────────────────────────────

function makeSession(overrides: Partial<SessionRow> = {}): SessionRow {
  return {
    id: 'session-1',
    project_name: 'my-project',
    generated_title: 'Generated Title',
    custom_title: null,
    started_at: '2026-01-01T10:00:00Z',
    ended_at: '2026-01-01T11:00:00Z',
    message_count: 20,
    estimated_cost_usd: 0.05,
    session_character: 'feature_build',
    source_tool: 'claude-code',
    ...overrides,
  };
}

function makeInsight(overrides: Partial<InsightRow> = {}): InsightRow {
  return {
    id: 'insight-1',
    session_id: 'session-1',
    project_id: 'project-1',
    project_name: 'my-project',
    type: 'decision',
    title: 'Use TypeScript strict mode',
    content: 'Enable strict mode in tsconfig.json',
    summary: null,
    bullets: null,
    confidence: 90,
    source: null,
    metadata: null,
    timestamp: '2026-01-01T10:30:00Z',
    created_at: '2026-01-01T10:30:00Z',
    scope: null,
    analysis_version: null,
    linked_insight_ids: null,
    ...overrides,
  };
}

// ──────────────────────────────────────────────────────
// formatAgentRules — empty state
// ──────────────────────────────────────────────────────

describe('formatAgentRules — empty sessions', () => {
  it('returns valid markdown when sessions is empty', () => {
    const result = formatAgentRules([], []);
    expect(result).toContain('# Agent Rules Export');
  });

  it('returns no sessions message when sessions is empty', () => {
    const result = formatAgentRules([], []);
    expect(result).toContain('*No sessions selected.*');
  });
});

// ──────────────────────────────────────────────────────
// formatAgentRules — header
// ──────────────────────────────────────────────────────

describe('formatAgentRules — header', () => {
  it('includes session count in header', () => {
    const result = formatAgentRules([makeSession()], []);
    expect(result).toContain('1 session');
  });

  it('uses plural form for multiple sessions', () => {
    const sessions = [makeSession({ id: 's1' }), makeSession({ id: 's2' })];
    const result = formatAgentRules(sessions, []);
    expect(result).toContain('2 sessions');
  });

  it('includes project name in header', () => {
    const result = formatAgentRules([makeSession({ project_name: 'awesome-app' })], []);
    expect(result).toContain('Project: awesome-app');
  });

  it('falls back to "unknown" when no project name', () => {
    const result = formatAgentRules([makeSession({ project_name: null })], []);
    expect(result).toContain('Project: unknown');
  });

  it('includes date range in header', () => {
    const session = makeSession({
      started_at: '2026-01-01T10:00:00Z',
      ended_at: '2026-01-05T11:00:00Z',
    });
    const result = formatAgentRules([session], []);
    expect(result).toContain('2026-01-01');
    expect(result).toContain('2026-01-05');
  });

  it('shows "all time" when sessions have no dates', () => {
    const session = makeSession({ started_at: null, ended_at: null });
    const result = formatAgentRules([session], []);
    expect(result).toContain('all time');
  });
});

// ──────────────────────────────────────────────────────
// formatAgentRules — no insights
// ──────────────────────────────────────────────────────

describe('formatAgentRules — no insights', () => {
  it('emits note when no insights are present', () => {
    const result = formatAgentRules([makeSession()], []);
    expect(result).toContain('No insights found');
  });

  it('does not emit Decisions section when no insights', () => {
    const result = formatAgentRules([makeSession()], []);
    expect(result).not.toContain('## Decisions');
  });
});

// ──────────────────────────────────────────────────────
// formatAgentRules — decision insights
// ──────────────────────────────────────────────────────

describe('formatAgentRules — decision insights', () => {
  it('renders Decisions section when decision insights exist', () => {
    const insight = makeInsight({ type: 'decision' });
    const result = formatAgentRules([makeSession()], [insight]);
    expect(result).toContain('## Decisions');
    expect(result).toContain('### Use TypeScript strict mode');
  });

  it('renders USE directive with both choice and situation', () => {
    const insight = makeInsight({
      type: 'decision',
      metadata: JSON.stringify({
        choice: 'strict mode',
        situation: 'new TypeScript projects',
      }),
    });
    const result = formatAgentRules([makeSession()], [insight]);
    expect(result).toContain('- USE strict mode for new TypeScript projects');
  });

  it('renders USE directive with only choice', () => {
    const insight = makeInsight({
      type: 'decision',
      metadata: JSON.stringify({ choice: 'strict mode' }),
    });
    const result = formatAgentRules([makeSession()], [insight]);
    expect(result).toContain('- USE strict mode');
    expect(result).not.toContain('for undefined');
  });

  it('falls back to raw content when no structured metadata', () => {
    const insight = makeInsight({
      type: 'decision',
      content: 'Always prefer immutability',
      metadata: null,
    });
    const result = formatAgentRules([makeSession()], [insight]);
    expect(result).toContain('- Always prefer immutability');
  });

  it('renders DO NOT directives for alternatives', () => {
    const insight = makeInsight({
      type: 'decision',
      metadata: JSON.stringify({
        choice: 'strict mode',
        alternatives: [
          { option: 'loose mode', rejected_because: 'misses type errors' },
          'no-check mode',
        ],
      }),
    });
    const result = formatAgentRules([makeSession()], [insight]);
    expect(result).toContain('- DO NOT use loose mode because misses type errors');
    expect(result).toContain('- DO NOT use no-check mode');
  });

  it('renders REVISIT directive when revisit_when is set', () => {
    const insight = makeInsight({
      type: 'decision',
      metadata: JSON.stringify({
        choice: 'strict mode',
        revisit_when: 'migrating legacy JS code',
      }),
    });
    const result = formatAgentRules([makeSession()], [insight]);
    expect(result).toContain('- REVISIT this decision when migrating legacy JS code');
  });
});

// ──────────────────────────────────────────────────────
// formatAgentRules — learning insights
// ──────────────────────────────────────────────────────

describe('formatAgentRules — learning insights', () => {
  it('renders Learnings section when learning insights exist', () => {
    const insight = makeInsight({ type: 'learning', title: 'Avoid global state' });
    const result = formatAgentRules([makeSession()], [insight]);
    expect(result).toContain('## Learnings');
    expect(result).toContain('### Avoid global state');
  });

  it('renders full WHEN directive with applies_when, symptom, and root_cause', () => {
    const insight = makeInsight({
      type: 'learning',
      metadata: JSON.stringify({
        applies_when: 'writing concurrent code',
        symptom: 'race conditions occur',
        root_cause: 'shared mutable state',
      }),
    });
    const result = formatAgentRules([makeSession()], [insight]);
    expect(result).toContain('- WHEN writing concurrent code, be aware that race conditions occur is caused by shared mutable state');
  });

  it('renders symptom+root_cause without applies_when', () => {
    const insight = makeInsight({
      type: 'learning',
      metadata: JSON.stringify({
        symptom: 'race conditions occur',
        root_cause: 'shared mutable state',
      }),
    });
    const result = formatAgentRules([makeSession()], [insight]);
    expect(result).toContain('- Be aware that race conditions occur is caused by shared mutable state');
  });

  it('renders takeaway as bullet when present', () => {
    const insight = makeInsight({
      type: 'learning',
      metadata: JSON.stringify({
        symptom: 'some issue',
        root_cause: 'some cause',
        takeaway: 'Use immutable data structures',
      }),
    });
    const result = formatAgentRules([makeSession()], [insight]);
    expect(result).toContain('- Use immutable data structures');
  });

  it('falls back to raw content when no structured metadata', () => {
    const insight = makeInsight({
      type: 'learning',
      content: 'Always validate inputs',
      metadata: null,
    });
    const result = formatAgentRules([makeSession()], [insight]);
    expect(result).toContain('- Always validate inputs');
  });
});

// ──────────────────────────────────────────────────────
// formatAgentRules — technique insights
// ──────────────────────────────────────────────────────

describe('formatAgentRules — technique insights', () => {
  it('renders Techniques section when technique insights exist', () => {
    const insight = makeInsight({ type: 'technique', title: 'Use binary search' });
    const result = formatAgentRules([makeSession()], [insight]);
    expect(result).toContain('## Techniques');
    expect(result).toContain('### Use binary search');
  });

  it('renders WHEN directive for techniques with context', () => {
    const insight = makeInsight({
      type: 'technique',
      content: 'Apply binary search algorithm',
      metadata: JSON.stringify({ context: 'searching sorted arrays' }),
    });
    const result = formatAgentRules([makeSession()], [insight]);
    expect(result).toContain('- WHEN searching sorted arrays, use this approach:');
  });

  it('indents content under the WHEN directive', () => {
    const insight = makeInsight({
      type: 'technique',
      content: 'Apply binary search algorithm',
      metadata: JSON.stringify({ context: 'searching sorted arrays' }),
    });
    const result = formatAgentRules([makeSession()], [insight]);
    expect(result).toContain('  Apply binary search algorithm');
  });

  it('renders applicability when present', () => {
    const insight = makeInsight({
      type: 'technique',
      content: 'Apply binary search',
      metadata: JSON.stringify({ applicability: 'sorted data structures' }),
    });
    const result = formatAgentRules([makeSession()], [insight]);
    expect(result).toContain('- Applicability: sorted data structures');
  });
});

// ──────────────────────────────────────────────────────
// formatAgentRules — prompt_quality insights
// ──────────────────────────────────────────────────────

describe('formatAgentRules — prompt_quality insights', () => {
  it('renders Prompt Patterns to Avoid section for deficit findings', () => {
    const insight = makeInsight({
      type: 'prompt_quality',
      metadata: JSON.stringify({
        findings: [
          {
            type: 'deficit',
            category: 'vague-request',
            description: 'Request was too vague',
            suggested_improvement: 'Add specific acceptance criteria',
          },
        ],
      }),
    });
    const result = formatAgentRules([makeSession()], [insight]);
    expect(result).toContain('## Prompt Patterns to Avoid');
    expect(result).toContain('- AVOID: Request was too vague [vague-request]. Instead: Add specific acceptance criteria');
  });

  it('excludes strength findings from avoid section', () => {
    const insight = makeInsight({
      type: 'prompt_quality',
      metadata: JSON.stringify({
        findings: [
          {
            type: 'strength',
            category: 'effective-context',
            description: 'Good context provided',
          },
          {
            type: 'deficit',
            category: 'vague-request',
            description: 'Vague request',
          },
        ],
      }),
    });
    const result = formatAgentRules([makeSession()], [insight]);
    expect(result).toContain('- AVOID: Vague request');
    expect(result).not.toContain('Good context provided');
  });

  it('renders legacy antiPatterns schema', () => {
    const insight = makeInsight({
      type: 'prompt_quality',
      metadata: JSON.stringify({
        antiPatterns: [
          { name: 'Vague prompts', description: 'Too generic', fix: 'Add examples' },
        ],
      }),
    });
    const result = formatAgentRules([makeSession()], [insight]);
    expect(result).toContain('## Prompt Patterns to Avoid');
    expect(result).toContain('- AVOID Vague prompts: Too generic. Instead: Add examples');
  });

  it('does not emit section when all findings are strengths', () => {
    const insight = makeInsight({
      type: 'prompt_quality',
      metadata: JSON.stringify({
        findings: [
          { type: 'strength', category: 'precise-request', description: 'Very clear request' },
        ],
      }),
    });
    const result = formatAgentRules([makeSession()], [insight]);
    expect(result).not.toContain('## Prompt Patterns to Avoid');
  });

  it('does not emit section when there are no deficits', () => {
    const insight = makeInsight({
      type: 'prompt_quality',
      metadata: null,
    });
    const result = formatAgentRules([makeSession()], [insight]);
    expect(result).not.toContain('## Prompt Patterns to Avoid');
  });
});

// ──────────────────────────────────────────────────────
// formatAgentRules — multiple sessions (cross-session grouping)
// ──────────────────────────────────────────────────────

describe('formatAgentRules — multiple sessions', () => {
  it('groups insights across sessions into global type sections', () => {
    const sessions = [
      makeSession({ id: 's1' }),
      makeSession({ id: 's2' }),
    ];
    const insights = [
      makeInsight({ id: 'i1', session_id: 's1', type: 'decision', title: 'Decision from S1' }),
      makeInsight({ id: 'i2', session_id: 's2', type: 'decision', title: 'Decision from S2' }),
    ];
    const result = formatAgentRules(sessions, insights);
    // Only one Decisions section (cross-session grouping)
    const decisionMatches = result.match(/## Decisions/g);
    expect(decisionMatches).toHaveLength(1);
    expect(result).toContain('### Decision from S1');
    expect(result).toContain('### Decision from S2');
  });

  it('computes date range across all sessions', () => {
    const sessions = [
      makeSession({ id: 's1', started_at: '2026-01-01T00:00:00Z', ended_at: '2026-01-03T00:00:00Z' }),
      makeSession({ id: 's2', started_at: '2026-01-10T00:00:00Z', ended_at: '2026-01-15T00:00:00Z' }),
    ];
    const result = formatAgentRules(sessions, []);
    expect(result).toContain('2026-01-01');
    expect(result).toContain('2026-01-15');
  });
});

// ──────────────────────────────────────────────────────
// formatAgentRules — different session characters
// ──────────────────────────────────────────────────────

describe('formatAgentRules — session characters', () => {
  const characters = ['deep_focus', 'bug_hunt', 'feature_build', 'exploration', 'refactor', 'learning', 'quick_task'];

  for (const character of characters) {
    it(`handles ${character} session character without error`, () => {
      const session = makeSession({ session_character: character });
      expect(() => formatAgentRules([session], [])).not.toThrow();
    });
  }
});

// ──────────────────────────────────────────────────────
// formatAgentRules — edge cases
// ──────────────────────────────────────────────────────

describe('formatAgentRules — edge cases', () => {
  it('handles malformed metadata JSON gracefully', () => {
    const insight = makeInsight({ type: 'decision', metadata: '{invalid json' });
    expect(() => formatAgentRules([makeSession()], [insight])).not.toThrow();
  });

  it('handles insights with unknown type without crashing', () => {
    const insight = makeInsight({ type: 'unknown_type' });
    expect(() => formatAgentRules([makeSession()], [insight])).not.toThrow();
  });

  it('multiline technique content is indented per line', () => {
    const insight = makeInsight({
      type: 'technique',
      content: 'Line one\nLine two\nLine three',
      metadata: JSON.stringify({ context: 'multi-line scenario' }),
    });
    const result = formatAgentRules([makeSession()], [insight]);
    expect(result).toContain('  Line one');
    expect(result).toContain('  Line two');
    expect(result).toContain('  Line three');
  });
});
