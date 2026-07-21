import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import type { TaskDeliveryCandidate } from '@/lib/types';
import { DeliveryCandidateCard } from './DeliveryCandidateCard';

const candidate: TaskDeliveryCandidate = {
  id: 'candidate', taskId: 'task:1', algorithmVersion: 'task-delivery-v1',
  coverage: 1, confidence: 0.3, status: 'abstained',
  delivery: {
    id: 'delivery:1', kind: 'git-commit', repositoryIdentity: 'repository:sha256:test',
    resultIdentity: 'abc123', occurredAt: '2026-07-21T08:00:00.000Z', metadata: {},
  },
  evidence: [
    { id: 'supports', evidenceType: 'temporal-proximity', position: 'supports',
      sourceCategory: 'deterministic', algorithmVersion: 'task-delivery-v1', coverage: 1,
      confidence: 0.15, eraCompatibility: 'compatible', eraIds: ['era:1'], humanStatus: 'unreviewed',
      facts: [{ deliveryId: 'delivery:1', taskId: 'task:1', factRef: 'event:1' }] },
    { id: 'opposes', evidenceType: 'branch-mismatch', position: 'opposes',
      sourceCategory: 'deterministic', algorithmVersion: 'task-delivery-v1', coverage: 1,
      confidence: 0.1, eraCompatibility: 'compatible', eraIds: ['era:1'], humanStatus: 'unreviewed',
      facts: [{ deliveryId: 'delivery:1', taskId: 'task:1' }] },
  ],
};

describe('DeliveryCandidateCard', () => {
  it('shows abstention, confidence, and all evidence with two-way drill links', () => {
    render(<MemoryRouter><DeliveryCandidateCard candidate={candidate} showTaskLink showDeliveryLink /></MemoryRouter>);
    expect(screen.getByText('abstained')).toBeInTheDocument();
    expect(screen.getByText(/confidence 30%/)).toBeInTheDocument();
    expect(screen.getByText(/temporal-proximity · supports/)).toBeInTheDocument();
    expect(screen.getByText(/branch-mismatch · opposes/)).toBeInTheDocument();
    expect(screen.getAllByText(/compatible · era:1/)).toHaveLength(2);
    expect(screen.getAllByRole('link', { name: 'task:1' })[0]).toHaveAttribute('href', '/tasks/task%3A1');
    expect(screen.getByRole('link', { name: 'abc123' })).toHaveAttribute('href', '/deliveries/delivery%3A1');
    expect(screen.getByRole('link', { name: 'event:1' })).toHaveAttribute('href', '/tasks/task%3A1#event-event%3A1');
  });
});
