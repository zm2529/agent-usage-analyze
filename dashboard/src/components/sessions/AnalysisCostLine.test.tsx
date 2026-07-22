import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AnalysisCostLine } from './AnalysisCostLine';

vi.mock('@/hooks/useAnalysisCost', () => ({
  useAnalysisCost: () => ({
    data: {
      totalCostUsd: 0,
      cacheSavingsUsd: 0,
      usage: [{
        session_id: 'codex:one', analysis_type: 'session', provider: 'codex-native',
        model: 'codex-default', input_tokens: 100, output_tokens: 20,
        cache_creation_tokens: 0, cache_read_tokens: 60, estimated_cost_usd: 0,
        duration_ms: 1500, chunk_count: 1, analyzed_at: '2026-07-22T00:00:00Z',
      }],
    },
  }),
}));

describe('AnalysisCostLine', () => {
  it('labels Codex subscription usage as unknown cost instead of free', () => {
    render(<AnalysisCostLine sessionId="codex:one" isAnalyzing={false} />);
    expect(screen.getByText(/analyzed via codex subscription/i)).toBeInTheDocument();
    expect(screen.getByText(/api-equivalent cost unknown/i)).toBeInTheDocument();
    expect(screen.queryByText(/free/i)).not.toBeInTheDocument();
  });
});
