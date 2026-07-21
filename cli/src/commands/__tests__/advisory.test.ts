import { describe, expect, it } from 'vitest';
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { EventEmitter } from 'node:events';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { vi } from 'vitest';
import { advisoryCommand, queryInReadonlyWorker, renderAdvisoryHook } from '../advisory.js';

const suggestion = {
  issueKey: 'pattern:validation-missing', sourceCategory: 'deterministic' as const,
  triggerFact: 'Validation was not observed.', expectedBenefit: 'Earlier feedback may reduce rework.',
  confidence: 0.9, coverage: 1, evidenceRefs: ['event:one'],
  verification: 'Run the smallest relevant validation.', muted: false,
};

describe('renderAdvisoryHook', () => {
  it('returns supplemental advice without echoing or changing the input prompt', async () => {
    const rawInput = JSON.stringify({ task_id: 'task:one', prompt: 'keep this exact private prompt' });
    const originalBytes = Buffer.from(rawInput);

    const output = await renderAdvisoryHook(rawInput, {
      timeoutMs: 50,
      resolveTaskId: async ({ taskId }) => taskId ?? null,
      query: async (taskId) => ({
        status: 'ok', taskId, suggestions: [suggestion], diagnostics: [],
      }),
    });

    expect(Buffer.from(rawInput)).toEqual(originalBytes);
    expect(output).toEqual({ status: 'ok', suggestions: [suggestion], diagnostics: [] });
    expect(JSON.stringify(output)).not.toContain('keep this exact private prompt');
    expect(output).not.toHaveProperty('prompt');
    expect(output).not.toHaveProperty('decision');
  });

  it('fails open within the configured time budget when the advisory query stalls', async () => {
    const started = performance.now();
    let aborted = false;
    const output = await renderAdvisoryHook(JSON.stringify({ task_id: 'task:one' }), {
      timeoutMs: 10,
      resolveTaskId: async ({ taskId }) => taskId ?? null,
      query: async (_taskId, signal) => new Promise(() => {
        signal.addEventListener('abort', () => { aborted = true; }, { once: true });
      }),
    });

    expect(performance.now() - started).toBeLessThan(100);
    expect(aborted).toBe(true);
    expect(output).toEqual({ status: 'ok', suggestions: [], diagnostics: ['timeout'] });
  });

  it('fails open for malformed input, unknown tasks, and internal errors', async () => {
    const dependencies = {
      timeoutMs: 50,
      resolveTaskId: async () => null,
      query: async () => { throw new Error('database path must not escape'); },
    };

    await expect(renderAdvisoryHook('{broken', dependencies)).resolves.toEqual({
      status: 'ok', suggestions: [], diagnostics: ['invalid-input'],
    });
    await expect(renderAdvisoryHook(JSON.stringify({ session_id: 'missing' }), dependencies)).resolves.toEqual({
      status: 'ok', suggestions: [], diagnostics: ['task-not-found'],
    });
    await expect(renderAdvisoryHook(JSON.stringify({ task_id: 'task:one' }), {
      ...dependencies, resolveTaskId: async () => 'task:one',
    })).resolves.toEqual({ status: 'ok', suggestions: [], diagnostics: ['unavailable'] });
  });

  it('exits normally without creating files when the read-only database is unavailable', async () => {
    const configDir = mkdtempSync(join(tmpdir(), 'agent-analytics-advisory-cli-'));
    const prior = process.env.AGENT_ANALYTICS_CONFIG_DIR;
    process.env.AGENT_ANALYTICS_CONFIG_DIR = configDir;
    const output = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      await expect(advisoryCommand('task:missing', { timeoutMs: '25' })).resolves.toBeUndefined();
      expect(JSON.parse(String(output.mock.calls.at(-1)?.[0]))).toEqual({
        status: 'ok', suggestions: [], diagnostics: ['unavailable'],
      });
      expect(readdirSync(configDir)).toEqual([]);
    } finally {
      output.mockRestore();
      if (prior === undefined) delete process.env.AGENT_ANALYTICS_CONFIG_DIR;
      else process.env.AGENT_ANALYTICS_CONFIG_DIR = prior;
      rmSync(configDir, { recursive: true, force: true });
    }
  });

  it('terminates the production worker when its deadline signal aborts', async () => {
    const configDir = mkdtempSync(join(tmpdir(), 'agent-analytics-advisory-worker-'));
    const prior = process.env.AGENT_ANALYTICS_CONFIG_DIR;
    process.env.AGENT_ANALYTICS_CONFIG_DIR = configDir;
    writeFileSync(join(configDir, 'data.db'), 'fixture');
    const worker = new EventEmitter() as EventEmitter & { terminate: ReturnType<typeof vi.fn> };
    worker.terminate = vi.fn(async () => 1);
    const controller = new AbortController();
    try {
      const query = queryInReadonlyWorker(
        'task:one', controller.signal, () => worker as unknown as never,
      );
      controller.abort();
      await expect(query).rejects.toThrow(/aborted/i);
      expect(worker.terminate).toHaveBeenCalledOnce();
    } finally {
      if (prior === undefined) delete process.env.AGENT_ANALYTICS_CONFIG_DIR;
      else process.env.AGENT_ANALYTICS_CONFIG_DIR = prior;
      rmSync(configDir, { recursive: true, force: true });
    }
  });
});
