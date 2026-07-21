import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ObserverOverheadSection } from './ObserverOverheadSection';

const api = vi.hoisted(() => ({ fetchObserverOverhead: vi.fn() }));
vi.mock('@/lib/api', () => api);

describe('ObserverOverheadSection', () => {
  it('shows a retryable error instead of silently hiding unavailable overhead', async () => {
    api.fetchObserverOverhead.mockRejectedValue(new Error('offline'));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><ObserverOverheadSection /></QueryClientProvider>);
    expect(await screen.findByText('Failed to load observer overhead')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });
});
