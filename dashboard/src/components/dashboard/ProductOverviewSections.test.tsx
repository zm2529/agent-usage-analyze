import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { ActiveScorecardOverview, ProductOverviewSections } from './ProductOverviewSections';

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
    expect(screen.getByRole('link', { name: /open analysis and improvement tracking/i })).toHaveAttribute('href', '/analysis');
    expect(screen.getByText('72.5')).toBeInTheDocument();
  });
});
