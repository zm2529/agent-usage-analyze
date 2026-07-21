import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router';
import { SemanticAnalysisPanel } from './SemanticAnalysisPanel';

const api = vi.hoisted(() => ({
  previewSemanticAnalysis: vi.fn(),
  runSemanticAnalysis: vi.fn(),
  fetchSemanticClaims: vi.fn(),
  recordAdvisoryOverhead: vi.fn(),
}));
vi.mock('@/lib/api', () => api);

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

beforeEach(() => {
  api.recordAdvisoryOverhead.mockResolvedValue({ recorded: true, degraded: false });
});

function renderPanel() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter><SemanticAnalysisPanel taskId="task-1" /></MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('SemanticAnalysisPanel', () => {
  it('shows disabled semantics without treating deterministic analysis as unavailable', async () => {
    api.previewSemanticAnalysis.mockResolvedValue({
      status: 'disabled', reason: 'not-enabled', deterministicAvailable: true,
    });
    api.fetchSemanticClaims.mockResolvedValue({ claims: [] });
    renderPanel();

    expect(await screen.findByText('Semantic analysis disabled')).toBeInTheDocument();
    expect(screen.getByText(/deterministic patterns remain available/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /settings/i })).toHaveAttribute('href', '/settings');
  });

  it('shows provider, evidence scope, estimated overhead, and LLM-semantic claim provenance', async () => {
    api.previewSemanticAnalysis.mockResolvedValue({
      status: 'ready', provider: 'ollama', model: 'qwen3:14b', locality: 'local',
      evidenceScope: { firstTurn: 'turn-2', lastTurn: 'turn-4', turnCount: 3, eventCount: 12 },
      inputCoverage: 0.75, estimatedInputTokens: 420, estimatedCostUsd: 0,
      deterministicAvailable: true,
    });
    api.fetchSemanticClaims.mockResolvedValue({ claims: [{
      id: 'claim-1', sourceCategory: 'llm-semantic', claimType: 'improvement-advice',
      title: 'Validate the first slice', summary: 'Validation was observed late.',
      expectedBenefit: 'Shorter feedback loops may reduce rework.',
      verification: 'Compare the next similar task.', confidence: 0.82,
      evidenceRefs: ['event-1'],
      run: {
        id: 'run-1', provider: 'ollama', model: 'qwen3:14b', locality: 'local',
        rubricVersion: 'semantic-rubric-v1', analysisVersion: 'semantic-analysis-v1',
        inputCoverage: 0.75, estimatedInputTokens: 420, inputTokens: 400,
        outputTokens: 50, costUsd: 0,
      },
    }] });
    renderPanel();

    expect(await screen.findByText(/ollama · qwen3:14b · local/i)).toBeInTheDocument();
    expect(screen.getByText(/turn-2 → turn-4 · 3 turns · 12 events · 75% coverage/i)).toBeInTheDocument();
    expect(screen.getByText(/estimated input 420 tokens · estimated cost \$0\.000000/i)).toBeInTheDocument();
    expect(screen.getByText('LLM-semantic')).toBeInTheDocument();
    expect(screen.getByText('Validate the first slice')).toBeInTheDocument();
    expect(screen.getByText(/semantic-rubric-v1 · semantic-analysis-v1/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'event-1' }))
      .toHaveAttribute('href', '/tasks/task-1#event-event-1');
    await waitFor(() => expect(api.recordAdvisoryOverhead).toHaveBeenCalledWith({
      claimId: 'claim-1', action: 'shown',
    }));
    fireEvent.click(screen.getByRole('button', { name: 'Mark adopted' }));
    await waitFor(() => expect(api.recordAdvisoryOverhead).toHaveBeenCalledWith({
      claimId: 'claim-1', action: 'adopted',
    }));
    expect(screen.getByText('Recorded: adopted')).toBeInTheDocument();
  });

  it('does not count stored advice as shown while semantic analysis is disabled', async () => {
    api.previewSemanticAnalysis.mockResolvedValue({
      status: 'disabled', reason: 'not-enabled', deterministicAvailable: true,
    });
    api.fetchSemanticClaims.mockResolvedValue({ claims: [{
      id: 'claim-disabled', claimType: 'improvement-advice',
    }] });
    renderPanel();

    expect(await screen.findByText('Semantic analysis disabled')).toBeInTheDocument();
    await waitFor(() => expect(api.fetchSemanticClaims).toHaveBeenCalled());
    expect(api.recordAdvisoryOverhead).not.toHaveBeenCalled();
  });

  it('shows failed advisory accounting and lets the user retry it', async () => {
    api.previewSemanticAnalysis.mockResolvedValue({
      status: 'ready', provider: 'ollama', model: 'qwen3:14b', locality: 'local',
      evidenceScope: { firstTurn: 'turn-2', lastTurn: 'turn-2', turnCount: 1, eventCount: 2 },
      inputCoverage: 1, estimatedInputTokens: 40, estimatedCostUsd: 0,
      deterministicAvailable: true,
    });
    api.fetchSemanticClaims.mockResolvedValue({ claims: [{
      id: 'claim-retry', sourceCategory: 'llm-semantic', claimType: 'improvement-advice',
      title: 'Retry advice', summary: 'Accounting can fail.', expectedBenefit: 'Honest telemetry.',
      verification: 'Inspect the overhead event.', confidence: 0.8, evidenceRefs: ['event-2'],
      run: {
        id: 'run-retry', provider: 'ollama', model: 'qwen3:14b', locality: 'local',
        rubricVersion: 'semantic-rubric-v1', analysisVersion: 'semantic-analysis-v1',
        inputCoverage: 1, estimatedInputTokens: 40, inputTokens: 40, outputTokens: 10, costUsd: 0,
      },
    }] });
    api.recordAdvisoryOverhead
      .mockResolvedValueOnce({ recorded: false, degraded: true })
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ recorded: false, degraded: true });
    renderPanel();

    expect(await screen.findByText('Display not recorded: degraded.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry display accounting' }));
    expect(await screen.findByText('Display not recorded: unavailable.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Mark adopted' }));
    expect(await screen.findByText('Not recorded: degraded')).toBeInTheDocument();
    expect(screen.queryByText('Recorded: degraded')).not.toBeInTheDocument();
    expect(api.recordAdvisoryOverhead).toHaveBeenNthCalledWith(1, { claimId: 'claim-retry', action: 'shown' });
    expect(api.recordAdvisoryOverhead).toHaveBeenNthCalledWith(2, { claimId: 'claim-retry', action: 'shown' });
    expect(api.recordAdvisoryOverhead).toHaveBeenNthCalledWith(3, { claimId: 'claim-retry', action: 'adopted' });
  });

  it('keeps deterministic analysis available when the semantic request fails', async () => {
    api.previewSemanticAnalysis.mockResolvedValue({
      status: 'ready', provider: 'ollama', model: 'qwen3:14b', locality: 'local',
      evidenceScope: { firstTurn: 'turn-1', lastTurn: 'turn-1', turnCount: 1, eventCount: 1 },
      inputCoverage: 1, estimatedInputTokens: 20, estimatedCostUsd: 0,
      deterministicAvailable: true,
    });
    api.fetchSemanticClaims.mockResolvedValue({ claims: [] });
    api.runSemanticAnalysis.mockRejectedValue(new Error('offline'));
    renderPanel();

    fireEvent.click(await screen.findByRole('button', { name: 'Run semantic analysis' }));
    expect(await screen.findByText(/semantic request failed/i)).toBeInTheDocument();
    expect(screen.getByText(/deterministic patterns remain available/i)).toBeInTheDocument();
  });
});
