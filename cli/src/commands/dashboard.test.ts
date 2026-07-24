import { describe, expect, it, vi } from 'vitest';
import { isCodexAnalyticsDashboard, syncLegacyProjectionIfRequested } from './dashboard.js';

describe('dashboard legacy sync gate', () => {
  it('does not scan providers unless sync is explicitly enabled', async () => {
    const sync = vi.fn();

    await syncLegacyProjectionIfRequested(false, sync);
    await syncLegacyProjectionIfRequested(undefined, sync);

    expect(sync).not.toHaveBeenCalled();
  });

  it('runs the legacy projection only for explicit opt-in', async () => {
    const sync = vi.fn().mockResolvedValue(undefined);
    await syncLegacyProjectionIfRequested(true, sync);
    expect(sync).toHaveBeenCalledOnce();
  });
});

describe('dashboard reuse probe', () => {
  it('recognizes the local product health response', async () => {
    const request = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    await expect(isCodexAnalyticsDashboard(7890, request as typeof fetch)).resolves.toBe(true);
    expect(request).toHaveBeenCalledWith('http://127.0.0.1:7890/api/health', expect.objectContaining({ signal: expect.any(AbortSignal) }));
  });

  it('does not reuse an unrelated or unavailable service', async () => {
    const unrelated = vi.fn(async () => new Response('no', { status: 200 }));
    const unavailable = vi.fn(async () => { throw new Error('offline'); });
    await expect(isCodexAnalyticsDashboard(7890, unrelated as typeof fetch)).resolves.toBe(false);
    await expect(isCodexAnalyticsDashboard(7890, unavailable as typeof fetch)).resolves.toBe(false);
  });
});
