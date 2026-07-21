import { cleanup, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GitAiSidecarState } from '@/lib/types';
import { GitAiSidecarCard, GitAiSidecarStatusCard } from './GitAiSidecarCard';

const api = vi.hoisted(() => ({ fetchGitAiSidecarState: vi.fn() }));
vi.mock('@/lib/api', () => api);

afterEach(cleanup);

function state(status: GitAiSidecarState['status']): GitAiSidecarState {
  return {
    status, gatePassed: status === 'passed', configured: true, configuredEnabled: true,
    binaryHealthy: true, binaryVersion: '1.6.16',
    consumptionEnabled: status === 'passed', sourceVersion: '1.6.16',
    sourceCommit: 'da79071f21f3b018aa7d4ee4e7d5fa8bf3555a88',
    notesSchema: 'authorship/3.0.0', notesExportPolicy: 'local-only',
    automaticRepositoryMutation: false, latestRun: null, stateError: null,
  };
}

describe('Git AI sidecar status card', () => {
  it('shows every gate state, fixed version, local Notes policy, and non-quality provenance copy', () => {
    for (const [status, label] of [
      ['disabled', 'Disabled'], ['testing', 'Testing'], ['passed', 'Passed'], ['failed', 'Failed'],
    ] as const) {
      const view = render(<GitAiSidecarStatusCard state={state(status)} />);
      expect(screen.getByText(label)).toBeInTheDocument();
      expect(screen.getAllByText(/1\.6\.16/).length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText(/local-only/)).toBeInTheDocument();
      expect(screen.getByText(/provenance is candidate evidence, never a quality score/i)).toBeInTheDocument();
      expect(screen.getByText(/does not install hooks or push notes/i)).toBeInTheDocument();
      view.unmount();
    }
  });

  it('shows binary health and corrupt configuration without enabling consumption', () => {
    render(<GitAiSidecarStatusCard state={{
      ...state('passed'), binaryHealthy: false, binaryVersion: null,
      consumptionEnabled: false, stateError: 'corrupt-config',
    }} />);

    expect(screen.getByText(/binary health:/i)).toHaveTextContent(/unknown or failed/i);
    expect(screen.getByText(/configuration is corrupt/i)).toHaveTextContent(/consumption is disabled/i);
  });

  it('renders supported, limited, and abstained matrix rows without hiding uncertainty', () => {
    render(<GitAiSidecarStatusCard state={{
      ...state('passed'),
      latestRun: {
        id: 'gate', status: 'passed', sourceVersion: '1.6.16',
        sourceCommit: 'da79071f21f3b018aa7d4ee4e7d5fa8bf3555a88',
        notesSchema: 'authorship/3.0.0', notesExportPolicy: 'local-explicit',
        candidateEvidence: 5, abstentions: 4, failureCodes: [],
        scenarios: [
          { kind: 'clean', support: 'supported', outcome: 'candidate', reason: null },
          { kind: 'partial-stage', support: 'limited', outcome: 'candidate', reason: 'uncommitted-changes-excluded' },
          { kind: 'pre-existing-dirty', support: 'abstained', outcome: 'abstained', reason: 'pre-existing-dirty' },
        ],
        completedAt: '2026-07-21T00:00:00.000Z', reportHash: 'sha256:opaque',
      },
    }} />);

    expect(screen.getByText(/clean · supported · candidate/i)).toBeInTheDocument();
    expect(screen.getByText(/partial-stage · limited · candidate/i)).toBeInTheDocument();
    expect(screen.getByText(/pre-existing-dirty · abstained · abstained/i)).toBeInTheDocument();
  });

  it('shows unavailable rather than fabricating a failed sidecar when the API cannot be read', async () => {
    api.fetchGitAiSidecarState.mockRejectedValue(new Error('database unavailable'));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><GitAiSidecarCard /></QueryClientProvider>);

    expect(await screen.findByText('Status unavailable')).toBeInTheDocument();
    expect(screen.queryByText('Failed')).not.toBeInTheDocument();
  });
});
