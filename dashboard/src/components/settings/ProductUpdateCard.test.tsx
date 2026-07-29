import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProductUpdateStatus } from '@/lib/types';
import { ProductUpdateCard } from './ProductUpdateCard';

const api = vi.hoisted(() => ({
  fetchProductUpdateStatus: vi.fn(),
  checkForProductUpdates: vi.fn(),
  saveProductUpdateSettings: vi.fn(),
  applyProductUpdate: vi.fn(),
}));

vi.mock('@/lib/api', () => api);
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const baseStatus: ProductUpdateStatus = {
  packageName: 'agent-usage-analyze',
  currentVersion: '0.1.2',
  latestVersion: '0.2.0',
  pendingVersion: null,
  updateAvailable: true,
  checking: false,
  updating: false,
  autoUpdate: false,
  installationMode: 'npm-global',
  canUpdate: true,
  lastCheckedAt: '2026-07-29T12:00:00.000Z',
  lastUpdatedAt: null,
  restartRequired: false,
  error: null,
};

function renderCard() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <ProductUpdateCard />
    </QueryClientProvider>,
  );
}

describe('ProductUpdateCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.fetchProductUpdateStatus.mockResolvedValue(baseStatus);
    api.checkForProductUpdates.mockResolvedValue(baseStatus);
    api.saveProductUpdateSettings.mockResolvedValue({ ...baseStatus, autoUpdate: true });
    api.applyProductUpdate.mockResolvedValue({
      accepted: true,
      status: { ...baseStatus, updating: true },
    });
  });

  it('shows versions and exposes manual and automatic update controls for global npm installs', async () => {
    renderCard();

    expect(await screen.findByText('v0.1.2')).toBeInTheDocument();
    expect(screen.getByText('v0.2.0')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /check for updates/i }));
    await waitFor(() => expect(api.checkForProductUpdates).toHaveBeenCalledOnce());

    fireEvent.click(screen.getByRole('switch', { name: /update the app automatically/i }));
    await waitFor(() => expect(api.saveProductUpdateSettings.mock.calls[0]?.[0]).toBe(true));

    fireEvent.click(screen.getByRole('button', { name: /update now/i }));
    await waitFor(() => expect(api.applyProductUpdate).toHaveBeenCalledOnce());
  });

  it('keeps source checkouts read-only and explains how source updates work', async () => {
    api.fetchProductUpdateStatus.mockResolvedValue({
      ...baseStatus,
      installationMode: 'source',
      canUpdate: false,
    });
    renderCard();

    expect(await screen.findByText('Source checkout')).toBeInTheDocument();
    expect(screen.getByText(/will not rewrite a source checkout/i)).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: /update the app automatically/i })).toBeDisabled();
    expect(screen.queryByRole('button', { name: /update now/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /check for updates/i })).toBeEnabled();
  });

  it('reports that an installed update needs a restart without interrupting the page', async () => {
    api.fetchProductUpdateStatus.mockResolvedValue({
      ...baseStatus,
      latestVersion: '0.2.0',
      pendingVersion: '0.2.0',
      updateAvailable: false,
      restartRequired: true,
    });
    renderCard();

    expect(await screen.findByText(/v0.2.0 is installed and will be used after restart/i))
      .toBeInTheDocument();
    expect(screen.getByText(/will not be closed automatically/i)).toBeInTheDocument();
  });
});
