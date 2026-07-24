import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { ActiveScorecardOverview, ProductOverviewSections } from './ProductOverviewSections';

vi.mock('@/hooks/useAdvice', () => ({ useAdvice: () => ({ data: {
  status: 'ok', active: [{
    taskId: 'task:one', issueKey: 'pattern:validation', sourceCategory: 'deterministic',
    triggerFact: 'Validation evidence was not observed.', expectedBenefit: 'Add a focused check.',
    confidence: 0.8, coverage: 0.9, evidenceRefs: ['event:one'], verification: 'Observe next task.',
    muted: false,
  }], muted: [], history: { events: [], comparisons: [] },
  attention: { shown: 0, adopted: 0, ignored: 0, dismissed: 0 }, diagnostics: [],
}, isLoading: false, isError: false }) }));
vi.mock('@/hooks/useScorecards', () => ({ useScorecards: () => ({ data: {
  versions: [{ id: 'score:v1', name: 'Personal delivery', version: 'v1', status: 'active' }],
  results: [{ id: 'result:one', indexValue: 72.5, scorecardVersionId: 'score:v1', rootTaskId: 'task:one' }],
}, isLoading: false, isError: false }) }));
vi.mock('@/hooks/useConfig', () => ({ useLlmConfig: () => ({ data: { analysis: {
  effectiveRunner: 'codex-native', authentication: 'chatgpt',
} } }) }));

describe('ProductOverviewSections', () => {
  it('keeps local-rule advice out of the overview and links to LLM behavior analysis', () => {
    render(<MemoryRouter><ProductOverviewSections /><h2>Observer overhead</h2><ActiveScorecardOverview /></MemoryRouter>);
    const headings = screen.getAllByRole('heading').map((heading) => heading.textContent);
    expect(headings).toEqual(['Behavior analysis', 'Observer overhead', 'Active scorecard']);
    expect(screen.queryByText('Validation evidence was not observed.')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /open analysis and advice/i })).toHaveAttribute('href', '/improve');
    expect(screen.getByText('72.5')).toBeInTheDocument();
  });
});
