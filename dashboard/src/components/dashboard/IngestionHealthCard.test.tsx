import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { IngestionHealthCard } from './IngestionHealthCard';

describe('IngestionHealthCard', () => {
  it('shows coverage before analytics', () => {
    render(
      <IngestionHealthCard
        health={{
          status: 'completed-with-errors',
          diagnostics: [{ severity: 'warning', code: 'unknown-envelope', count: 1 }],
          coverage: { discovered: 4, parsed: 3, skipped: 0, failed: 0, unknown: 1 },
          eventCount: 18,
          sourceCount: 4,
          processedSources: 4,
          startedAt: '2026-07-21T08:00:00.000Z',
          completedAt: '2026-07-21T08:01:00.000Z',
          eras: [{ id: 'era:history', mode: 'historical-backfill', parserVersion: 'codex-v1' }],
        }}
      />,
    );

    expect(screen.getByRole('heading', { name: 'Ingestion health' })).toBeInTheDocument();
    expect(screen.getByText('3 parsed events')).toBeInTheDocument();
    expect(screen.getByText('1 unmodeled protocol events')).toBeInTheDocument();
    expect(screen.getByText(/not failures and are excluded from scoring/i)).toBeInTheDocument();
    expect(screen.getByText('Historical backfill')).toBeInTheDocument();
    expect(screen.getByText('codex-v1')).toBeInTheDocument();
    expect(screen.getByText('Completed with errors')).toBeInTheDocument();
  });
});
