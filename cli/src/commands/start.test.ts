import { describe, expect, it, vi } from 'vitest';
import { runStart } from './start.js';

const options = {
  port: '7890', open: false, hook: true, importHistory: true, waitForImport: false,
};

const syncResult = {
  syncedCount: 2, messageCount: 4, errorCount: 0, updatedExistingCount: 0,
  sessionsByProvider: { 'codex-cli': 1, 'claude-code': 1 },
};

describe('runStart', () => {
  it('syncs supported agents, configures Codex, starts the backfill, and launches without waiting', async () => {
    const calls: string[] = [];
    const launchDashboard = vi.fn(async () => { calls.push('dashboard'); });
    const importHistory = vi.fn();

    await runStart(options, {
      ensureSetup: () => {
        calls.push('setup');
        return { configCreated: true, configDir: '/tmp/config' };
      },
      syncHistory: async () => { calls.push('sync'); return syncResult; },
      installHook: () => {
        calls.push('hook');
        return { changed: true, file: '/tmp/hooks.json', backup: null };
      },
      importHistory,
      startBackgroundImport: (backgroundOptions) => {
        calls.push('background-import');
        expect(backgroundOptions).toEqual({ analyzeAfterImport: true });
        return { pid: 123, logPath: '/tmp/config/codex-import.log' };
      },
      launchDashboard,
    });

    expect(calls).toEqual(['setup', 'sync', 'hook', 'background-import', 'dashboard']);
    expect(importHistory).not.toHaveBeenCalled();
    expect(launchDashboard).toHaveBeenCalledWith({ port: '7890', open: false, sync: false });
  });

  it('starts both LLM analysis paths only after the first foreground import completes', async () => {
    const calls: string[] = [];
    await runStart({ ...options, waitForImport: true }, {
      ensureSetup: () => ({ configCreated: true, configDir: '/tmp/config' }),
      syncHistory: async () => { calls.push('sync'); return syncResult; },
      installHook: () => ({ changed: false, file: '/tmp/hooks.json', backup: null }),
      importHistory: async () => {
        calls.push('import');
        return {
          runId: 'run-1', adapter: 'codex-rollout', insertedEvents: 4, advancedSources: 1,
          coverage: { discovered: 1, parsed: 1, skipped: 0, failed: 0, unknown: 0 },
          status: 'completed' as const,
        };
      },
      startBackgroundImport: () => { throw new Error('should not spawn'); },
      startHistoryAnalysis: () => {
        calls.push('session-analysis');
        return {
          enabled: true, effectiveRunner: 'codex-native', reason: 'codex-chatgpt-auth',
          queued: 1, logPath: '/tmp/analysis.log',
        };
      },
      startBehaviorReport: () => { calls.push('behavior-report'); },
      launchDashboard: async () => { calls.push('dashboard'); },
    });

    expect(calls).toEqual([
      'sync', 'import', 'session-analysis', 'behavior-report', 'dashboard',
    ]);
  });

  it('waits and reports canonical import progress when explicitly requested', async () => {
    const calls: string[] = [];
    await runStart({ ...options, waitForImport: true }, {
      ensureSetup: () => ({ configCreated: false, configDir: '/tmp/config' }),
      syncHistory: async () => { calls.push('sync'); return syncResult; },
      installHook: () => ({ changed: false, file: '/tmp/hooks.json', backup: null }),
      importHistory: async ({ onProgress } = {}) => {
        calls.push('import');
        onProgress?.({
          runId: 'run-1', phase: 'processing', discoveredSources: 1, processedSources: 1,
        });
        return {
          runId: 'run-1', adapter: 'codex-rollout', insertedEvents: 4,
          advancedSources: 1,
          coverage: { discovered: 1, parsed: 1, skipped: 0, failed: 0, unknown: 0 },
          status: 'completed' as const,
        };
      },
      startBackgroundImport: () => { throw new Error('should not spawn'); },
      launchDashboard: async () => { calls.push('dashboard'); },
    });

    expect(calls).toEqual(['sync', 'import', 'dashboard']);
  });

  it('keeps startup usable when the optional background history import fails', async () => {
    const launchDashboard = vi.fn(async () => undefined);
    await expect(runStart(options, {
      ensureSetup: () => ({ configCreated: false, configDir: '/tmp/config' }),
      syncHistory: async () => syncResult,
      installHook: () => ({ changed: false, file: '/tmp/hooks.json', backup: null }),
      importHistory: vi.fn(),
      startBackgroundImport: () => { throw new Error('unavailable'); },
      launchDashboard,
    })).resolves.toBeUndefined();

    expect(launchDashboard).toHaveBeenCalledOnce();
  });

  it('honors explicit hook and import opt-outs', async () => {
    const installHook = vi.fn();
    const importHistory = vi.fn();
    const startBackgroundImport = vi.fn();
    const launchDashboard = vi.fn(async () => undefined);

    await runStart({ ...options, hook: false, importHistory: false }, {
      ensureSetup: () => ({ configCreated: false, configDir: '/tmp/config' }),
      syncHistory: async () => syncResult,
      installHook,
      importHistory,
      startBackgroundImport,
      launchDashboard,
    });

    expect(installHook).not.toHaveBeenCalled();
    expect(importHistory).not.toHaveBeenCalled();
    expect(startBackgroundImport).not.toHaveBeenCalled();
    expect(launchDashboard).toHaveBeenCalledOnce();
  });

  it('keeps startup usable when cross-agent history sync fails', async () => {
    const launchDashboard = vi.fn(async () => undefined);
    await expect(runStart(options, {
      ensureSetup: () => ({ configCreated: false, configDir: '/tmp/config' }),
      syncHistory: async () => { throw new Error('sync unavailable'); },
      installHook: () => ({ changed: false, file: '/tmp/hooks.json', backup: null }),
      importHistory: async () => ({
        runId: 'run-1', adapter: 'codex-rollout', insertedEvents: 0, advancedSources: 0,
        coverage: { discovered: 0, parsed: 0, skipped: 0, failed: 0, unknown: 0 },
        status: 'completed' as const,
      }),
      startBackgroundImport: () => ({ pid: 123, logPath: '/tmp/config/codex-import.log' }),
      launchDashboard,
    })).resolves.toBeUndefined();
    expect(launchDashboard).toHaveBeenCalledOnce();
  });
});
