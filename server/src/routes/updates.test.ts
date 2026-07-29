import { beforeEach, describe, expect, it, vi } from 'vitest';

const updateService = vi.hoisted(() => ({
  getStatus: vi.fn(),
  checkForUpdates: vi.fn(),
  setAutoUpdate: vi.fn(),
  requestUpdate: vi.fn(),
  startScheduler: vi.fn(() => ({ close: vi.fn() })),
}));

vi.mock('agent-usage-analyze/utils/update-service', () => ({
  getProductUpdateService: () => updateService,
}));

const { createApp } = await import('../index.js');

const status = {
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

describe('product update routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    updateService.getStatus.mockResolvedValue(status);
    updateService.checkForUpdates.mockResolvedValue(status);
    updateService.setAutoUpdate.mockResolvedValue({ ...status, autoUpdate: true });
    updateService.requestUpdate.mockResolvedValue({
      accepted: true,
      status: { ...status, updating: true },
    });
  });

  it('returns update status and performs a manual registry check', async () => {
    const app = createApp();
    expect(await (await app.request('/api/updates/status')).json()).toEqual(status);
    const response = await app.request('/api/updates/check', { method: 'POST' });
    expect(response.status).toBe(200);
    expect(updateService.checkForUpdates).toHaveBeenCalledOnce();
  });

  it('validates and saves the automatic update setting', async () => {
    const app = createApp();
    const invalid = await app.request('/api/updates/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ autoUpdate: 'yes' }),
    });
    expect(invalid.status).toBe(400);

    const response = await app.request('/api/updates/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ autoUpdate: true }),
    });
    expect(response.status).toBe(200);
    expect(updateService.setAutoUpdate).toHaveBeenCalledWith(true);
  });

  it('starts installation asynchronously and returns accepted', async () => {
    const response = await createApp().request('/api/updates/apply', { method: 'POST' });
    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({
      accepted: true,
      status: { updating: true },
    });
  });

  it('keeps registry failures visible as a status response', async () => {
    updateService.checkForUpdates.mockRejectedValueOnce(new Error('registry offline'));
    const response = await createApp().request('/api/updates/check', { method: 'POST' });
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({
      error: 'registry offline',
      status,
    });
  });
});
