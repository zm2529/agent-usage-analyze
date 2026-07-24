import { describe, expect, it, vi } from 'vitest';
import { CODEX_HOOK_MARKER } from '../utils/codex-hooks.js';
import { MAX_CODEX_HOOK_INPUT_BYTES, handleCodexStopInput } from './codex-stop.js';

const validInput = JSON.stringify({
  session_id: '019f878f-f1d4-74f2-ab39-2c2832b809a5',
  turn_id: '019f8790-1111-7222-8333-123456789abc',
  transcript_path: '/tmp/codex-session.jsonl',
  cwd: '/tmp/project',
  hook_event_name: 'Stop',
});

function dependencies(overrides: Record<string, unknown> = {}) {
  return {
    isRecursive: false,
    automaticEnabled: true,
    idleSeconds: 90,
    now: new Date('2026-07-22T03:00:00Z'),
    record: vi.fn(),
    spawnScheduler: vi.fn(),
    ...overrides,
  };
}

describe('Codex Stop hook entry point', () => {
  it('records only a valid managed Stop event and starts a detached scheduler', () => {
    const deps = dependencies();
    handleCodexStopInput(validInput, { managedHook: CODEX_HOOK_MARKER }, deps);

    expect(deps.record).toHaveBeenCalledWith({
      source: 'codex-cli',
      sessionId: '019f878f-f1d4-74f2-ab39-2c2832b809a5',
      turnId: '019f8790-1111-7222-8333-123456789abc',
      locator: '/tmp/codex-session.jsonl',
      basis: expect.stringMatching(/^hook-sha256:[a-f0-9]{64}$/),
    }, deps.now, 90);
    expect(deps.spawnScheduler).toHaveBeenCalledOnce();
  });

  it('records UserPromptSubmit so a new session is visible before Stop fires', () => {
    const deps = dependencies();
    const result = handleCodexStopInput(
      validInput.replace('"Stop"', '"UserPromptSubmit"'),
      { managedHook: CODEX_HOOK_MARKER },
      deps,
    );

    expect(result).toEqual({ status: 'recorded', reason: 'frontier-recorded' });
    expect(deps.record).toHaveBeenCalledOnce();
    expect(deps.spawnScheduler).toHaveBeenCalledOnce();
  });

  it.each([
    ['bad marker', validInput, 'somebody-else'],
    ['invalid json', '{', CODEX_HOOK_MARKER],
    ['wrong event', validInput.replace('Stop', 'SessionEnd'), CODEX_HOOK_MARKER],
    ['missing turn', JSON.stringify({ session_id: 's', hook_event_name: 'Stop' }), CODEX_HOOK_MARKER],
    ['relative cwd', validInput.replace('/tmp/project', 'relative/project'), CODEX_HOOK_MARKER],
    ['oversized', 'x'.repeat(MAX_CODEX_HOOK_INPUT_BYTES + 1), CODEX_HOOK_MARKER],
  ])('fails open for %s', (_label, input, marker) => {
    const deps = dependencies();
    expect(() => handleCodexStopInput(input, { managedHook: marker }, deps)).not.toThrow();
    expect(deps.record).not.toHaveBeenCalled();
    expect(deps.spawnScheduler).not.toHaveBeenCalled();
  });

  it('does nothing during recursive analysis and swallows storage failures', () => {
    const recursive = dependencies({ isRecursive: true });
    handleCodexStopInput(validInput, { managedHook: CODEX_HOOK_MARKER }, recursive);
    expect(recursive.record).not.toHaveBeenCalled();

    const failing = dependencies({ record: vi.fn(() => { throw new Error('disk unavailable'); }) });
    expect(() => handleCodexStopInput(validInput, { managedHook: CODEX_HOOK_MARKER }, failing)).not.toThrow();
    expect(failing.spawnScheduler).not.toHaveBeenCalled();
  });

  it('does not enqueue or start a worker when automatic analysis is off', () => {
    const deps = dependencies({ automaticEnabled: false });
    handleCodexStopInput(validInput, { managedHook: CODEX_HOOK_MARKER }, deps);
    expect(deps.record).not.toHaveBeenCalled();
    expect(deps.spawnScheduler).not.toHaveBeenCalled();
  });

  it('never writes hook protocol output', () => {
    const stdout = vi.spyOn(process.stdout, 'write');
    const stderr = vi.spyOn(process.stderr, 'write');
    handleCodexStopInput(validInput, { managedHook: CODEX_HOOK_MARKER }, dependencies());
    expect(stdout).not.toHaveBeenCalled();
    expect(stderr).not.toHaveBeenCalled();
    stdout.mockRestore();
    stderr.mockRestore();
  });
});
