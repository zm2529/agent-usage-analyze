import { describe, expect, it } from 'vitest';
import { isTrustedHookState } from './codex-session-watcher.js';

describe('isTrustedHookState', () => {
  it('disables the fallback watcher after the managed Hook records an event', () => {
    expect(isTrustedHookState(
      { installed: true, stale: false, parseError: null },
      { status: 'recorded' },
    )).toBe(true);
  });

  it('keeps the fallback available while the Hook has not recorded an event', () => {
    expect(isTrustedHookState(
      { installed: true, stale: false, parseError: null },
      { status: 'failed' },
    )).toBe(false);
  });

  it('does not trust an outdated Hook installation', () => {
    expect(isTrustedHookState(
      { installed: true, stale: true, parseError: null },
      { status: 'recorded' },
    )).toBe(false);
  });
});
