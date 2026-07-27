import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { closeDb, getDb } from 'agent-usage-analyze/db/client';
import { recordAnalysisRun } from 'agent-usage-analyze/analysis/analysis-run-db';
import { createApp } from '../index.js';

vi.mock('agent-usage-analyze/analysis/behavior-report-scheduler', async (importOriginal) => {
  const actual = await importOriginal<typeof import('agent-usage-analyze/analysis/behavior-report-scheduler')>();
  return { ...actual, spawnManualBehaviorReport: actual.runManualBehaviorReport };
});

let dataDir: string;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'agent-analytics-behavior-api-'));
  process.env.AGENT_ANALYTICS_CONFIG_DIR = dataDir;
});

afterEach(() => {
  closeDb();
  delete process.env.AGENT_ANALYTICS_CONFIG_DIR;
  rmSync(dataDir, { recursive: true, force: true });
});

describe('behavior report and analysis run APIs', () => {
  it('does not present a legacy fixed-rubric report as the current personal profile', async () => {
    recordAnalysisRun({
      analysisType: 'behavior_report',
      status: 'completed',
      promptVersion: 'behavior-report-v3',
      inputSummary: { validationObservability: { editedTasks: 20 } },
      outputJson: JSON.stringify({ headline: 'Legacy fixed-rubric report' }),
    }, getDb());

    const response = await createApp().request('/api/behavior-report');
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      report: null,
      needsRegeneration: true,
      run: { promptVersion: 'behavior-report-v3' },
      latestAttempt: { promptVersion: 'behavior-report-v3' },
    });
  });

  it('does not display an old-format report when a current generation attempt fails', async () => {
    const insert = getDb().prepare(`INSERT INTO analysis_runs (
      id, analysis_type, status, unavailable_reason, provider, model,
      prompt_version, input_summary_json, output_json, created_at
    ) VALUES (?, 'behavior_report', ?, ?, ?, ?, ?, ?, ?, ?)`);
    insert.run(
      'analysis-run:completed-v8', 'completed', null, 'codex-native', 'codex-default',
      'behavior-report-v8',
      JSON.stringify({ leverage: { skills: { items: [] }, tools: { families: [] } } }),
      JSON.stringify({ headline: 'Last successful report' }),
      '2026-07-26 09:00:00',
    );
    insert.run(
      'analysis-run:failed-v9', 'failed', 'runner-authentication-failed', null, null,
      'behavior-report-v10',
      JSON.stringify({ leverage: { skills: { items: [] }, tools: { families: [] } } }),
      null,
      '2026-07-26 09:01:00',
    );

    const response = await createApp().request('/api/behavior-report');
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      report: null,
      needsRegeneration: true,
      run: { status: 'failed', promptVersion: 'behavior-report-v10' },
      latestAttempt: {
        status: 'failed',
        promptVersion: 'behavior-report-v10',
        unavailableReason: 'runner-authentication-failed',
      },
    });
  });

  it('reports insufficient evidence without invoking an LLM and exposes the immutable run', async () => {
    const app = createApp();
    const initial = await app.request('/api/behavior-report');
    expect(initial.status).toBe(200);
    expect(await initial.json()).toMatchObject({ report: null, run: null });

    const run = await app.request('/api/behavior-report/run', { method: 'POST' });
    expect(run.status).toBe(200);
    expect(await run.json()).toMatchObject({
      accepted: true,
      generation: { running: true },
    });

    for (let attempt = 0; attempt < 20; attempt += 1) {
      const state = await app.request('/api/behavior-report');
      const body = await state.json() as { generation: { running: boolean } };
      if (!body.generation.running) break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    const ledger = await app.request('/api/analysis/runs?analysisType=behavior_report');
    expect(ledger.status).toBe(200);
    expect(await ledger.json()).toMatchObject({
      runs: [{ analysisType: 'behavior_report', status: 'unavailable', unavailableReason: 'insufficient-structural-sessions' }],
    });
  });
});
