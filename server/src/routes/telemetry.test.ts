import { vi, describe, it, expect, beforeEach } from 'vitest';

// ──────────────────────────────────────────────────────
// Module-scoped mutable mock functions for telemetry utils.
// ──────────────────────────────────────────────────────

const mockEnabled = vi.fn(() => true);
const mockGetId = vi.fn(() => 'test-device-id-hash');

vi.mock('@agent-analytics/cli/db/client', () => ({
  getDb: () => ({}),
  closeDb: () => {},
}));
vi.mock('@agent-analytics/cli/utils/telemetry', () => ({
  isTelemetryEnabled: (...args: unknown[]) => mockEnabled(...args),
  getStableMachineId: (...args: unknown[]) => mockGetId(...args),
  trackEvent: vi.fn(),
  captureError: vi.fn(),
}));
vi.mock('../llm/client.js', () => ({
  isLLMConfigured: () => false,
  createLLMClient: vi.fn(),
  loadLLMConfig: () => null,
}));

const { createApp } = await import('../index.js');

// ──────────────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────────────

describe('Telemetry routes', () => {
  beforeEach(() => {
    mockEnabled.mockReset();
    mockGetId.mockReset();
    mockEnabled.mockReturnValue(true);
    mockGetId.mockReturnValue('test-device-id-hash');
  });

  describe('GET /api/telemetry/identity', () => {
    it('returns enabled and distinct_id when telemetry is enabled', async () => {
      const app = createApp();
      const res = await app.request('/api/telemetry/identity');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual({ enabled: true, distinct_id: 'test-device-id-hash' });
    });

    it('returns enabled: false with no distinct_id when telemetry is disabled', async () => {
      mockEnabled.mockReturnValue(false);

      const app = createApp();
      const res = await app.request('/api/telemetry/identity');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual({ enabled: false });
      expect(body.distinct_id).toBeUndefined();
    });
  });
});
