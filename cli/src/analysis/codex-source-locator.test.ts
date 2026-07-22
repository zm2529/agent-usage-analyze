import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { locateCodexRollout } from './codex-source-locator.js';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function rollout(root: string, area: 'sessions' | 'archived_sessions', id: string, name = id): string {
  const directory = join(root, area, '2026', '07', '22');
  mkdirSync(directory, { recursive: true });
  const file = join(directory, `rollout-${name}.jsonl`);
  writeFileSync(file, `${JSON.stringify({ type: 'session_meta', payload: { id, cwd: '/repo' } })}\n`);
  return file;
}

describe('locateCodexRollout', () => {
  it('accepts a matching locator only inside supported Codex roots', () => {
    const home = mkdtempSync(join(tmpdir(), 'agent-analytics-locator-'));
    roots.push(home);
    const match = rollout(home, 'sessions', 'session-1');
    expect(locateCodexRollout({ codexHome: home, sessionId: 'session-1', locator: match }))
      .toMatchObject({ path: realpathSync(match), locatorAccepted: true, diagnostic: null });
  });

  it('rejects outside or mismatched locator hints and falls back by session id across archives', () => {
    const home = mkdtempSync(join(tmpdir(), 'agent-analytics-locator-'));
    const outside = mkdtempSync(join(tmpdir(), 'agent-analytics-outside-'));
    roots.push(home, outside);
    const expected = rollout(home, 'archived_sessions', 'wanted');
    const wrong = rollout(home, 'sessions', 'other');
    const outsideFile = rollout(outside, 'sessions', 'wanted');

    expect(locateCodexRollout({ codexHome: home, sessionId: 'wanted', locator: wrong }))
      .toMatchObject({ path: realpathSync(expected), locatorAccepted: false, diagnostic: 'locator-session-mismatch' });
    expect(locateCodexRollout({ codexHome: home, sessionId: 'wanted', locator: outsideFile }))
      .toMatchObject({ path: realpathSync(expected), locatorAccepted: false, diagnostic: 'locator-outside-supported-roots' });
  });

  it('returns an actionable diagnostic instead of reading an arbitrary or missing source', () => {
    const home = mkdtempSync(join(tmpdir(), 'agent-analytics-locator-'));
    roots.push(home);
    expect(locateCodexRollout({ codexHome: home, sessionId: 'missing', locator: '/etc/passwd' }))
      .toEqual({ path: null, locatorAccepted: false, diagnostic: 'source-not-found' });
  });
});
