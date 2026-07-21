import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import DeliveriesPage from './DeliveriesPage';
import DeliveryDetailPage from './DeliveryDetailPage';

const api = vi.hoisted(() => ({
  fetchDeliveries: vi.fn(), discoverDeliveries: vi.fn(), recordTaskArtifact: vi.fn(),
  fetchDelivery: vi.fn(), appendDeliveryCorrection: vi.fn(),
}));
vi.mock('@/lib/api', () => api);

function client(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
}

beforeEach(() => {
  vi.clearAllMocks();
  api.fetchDeliveries.mockResolvedValue({ deliveries: [] });
});

describe('delivery page error states', () => {
  it('shows list, discovery, and artifact failures as user-visible non-destructive states', async () => {
    api.fetchDeliveries.mockRejectedValue(new Error('offline'));
    api.discoverDeliveries.mockRejectedValue(new Error('git failed'));
    api.recordTaskArtifact.mockRejectedValue(new Error('artifact failed'));
    render(<QueryClientProvider client={client()}><MemoryRouter><DeliveriesPage /></MemoryRouter></QueryClientProvider>);

    expect(await screen.findByText('Delivery list is unavailable.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Discover local results' }));
    expect(await screen.findByText(/Local discovery failed/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Task ID'), { target: { value: 'task' } });
    fireEvent.change(screen.getByLabelText('Artifact path'), { target: { value: 'build/app.bundle' } });
    fireEvent.click(screen.getByRole('button', { name: 'Record local artifact' }));
    expect(await screen.findByText(/artifact could not be recorded/)).toBeInTheDocument();
  });

  it('does not misreport a failed detail request as a missing delivery', async () => {
    api.fetchDelivery.mockRejectedValue(new Error('database unavailable'));
    render(<QueryClientProvider client={client()}><MemoryRouter initialEntries={['/deliveries/delivery']}><Routes>
      <Route path="/deliveries/:id" element={<DeliveryDetailPage />} />
    </Routes></MemoryRouter></QueryClientProvider>);
    expect(await screen.findByText('Delivery evidence is unavailable.')).toBeInTheDocument();
    expect(screen.queryByText('Delivery not found.')).not.toBeInTheDocument();
  });

  it('shows a failed correction without replacing the visible evidence', async () => {
    api.fetchDelivery.mockResolvedValue({ delivery: {
      id: 'delivery', kind: 'git-commit', repositoryIdentity: 'repository', resultIdentity: 'abc',
      occurredAt: '2026-07-21T08:00:00.000Z', metadata: {}, candidates: [{
        id: 'candidate', taskId: 'task', algorithmVersion: 'task-delivery-v1', coverage: 0.8,
        confidence: 0.2, status: 'abstained', delivery: {
          id: 'delivery', kind: 'git-commit', repositoryIdentity: 'repository', resultIdentity: 'abc',
          occurredAt: '2026-07-21T08:00:00.000Z', metadata: {},
        }, evidence: [{
          id: 'evidence', evidenceType: 'temporal-proximity', position: 'supports',
          sourceCategory: 'deterministic', algorithmVersion: 'task-delivery-v1', coverage: 0.8,
          confidence: 0.1, eraCompatibility: 'compatible', eraIds: ['era'], humanStatus: 'unreviewed',
          facts: [{ deliveryId: 'delivery', taskId: 'task' }],
        }],
      }],
    } });
    api.appendDeliveryCorrection.mockRejectedValue(new Error('write failed'));
    render(<QueryClientProvider client={client()}><MemoryRouter initialEntries={['/deliveries/delivery']}><Routes>
      <Route path="/deliveries/:id" element={<DeliveryDetailPage />} />
    </Routes></MemoryRouter></QueryClientProvider>);
    expect(await screen.findByText('temporal-proximity · supports · deterministic · 10%')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'confirmed' }));
    expect(await screen.findByText(/correction could not be appended/)).toBeInTheDocument();
    expect(screen.getByText('abstained')).toBeInTheDocument();
  });
});
