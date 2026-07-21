import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router';
import AdvicePage from './AdvicePage';

const api = vi.hoisted(() => ({
  fetchAdvice: vi.fn(), recordAdviceEvent: vi.fn(),
  setAdviceMute: vi.fn(), clearAdviceMute: vi.fn(),
}));
vi.mock('@/lib/api', () => api);

beforeEach(() => {
  api.recordAdviceEvent.mockResolvedValue({
    recorded: true, degraded: false, interventionId: 'advisory-intervention:one',
  });
  api.setAdviceMute.mockResolvedValue(undefined);
  api.clearAdviceMute.mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><MemoryRouter><AdvicePage /></MemoryRouter></QueryClientProvider>);
}

describe('AdvicePage', () => {
  it('shows active and muted evidence, history, non-causal comparison, and attention cost', async () => {
    api.fetchAdvice.mockResolvedValue({
      status: 'ok', diagnostics: [],
      active: [{
        taskId: 'task:root', issueKey: 'pattern:validation-missing', sourceCategory: 'deterministic',
        triggerFact: 'Validation was not observed.', expectedBenefit: 'Earlier feedback may reduce rework.',
        confidence: 0.9, coverage: 0.8, evidenceRefs: ['event:one'],
        verification: 'Run the smallest relevant validation.', muted: false,
      }],
      muted: [{
        taskId: 'task:muted', issueKey: 'pattern:waiting', sourceCategory: 'deterministic',
        triggerFact: 'A tool call waited.', expectedBenefit: 'A narrower query may return sooner.',
        confidence: 0.75, coverage: 0.85, evidenceRefs: ['event:two'],
        verification: 'Compare the next similar task.', muted: true,
      }],
      history: {
        events: [{
          id: 'advisory-event:one', interventionId: 'advisory-intervention:one',
          issueKey: 'pattern:validation-missing', taskId: 'task:root',
          action: 'shown', outcome: null, observationEraId: 'era:one', coverage: 0.8,
          evidenceRefs: ['event:one'], occurredAt: '2026-07-21T00:00:00.000Z',
        }],
        comparisons: [{
          interventionId: 'advisory-intervention:one',
          issueKey: 'pattern:validation-missing', kind: 'observational-before-after', causal: false,
          baseline: { observationEraId: 'era:one', coverage: 0.8, occurredAt: '2026-07-21T00:00:00.000Z' },
          followup: { observationEraId: 'era:two', coverage: 0.9, outcome: 'improved', occurredAt: '2026-07-28T00:00:00.000Z' },
        }, {
          interventionId: 'advisory-intervention:two',
          issueKey: 'pattern:validation-missing', kind: 'observational-before-after', causal: false,
          baseline: { observationEraId: 'era:two', coverage: 0.9, occurredAt: '2026-08-01T00:00:00.000Z' },
          followup: { observationEraId: 'era:three', coverage: 0.7, outcome: 'not-improved', occurredAt: '2026-08-08T00:00:00.000Z' },
        }],
      },
      attention: { shown: 4, adopted: 2, ignored: 1, dismissed: 1 },
    });
    renderPage();

    expect(await screen.findByRole('heading', { name: 'Advice' })).toBeInTheDocument();
    expect(screen.getByText('Validation was not observed.')).toBeInTheDocument();
    expect(screen.getByText(/confidence 90% · coverage 80%/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'event:one' }))
      .toHaveAttribute('href', '/tasks/task%3Aroot#event-event%3Aone');
    expect(screen.getByText('Muted')).toBeInTheDocument();
    expect(screen.getAllByText(/observational before\/after only; no causal claim/i)).toHaveLength(2);
    expect(screen.getByText(/shown 4 · adopted 2 · ignored 1 · dismissed 1/i)).toBeInTheDocument();
    await waitFor(() => expect(api.recordAdviceEvent).toHaveBeenCalledWith({
      taskId: 'task:root', issueKey: 'pattern:validation-missing', action: 'shown',
    }));
    expect(api.recordAdviceEvent).not.toHaveBeenCalledWith(expect.objectContaining({ taskId: 'task:muted' }));
    fireEvent.click(screen.getByRole('button', { name: 'Mark adopted' }));
    await waitFor(() => expect(api.recordAdviceEvent).toHaveBeenCalledWith({
      taskId: 'task:root', issueKey: 'pattern:validation-missing', action: 'adopted',
      interventionId: 'advisory-intervention:one',
    }));

    fireEvent.click(screen.getByRole('button', { name: 'Mute issue' }));
    expect(api.setAdviceMute).toHaveBeenCalledWith({
      scopeKind: 'issue', scopeKey: 'pattern:validation-missing', mutedUntil: null,
    });
    fireEvent.click(screen.getByRole('button', { name: 'Unmute pattern:waiting' }));
    expect(api.clearAdviceMute).toHaveBeenCalledWith({ scopeKind: 'issue', scopeKey: 'pattern:waiting' });
  });

  it('shows a request failure instead of an empty advice state', async () => {
    api.fetchAdvice.mockRejectedValue(new Error('offline'));
    renderPage();

    expect(await screen.findByText('Failed to load advice')).toBeInTheDocument();
    expect(screen.queryByText('No active suggestions.')).not.toBeInTheDocument();
  });

  it('makes failed display accounting visible and retryable', async () => {
    api.fetchAdvice.mockResolvedValue({
      status: 'ok', diagnostics: [],
      active: [{
        taskId: 'task:retry', issueKey: 'pattern:waiting', sourceCategory: 'deterministic',
        triggerFact: 'A tool call waited.', expectedBenefit: 'A staged operation may return sooner.',
        confidence: 0.8, coverage: 0.9, evidenceRefs: ['event:retry'],
        verification: 'Compare the next task.', muted: false,
      }],
      muted: [], history: { events: [], comparisons: [] },
      attention: { shown: 0, adopted: 0, ignored: 0, dismissed: 0 },
    });
    api.recordAdviceEvent
      .mockResolvedValueOnce({ recorded: false, degraded: true })
      .mockRejectedValueOnce(new Error('offline'));
    renderPage();

    expect(await screen.findByText('Display not recorded: degraded')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry display accounting' }));
    expect(await screen.findByText('Display not recorded: unavailable')).toBeInTheDocument();
    expect(api.recordAdviceEvent).toHaveBeenCalledTimes(2);
  });
});
