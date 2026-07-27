import { describe, expect, it, vi } from 'vitest';
import { runImportCodexCommand } from './import-codex.js';

describe('runImportCodexCommand', () => {
  it('starts session and cross-session LLM analysis after the initial import', async () => {
    const calls: string[] = [];
    const writeSummary = vi.fn();

    await runImportCodexCommand({ analyzeAfterImport: true }, {
      importHistory: async () => {
        calls.push('import');
        return {
          runId: 'run-1', adapter: 'codex-rollout', insertedEvents: 7, advancedSources: 2,
          coverage: { discovered: 2, parsed: 2, skipped: 0, failed: 0, unknown: 0 },
          status: 'completed' as const,
        };
      },
      startHistoryAnalysis: () => {
        calls.push('session-analysis');
        return {
          enabled: true, effectiveRunner: 'codex-native', reason: 'codex-chatgpt-auth',
          queued: 2, logPath: '/tmp/analysis.log',
        };
      },
      startBehaviorReport: () => { calls.push('behavior-report'); },
      writeSummary,
    });

    expect(calls).toEqual(['import', 'session-analysis', 'behavior-report']);
    expect(writeSummary).toHaveBeenCalledWith(expect.objectContaining({ insertedEvents: 7 }));
  });

  it('does not trigger LLM work for a normal explicit import', async () => {
    const startHistoryAnalysis = vi.fn();
    const startBehaviorReport = vi.fn();

    await runImportCodexCommand({}, {
      importHistory: async () => ({
        runId: 'run-1', adapter: 'codex-rollout', insertedEvents: 0, advancedSources: 0,
        coverage: { discovered: 0, parsed: 0, skipped: 0, failed: 0, unknown: 0 },
        status: 'completed' as const,
      }),
      startHistoryAnalysis,
      startBehaviorReport,
      writeSummary: vi.fn(),
    });

    expect(startHistoryAnalysis).not.toHaveBeenCalled();
    expect(startBehaviorReport).not.toHaveBeenCalled();
  });

  it('keeps the successful import and starts the report if session analysis cannot start', async () => {
    const calls: string[] = [];
    const writeSummary = vi.fn();
    const warn = vi.fn();

    await runImportCodexCommand({ analyzeAfterImport: true }, {
      importHistory: async () => ({
        runId: 'run-1', adapter: 'codex-rollout', insertedEvents: 3, advancedSources: 1,
        coverage: { discovered: 1, parsed: 1, skipped: 0, failed: 0, unknown: 0 },
        status: 'completed' as const,
      }),
      startHistoryAnalysis: () => { throw new Error('runner unavailable'); },
      startBehaviorReport: () => { calls.push('behavior-report'); },
      writeSummary,
      warn,
    });

    expect(calls).toEqual(['behavior-report']);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('runner unavailable'));
    expect(writeSummary).toHaveBeenCalledWith(expect.objectContaining({ insertedEvents: 3 }));
  });
});
