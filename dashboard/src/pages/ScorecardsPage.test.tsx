import { cleanup, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router';
import ScorecardsPage from './ScorecardsPage';

const api = vi.hoisted(() => ({ fetchScorecards: vi.fn() }));
vi.mock('@/lib/api', () => api);

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><MemoryRouter><ScorecardsPage /></MemoryRouter></QueryClientProvider>);
}

describe('ScorecardsPage', () => {
  it('explains a calibrating version and unavailable result without showing an aggregate', async () => {
    api.fetchScorecards.mockResolvedValue({
      versions: [{
        id: 'scorecard:one', name: 'Personal delivery evidence', version: 'fixture-v1',
        definitionHash: 'abc', status: 'calibrating',
        features: [{ key: 'deliveryEvidence', label: 'Delivery evidence', weight: 1, requiresQualityGate: false }],
        qualityGates: ['delivery-observed'], safetyGates: ['no-unsafe-attribution'],
        missingRules: { deliveryEvidence: 'unavailable' }, thresholds: { minimumCoverage: 0.8 },
        calibrationDataVersion: 'calibration-v1', scope: { kind: 'personal' },
        evidenceRefs: ['evidence:definition'], createdAt: '2026-07-21T00:00:00.000Z',
      }],
      results: [{
        id: 'result:one', taskId: 'task:one', rootTaskId: 'task:one', scorecardVersionId: 'scorecard:one',
        rawFeatures: { deliveryEvidence: 0.8 },
        gateResults: { quality: true, safety: true, calibration: true },
        coverage: 1, uncertainty: 0.1, indexValue: null,
        unavailableReason: 'scorecard-not-active', evidenceRefs: ['event:task', 'evidence:task'],
        evidenceLinks: [{ ref: 'event:task', eventId: 'event:task', rootTaskId: 'task:one' }],
        createdAt: '2026-07-21T00:00:00.000Z',
      }],
    });
    renderPage();

    expect(screen.getByRole('heading', { name: 'Scorecards' })).toBeInTheDocument();
    expect(await screen.findByText('Calibrating')).toBeInTheDocument();
    expect(screen.getByText('No effective delivery index')).toBeInTheDocument();
    expect(screen.getByText(/scorecard is not active/i)).toBeInTheDocument();
    expect(screen.getByText('delivery-observed')).toBeInTheDocument();
    expect(screen.getByText((_, element) => element?.getAttribute('data-slot') === 'badge'
      && element.textContent?.includes('deliveryEvidence → unavailable') === true)).toBeInTheDocument();
    expect(screen.getByText('Quality passed')).toBeInTheDocument();
    expect(screen.getByText('Safety passed')).toBeInTheDocument();
    expect(screen.getByText('evidence:task (reference only)')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'event:task → event:task' }))
      .toHaveAttribute('href', '/tasks/task%3Aone#event-event%3Atask');
    expect(screen.getByText(/scope personal/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'task:one' })).toHaveAttribute('href', '/tasks/task%3Aone');
    expect(screen.queryByText(/81\.0/)).not.toBeInTheDocument();
  });

  it('shows a gated active result as a version-specific index', async () => {
    api.fetchScorecards.mockResolvedValue({
      versions: [{
        id: 'scorecard:active', name: 'Personal delivery evidence', version: 'active-v1',
        definitionHash: 'def', status: 'active',
        features: [{ key: 'deliveryEvidence', label: 'Delivery evidence', weight: 1, requiresQualityGate: false }],
        qualityGates: ['delivery-observed'], safetyGates: ['no-unsafe-attribution'],
        missingRules: { deliveryEvidence: 'unavailable' }, thresholds: { minimumCoverage: 0.8 },
        calibrationDataVersion: 'calibration-v1', scope: { kind: 'personal' },
        evidenceRefs: ['evidence:definition'], createdAt: '2026-07-21T00:00:00.000Z',
      }],
      results: [{
        id: 'result:active', taskId: 'task:active', rootTaskId: 'task:active', scorecardVersionId: 'scorecard:active',
        rawFeatures: { deliveryEvidence: 0.81 },
        gateResults: { quality: true, safety: true, calibration: true },
        coverage: 1, uncertainty: 0.1, indexValue: 81,
        unavailableReason: null, evidenceRefs: ['evidence:active'], evidenceLinks: [],
        createdAt: '2026-07-21T00:00:00.000Z',
      }],
    });
    renderPage();

    expect(await screen.findByText('81.0')).toBeInTheDocument();
    expect(screen.getByText(/active-v1 · quality, safety, coverage, and calibration gates passed/i)).toBeInTheDocument();
  });

  it('routes a child scorecard subject and its evidence through the root task detail', async () => {
    api.fetchScorecards.mockResolvedValue({
      versions: [],
      results: [{
        id: 'result:worker', taskId: 'task:worker', rootTaskId: 'task:root',
        scorecardVersionId: 'scorecard:worker', rawFeatures: { validationStrength: 0.9 },
        gateResults: { quality: true, safety: true, calibration: true },
        coverage: 1, uncertainty: 0.1, indexValue: 90, unavailableReason: null,
        evidenceRefs: ['event:worker'],
        evidenceLinks: [{ ref: 'event:worker', eventId: 'event:worker', rootTaskId: 'task:root' }],
        createdAt: '2026-07-21T00:00:00.000Z',
      }],
    });
    renderPage();

    expect(await screen.findByRole('link', { name: 'task:worker' }))
      .toHaveAttribute('href', '/tasks/task%3Aroot');
    expect(screen.getByRole('link', { name: 'event:worker → event:worker' }))
      .toHaveAttribute('href', '/tasks/task%3Aroot#event-event%3Aworker');
  });

  it('does not misreport a request failure as an empty scorecard set', async () => {
    api.fetchScorecards.mockRejectedValue(new Error('offline'));
    renderPage();
    expect(await screen.findByText('Failed to load scorecards')).toBeInTheDocument();
    expect(screen.queryByText('No scorecard versions yet.')).not.toBeInTheDocument();
  });
});
