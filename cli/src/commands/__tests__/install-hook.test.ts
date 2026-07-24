import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('../../utils/telemetry.js', () => ({
  trackEvent: vi.fn(),
  captureError: vi.fn(),
  classifyError: vi.fn(() => ({ error_type: 'unknown', error_message: 'unknown' })),
}));

// Mock os module so homedir() returns our temp dir.
// Uses a mutable object (not a `let`) because vi.mock factories are hoisted before
// variable declarations — a plain object property is safe to read at any point.
const _mockOs = { homeDir: '' };

vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof os>();
  return {
    ...actual,
    homedir: () => _mockOs.homeDir,
  };
});

// ── Setup: isolated temp home dir per test ────────────────────────────────────

let mockHomeDir: string;

beforeEach(() => {
  // Each test gets its own temp dir as home — never touches real ~/.claude/settings.json
  mockHomeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ci-hook-test-'));
  _mockOs.homeDir = mockHomeDir;
  // Reset module cache so CLAUDE_SETTINGS_DIR / HOOKS_FILE pick up the new mockHomeDir
  vi.resetModules();
});

afterEach(() => {
  fs.rmSync(mockHomeDir, { recursive: true, force: true });
  vi.clearAllMocks();
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function hooksFile(): string {
  return path.join(mockHomeDir, '.claude', 'settings.json');
}

function readSettings(): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(hooksFile(), 'utf-8'));
}

function writeSettings(data: unknown): void {
  const dir = path.join(mockHomeDir, '.claude');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(hooksFile(), JSON.stringify(data));
}

function codexHooksFile(): string {
  return path.join(mockHomeDir, '.codex', 'hooks.json');
}

function writeCodexHooks(data: unknown): void {
  fs.mkdirSync(path.dirname(codexHooksFile()), { recursive: true });
  fs.writeFileSync(codexHooksFile(), JSON.stringify(data));
}

function readCodexHooks(): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(codexHooksFile(), 'utf8'));
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('installHookCommand', () => {
  describe('default install', () => {
    it('installs a single SessionEnd hook (no Stop hook)', async () => {
      const { installHookCommand } = await import('../install-hook.js');
      await installHookCommand();

      const settings = readSettings();
      const hooks = settings.hooks as Record<string, unknown[]>;

      expect(hooks).toBeDefined();
      // v4.9+: only SessionEnd hook, no Stop hook
      expect(hooks.Stop).toBeUndefined();
      expect(Array.isArray(hooks.SessionEnd)).toBe(true);
      expect(hooks.SessionEnd).toHaveLength(1);
    });

    it('SessionEnd hook runs session-end command with 10s timeout', async () => {
      const { installHookCommand } = await import('../install-hook.js');
      await installHookCommand();

      const settings = readSettings();
      const hooks = settings.hooks as Record<string, Array<{ hooks: Array<{ type: string; command: string; timeout?: number }> }>>;
      const sessionEndCmd = hooks.SessionEnd[0].hooks[0];

      expect(sessionEndCmd.type).toBe('command');
      expect(sessionEndCmd.command).toContain('session-end --native -q');
      // Must use node + absolute path (not process.argv[1] which is unstable under npx)
      expect(sessionEndCmd.command).toMatch(/^node .+index\.js session-end --native -q$/);
      // 10s timeout — session-end exits immediately after spawning the worker
      expect(sessionEndCmd.timeout).toBe(10000);
    });

    it('preserves existing settings.json content', async () => {
      writeSettings({ theme: 'dark', someOtherKey: 42 });

      const { installHookCommand } = await import('../install-hook.js');
      await installHookCommand();

      const settings = readSettings();
      expect(settings.theme).toBe('dark');
      expect(settings.someOtherKey).toBe(42);
    });

    it('preserves existing non-agent-usage-analyze SessionEnd hooks', async () => {
      writeSettings({
        hooks: {
          SessionEnd: [{ hooks: [{ type: 'command', command: 'other-tool end-session' }] }],
        },
      });

      const { installHookCommand } = await import('../install-hook.js');
      await installHookCommand();

      const settings = readSettings();
      const hooks = settings.hooks as Record<string, unknown[]>;
      // Should have 2 SessionEnd hooks: the existing one + our new one
      expect(hooks.SessionEnd).toHaveLength(2);
    });

    it('does not duplicate hook when installed twice', async () => {
      const { installHookCommand } = await import('../install-hook.js');
      await installHookCommand();
      vi.resetModules();
      const { installHookCommand: installHookCommand2 } = await import('../install-hook.js');
      await installHookCommand2();

      const settings = readSettings();
      const hooks = settings.hooks as Record<string, unknown[]>;
      // Second install must be idempotent — still exactly one agent-usage-analyze hook
      expect(hooks.SessionEnd).toHaveLength(1);
    });
  });

  describe('v4.8.x migration', () => {
    it('removes legacy Stop hook on install', async () => {
      writeSettings({
        hooks: {
          Stop: [{ hooks: [{ type: 'command', command: 'node /path/agent-usage-analyze sync -q' }] }],
        },
      });

      const { installHookCommand } = await import('../install-hook.js');
      await installHookCommand();

      const settings = readSettings();
      const hooks = settings.hooks as Record<string, unknown[]>;
      // Legacy Stop hook removed; only our new SessionEnd hook remains
      expect(hooks.Stop).toBeUndefined();
      expect(hooks.SessionEnd).toHaveLength(1);
    });

    it('preserves non-agent-usage-analyze Stop hooks during migration', async () => {
      writeSettings({
        hooks: {
          Stop: [
            { hooks: [{ type: 'command', command: 'other-tool cleanup' }] },
            { hooks: [{ type: 'command', command: 'node /path/agent-usage-analyze sync -q' }] },
          ],
        },
      });

      const { installHookCommand } = await import('../install-hook.js');
      await installHookCommand();

      const settings = readSettings();
      const hooks = settings.hooks as Record<string, unknown[]>;
      // Our agent-usage-analyze Stop hook removed; non-agent-usage-analyze one preserved
      expect(hooks.Stop).toHaveLength(1);
      const remaining = hooks.Stop[0] as { hooks: Array<{ command: string }> };
      expect(remaining.hooks[0].command).toBe('other-tool cleanup');
    });
  });
});

describe('Codex hook lifecycle', () => {
  it('preserves existing hooks and installs one synchronous Stop handler', async () => {
    writeCodexHooks({
      description: 'user hooks', unknown: { keep: true },
      hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'other-tool start' }] }] },
    });
    const { installHookCommand } = await import('../install-hook.js');
    await installHookCommand({ source: 'codex' });

    const config = readCodexHooks() as { description: string; unknown: unknown; hooks: Record<string, Array<{ matcher?: string; hooks: Array<Record<string, unknown>> }>> };
    expect(config.description).toBe('user hooks');
    expect(config.unknown).toEqual({ keep: true });
    expect(config.hooks.SessionStart).toHaveLength(1);
    expect(config.hooks.Stop).toHaveLength(1);
    expect(config.hooks.Stop[0].matcher).toBeUndefined();
    expect(config.hooks.Stop[0].hooks[0]).toMatchObject({ type: 'command', timeout: 8 });
    expect(config.hooks.Stop[0].hooks[0].command).toMatch(/^node ".+index\.js" codex-stop -q --managed-hook agent-analytics-v1$/);
  });

  it('backs up with private permissions and remains idempotent', async () => {
    writeCodexHooks({ hooks: {} });
    const { installHookCommand } = await import('../install-hook.js');
    await installHookCommand({ source: 'codex' });
    await installHookCommand({ source: 'codex' });
    const backups = fs.readdirSync(path.dirname(codexHooksFile())).filter((name) => name.includes('agent-analytics') && name.endsWith('.bak'));
    expect(backups.length).toBeGreaterThanOrEqual(1);
    expect(fs.statSync(path.join(path.dirname(codexHooksFile()), backups[0])).mode & 0o777).toBe(0o600);
    const config = readCodexHooks() as { hooks: { Stop: unknown[] } };
    expect(config.hooks.Stop).toHaveLength(1);
  });

  it('fails closed on malformed JSON', async () => {
    fs.mkdirSync(path.dirname(codexHooksFile()), { recursive: true });
    fs.writeFileSync(codexHooksFile(), '{ malformed');
    const before = fs.readFileSync(codexHooksFile(), 'utf8');
    const { installHookCommand } = await import('../install-hook.js');
    await expect(installHookCommand({ source: 'codex' })).rejects.toThrow(/parse/i);
    expect(fs.readFileSync(codexHooksFile(), 'utf8')).toBe(before);
  });

  it('uninstalls only the managed Codex handler', async () => {
    writeCodexHooks({ hooks: { Stop: [
      { hooks: [{ type: 'command', command: 'other-tool stop' }] },
      { hooks: [{ type: 'command', command: 'node "/tool/index.js" codex-stop -q --managed-hook agent-analytics-v1' }] },
    ] } });
    const { uninstallHookCommand } = await import('../install-hook.js');
    await uninstallHookCommand({ source: 'codex' });
    const config = readCodexHooks() as { hooks: { Stop: Array<{ hooks: Array<{ command: string }> }> } };
    expect(config.hooks.Stop).toHaveLength(1);
    expect(config.hooks.Stop[0].hooks[0].command).toBe('other-tool stop');
  });

  it('does not remove a similar unmarked command', async () => {
    writeCodexHooks({ hooks: { Stop: [
      { hooks: [{ type: 'command', command: 'node "/other/index.js" codex-stop -q' }] },
    ] } });
    const { uninstallHookCommand } = await import('../install-hook.js');
    await uninstallHookCommand({ source: 'codex' });
    const config = readCodexHooks() as { hooks: { Stop: unknown[] } };
    expect(config.hooks.Stop).toHaveLength(1);
  });

  it('replaces a stale managed binary path with the current absolute entry', async () => {
    writeCodexHooks({ hooks: { Stop: [
      { hooks: [{ type: 'command', command: 'node "/old/index.js" codex-stop -q --managed-hook agent-analytics-v1' }] },
    ] } });
    const { installHookCommand } = await import('../install-hook.js');
    await installHookCommand({ source: 'codex' });
    const config = readCodexHooks() as { hooks: { Stop: Array<{ hooks: Array<{ command: string }> }> } };
    expect(config.hooks.Stop).toHaveLength(1);
    expect(config.hooks.Stop[0].hooks[0].command).not.toContain('/old/index.js');
  });

  it('preserves unowned handlers that share a group with the managed handler', async () => {
    writeCodexHooks({ hooks: { Stop: [{ statusMessage: 'mixed', hooks: [
      { type: 'command', command: 'other-tool stop' },
      { type: 'command', command: 'node "/tool/index.js" codex-stop -q --managed-hook agent-analytics-v1' },
    ] }] } });
    const { uninstallHookCommand } = await import('../install-hook.js');
    await uninstallHookCommand({ source: 'codex' });
    const config = readCodexHooks() as { hooks: { Stop: Array<{ statusMessage: string; hooks: Array<{ command: string }> }> } };
    expect(config.hooks.Stop).toEqual([{ statusMessage: 'mixed', hooks: [{ type: 'command', command: 'other-tool stop' }] }]);
  });

  it('normalizes current plus stale managed handlers to exactly one current handler', async () => {
    const { codexHookCommand } = await import('../../utils/codex-hooks.js');
    writeCodexHooks({ hooks: { Stop: [
      { hooks: [{ type: 'command', command: codexHookCommand() }] },
      { hooks: [{ type: 'command', command: 'node "/old/index.js" codex-stop -q --managed-hook agent-analytics-v1' }] },
    ] } });
    const { installHookCommand } = await import('../install-hook.js');
    await installHookCommand({ source: 'codex' });
    const config = readCodexHooks() as { hooks: { Stop: Array<{ hooks: Array<{ command: string }> }> } };
    const commands = config.hooks.Stop.flatMap((group) => group.hooks.map((hook) => hook.command));
    expect(commands.filter((command) => command.includes('--managed-hook agent-analytics-v1'))).toEqual([codexHookCommand()]);
  });
});

describe('uninstallHookCommand', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('removes v4.9+ SessionEnd session-end hook', async () => {
    writeSettings({
      hooks: {
        SessionEnd: [{ hooks: [{ type: 'command', command: 'node /path/agent-usage-analyze session-end --native -q', timeout: 10000 }] }],
      },
    });

    const { uninstallHookCommand } = await import('../install-hook.js');
    await uninstallHookCommand();

    const settings = readSettings();
    expect((settings.hooks as Record<string, unknown> | undefined)?.SessionEnd).toBeUndefined();
  });

  it('removes v4.8.x Stop and SessionEnd hooks (upgrade path)', async () => {
    writeSettings({
      hooks: {
        Stop: [{ hooks: [{ type: 'command', command: 'node /path/agent-usage-analyze sync -q' }] }],
        SessionEnd: [{ hooks: [{ type: 'command', command: 'node /path/agent-usage-analyze insights --hook --native -q', timeout: 300000 }] }],
      },
    });

    const { uninstallHookCommand } = await import('../install-hook.js');
    await uninstallHookCommand();

    const settings = readSettings();
    expect((settings.hooks as Record<string, unknown> | undefined)?.Stop).toBeUndefined();
    expect((settings.hooks as Record<string, unknown> | undefined)?.SessionEnd).toBeUndefined();
  });

  it('preserves non-agent-usage-analyze Stop hooks', async () => {
    writeSettings({
      hooks: {
        Stop: [
          { hooks: [{ type: 'command', command: 'other-tool cleanup' }] },
          { hooks: [{ type: 'command', command: 'node /path/agent-usage-analyze sync -q' }] },
        ],
      },
    });

    const { uninstallHookCommand } = await import('../install-hook.js');
    await uninstallHookCommand();

    const settings = readSettings();
    const hooks = settings.hooks as Record<string, unknown[]>;
    expect(hooks.Stop).toHaveLength(1);
    const remaining = hooks.Stop[0] as { hooks: Array<{ command: string }> };
    expect(remaining.hooks[0].command).toBe('other-tool cleanup');
  });

  it('preserves non-agent-usage-analyze SessionEnd hooks', async () => {
    writeSettings({
      hooks: {
        SessionEnd: [
          { hooks: [{ type: 'command', command: 'other-tool end-session' }] },
          { hooks: [{ type: 'command', command: 'node /path/agent-usage-analyze session-end --native -q', timeout: 10000 }] },
        ],
      },
    });

    const { uninstallHookCommand } = await import('../install-hook.js');
    await uninstallHookCommand();

    const settings = readSettings();
    const hooks = settings.hooks as Record<string, unknown[]>;
    expect(hooks.SessionEnd).toHaveLength(1);
    const remaining = hooks.SessionEnd[0] as { hooks: Array<{ command: string }> };
    expect(remaining.hooks[0].command).toBe('other-tool end-session');
  });

  it('handles missing settings.json gracefully', async () => {
    const { uninstallHookCommand } = await import('../install-hook.js');
    await expect(uninstallHookCommand()).resolves.toBeUndefined();
  });

  it('cleans up empty hooks object after removal', async () => {
    writeSettings({
      hooks: {
        Stop: [{ hooks: [{ type: 'command', command: 'node /path/agent-usage-analyze sync -q' }] }],
        SessionEnd: [{ hooks: [{ type: 'command', command: 'node /path/agent-usage-analyze session-end --native -q', timeout: 10000 }] }],
      },
    });

    const { uninstallHookCommand } = await import('../install-hook.js');
    await uninstallHookCommand();

    const settings = readSettings();
    expect(settings.hooks).toBeUndefined();
  });
});
