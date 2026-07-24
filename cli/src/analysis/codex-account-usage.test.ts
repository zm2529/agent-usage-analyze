import { describe, expect, it } from 'vitest';
import { parseCodexAccountUsageResult } from './codex-account-usage.js';

describe('parseCodexAccountUsageResult', () => {
  it('normalizes the official multi-bucket response without exposing reset-credit details', () => {
    const usage = parseCodexAccountUsageResult({
      rateLimits: {},
      rateLimitsByLimitId: {
        codex: {
          limitId: 'codex', planType: 'pro',
          primary: { usedPercent: 27, windowDurationMins: 10_080, resetsAt: 1_800_000_000 },
          secondary: null,
          credits: { hasCredits: false, unlimited: false, balance: '0' },
          rateLimitReachedType: null,
        },
        spark: {
          limitId: 'spark', limitName: 'Spark',
          primary: { usedPercent: 3, windowDurationMins: 300, resetsAt: 1_800_000_100 },
        },
      },
      rateLimitResetCredits: {
        availableCount: 2,
        credits: [{ id: 'must-not-leak', description: 'must-not-leak', status: 'available', grantedAt: 1_700_000_000, expiresAt: 1_800_000_000 }],
      },
    }, new Date('2026-07-22T00:00:00.000Z'));

    expect(usage).toEqual({
      source: 'codex-app-server',
      observedAt: '2026-07-22T00:00:00.000Z',
      resetCreditsAvailable: 2,
      resetCredits: [{ grantedAt: 1_700_000_000, expiresAt: 1_800_000_000 }],
      rateLimits: [
        expect.objectContaining({ limitId: 'codex', planType: 'pro', primary: expect.objectContaining({ usedPercent: 27 }) }),
        expect.objectContaining({ limitId: 'spark', limitName: 'Spark', primary: expect.objectContaining({ usedPercent: 3 }) }),
      ],
    });
    expect(JSON.stringify(usage)).not.toContain('must-not-leak');
  });

  it('rejects responses with no valid rate-limit bucket', () => {
    expect(() => parseCodexAccountUsageResult({ rateLimitsByLimitId: {} }))
      .toThrow('codex-rate-limits-invalid-response');
  });
});
