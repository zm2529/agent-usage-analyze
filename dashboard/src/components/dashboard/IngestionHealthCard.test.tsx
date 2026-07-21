import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { IngestionHealthCard } from './IngestionHealthCard';

describe('IngestionHealthCard', () => {
  it('shows coverage before analytics', () => {
    render(
      <IngestionHealthCard
        health={{
          coverage: { discovered: 4, parsed: 3, skipped: 0, failed: 0, unknown: 1 },
          eventCount: 18,
          sourceCount: 4,
          eras: [{ id: 'era:history', mode: 'historical-backfill', parserVersion: 'codex-v1' }],
        }}
      />,
    );

    expect(screen.getByRole('heading', { name: 'Ingestion health' })).toBeInTheDocument();
    expect(screen.getByText('3 of 4 parsed')).toBeInTheDocument();
    expect(screen.getByText('1 unknown')).toBeInTheDocument();
    expect(screen.getByText('Historical backfill')).toBeInTheDocument();
    expect(screen.getByText('codex-v1')).toBeInTheDocument();
  });
});
