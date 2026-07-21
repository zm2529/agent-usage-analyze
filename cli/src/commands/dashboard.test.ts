import { describe, expect, it, vi } from 'vitest';
import { syncLegacyProjectionIfRequested } from './dashboard.js';

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
