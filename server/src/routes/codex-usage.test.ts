import { describe, expect, it, vi } from 'vitest';
import { createCodexUsageRouter } from './codex-usage.js';

const snapshot = {
  source: 'codex-app-server' as const,
  observedAt: '2026-07-22T00:00:00.000Z',
  resetCreditsAvailable: 1,
  resetCredits: [{ grantedAt: 1_700_000_000, expiresAt: 1_800_000_000 }],
  rateLimits: [{
    limitId: 'codex', limitName: null, planType: 'pro',
    primary: { usedPercent: 27, windowDurationMins: 10_080, resetsAt: 1_800_000_000 },
    secondary: null,
    credits: { hasCredits: false, unlimited: false, balance: '0' },
    rateLimitReachedType: null,
  }],
};

describe('codex usage route', () => {
  it('returns and briefly caches the official app-server snapshot', async () => {
    const readUsage = vi.fn(async () => snapshot);
    const app = createCodexUsageRouter({ readUsage, now: () => 100 });

    expect(await (await app.request('/')).json()).toMatchObject({
      available: true, source: 'codex-app-server', resetCreditsAvailable: 1,
      resetCredits: [{ grantedAt: 1_700_000_000, expiresAt: 1_800_000_000 }],
    });
    expect(await (await app.request('/')).json()).toMatchObject({ available: true });
    expect(readUsage).toHaveBeenCalledOnce();
  });

  it('degrades explicitly when Codex usage is unavailable', async () => {
    const app = createCodexUsageRouter({
      readUsage: async () => { throw new Error('codex-cli-missing'); },
      now: () => 100,
    });
    expect(await (await app.request('/')).json()).toEqual({
      available: false, reason: 'codex-cli-missing',
    });
  });
});
