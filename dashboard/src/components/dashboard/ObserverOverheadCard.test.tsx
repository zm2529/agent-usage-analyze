import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ObserverOverheadCard } from './ObserverOverheadCard';

describe('ObserverOverheadCard', () => {
  it('keeps observer cost and interactions separate from analyzed task usage', () => {
    render(<ObserverOverheadCard overhead={{
      eventCount: 4,
      degraded: true, diagnostics: [{
        id: 'diagnostic:one', category: 'llm', observerRunId: 'semantic:one',
        code: 'observer-write-failed', occurredAt: '2026-07-21T00:00:01.000Z',
      }],
      totals: {
        cpuMs: 12, wallMs: 120, dbBytesDelta: 4096, inputTokens: 500,
        cachedInputTokens: 300, outputTokens: 50, reasoningTokens: 20,
        costUsd: null, sidecarMs: 35,
      },
      advisory: { shown: 2, adopted: 1, ignored: 0, dismissed: 0 },
      byCategory: [{ category: 'llm', eventCount: 1, wallMs: 100 }],
      recentEvents: [],
    }} />);

    expect(screen.getByRole('heading', { name: 'Observer overhead' })).toBeInTheDocument();
    expect(screen.getByText(/observer-only; excluded from task usage and scorecards/i)).toBeInTheDocument();
    expect(screen.getByText(/observer accounting degraded · llm:observer-write-failed/i)).toBeInTheDocument();
    expect(screen.getByText('550 tokens')).toBeInTheDocument();
    expect(screen.getByText('Cost unknown')).toBeInTheDocument();
    expect(screen.getByText('4.0 KB DB growth')).toBeInTheDocument();
    expect(screen.getByText('2 shown · 1 adopted')).toBeInTheDocument();
  });

  it('shows unknown LLM usage and drilldown by category, event, and evidence', () => {
    render(<ObserverOverheadCard overhead={{
      eventCount: 1,
      degraded: false, diagnostics: [],
      totals: {
        cpuMs: 0, wallMs: 40, dbBytesDelta: 0, inputTokens: null,
        cachedInputTokens: null, outputTokens: null, reasoningTokens: null,
        costUsd: null, sidecarMs: 0,
      },
      advisory: { shown: 0, adopted: 0, ignored: 0, dismissed: 0 },
      byCategory: [{ category: 'llm', eventCount: 1, wallMs: 40 }],
      recentEvents: [{
        id: 'overhead:one', subjectKind: 'observer', category: 'llm',
        observerRunId: 'semantic:one', costUsd: null,
        evidenceRefs: ['semantic:one'], occurredAt: '2026-07-21T00:00:00.000Z',
      }],
    }} />);
    expect(screen.getByText('Token usage unknown')).toBeInTheDocument();
    expect(screen.getByText('LLM · 1 event · 40 ms')).toBeInTheDocument();
    expect(screen.getByText('semantic:one')).toBeInTheDocument();
    expect(screen.getByText(/evidence: semantic:one/i)).toBeInTheDocument();
  });
});
