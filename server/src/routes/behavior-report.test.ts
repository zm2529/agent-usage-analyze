import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { closeDb, getDb } from 'agent-usage-analyze/db/client';
import { recordAnalysisRun } from 'agent-usage-analyze/analysis/analysis-run-db';
import { createApp } from '../index.js';

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
      report: null,
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
