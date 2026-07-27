import { cleanup, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BuildermarkGateState } from '@/lib/types';
import { BuildermarkGateCard, BuildermarkGateStatusCard } from './BuildermarkGateCard';

const api = vi.hoisted(() => ({ fetchBuildermarkGateState: vi.fn() }));
vi.mock('@/lib/api', () => api);

afterEach(cleanup);

function state(status: BuildermarkGateState['status'], candidateEnabled = false): BuildermarkGateState {
  return {
    status, candidateEnabled, latestRun: null,
    realGatePassed: candidateEnabled, syntheticGatePassed: candidateEnabled,
    stateError: null,
  };
}

describe('Buildermark gate status card', () => {
  it('renders disabled, testing, passed, and failed as explicit non-authoritative states', () => {
    const cases: Array<[BuildermarkGateState, string]> = [
      [state('disabled'), 'Disabled'],
      [state('testing'), 'Testing'],
      [state('passed', true), 'Passed'],
      [state('failed'), 'Failed'],
    ];
    for (const [gate, label] of cases) {
      const view = render(<BuildermarkGateStatusCard state={gate} />);
      expect(screen.getByText(label)).toBeInTheDocument();
      expect(screen.getByText(/candidates are provisional evidence, never certain ownership/i)).toBeInTheDocument();
      view.unmount();
    }
  });

  it('shows status unavailable without fabricating a helper failed run when the API cannot be read', async () => {
    api.fetchBuildermarkGateState.mockRejectedValue(new Error('database unavailable'));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><BuildermarkGateCard /></QueryClientProvider>);

    expect(await screen.findByText('Status unavailable')).toBeInTheDocument();
    expect(screen.getByText(/helper is treated as disabled until local state can be read/i)).toBeInTheDocument();
    expect(screen.queryByText('Failed')).not.toBeInTheDocument();
  });

  it('shows the integrity reason when a stored report is corrupt', () => {
    render(<BuildermarkGateStatusCard state={{
      ...state('failed'), stateError: 'corrupt-report',
    }} />);
    expect(screen.getByText(/stored gate report failed integrity validation/i)).toBeInTheDocument();
    expect(screen.getByText(/candidate use is disabled/i)).toBeInTheDocument();
  });
});
