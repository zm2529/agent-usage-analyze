import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { closeDb, getDb } from 'agent-usage-analyze/db/client';
import { createApp } from '../index.js';

let dataDir: string;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'agent-analytics-improvements-api-'));
  process.env.AGENT_USAGE_ANALYZE_CONFIG_DIR = dataDir;
});

afterEach(() => {
  closeDb();
  delete process.env.AGENT_USAGE_ANALYZE_CONFIG_DIR;
  rmSync(dataDir, { recursive: true, force: true });
});

describe('improvement tracking API', () => {
  it('exposes the LLM-defined review envelope and stores user correction locally', async () => {
    getDb().prepare(`INSERT INTO improvement_plans (
      id, title, hypothesis, applicability, review_plan_json, status, sequence
    ) VALUES (
      'plan:api', 'Evidence-first completion', 'Reduce unsupported completion claims.',
      'Implementation tasks',
      '{"version":"improvement-review-plan-v1","llmDefined":{"reviewWhen":"enough comparable tasks"},"systemLimit":{"maxEligibleTasks":30,"maxObservationDays":45}}',
      'observing', 1
    )`).run();
    const app = createApp();
    const response = await app.request('/api/improvements');
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      limits: {
        maxActivePlans: 3,
        maxEligibleTasksPerPlan: 30,
        maxObservationDays: 45,
      },
      plans: [{
        id: 'plan:api',
        status: 'observing',
        reviewPlan: {
          llmDefined: { reviewWhen: 'enough comparable tasks' },
          systemLimit: { maxEligibleTasks: 30, maxObservationDays: 45 },
        },
      }],
    });

    const feedback = await app.request('/api/improvements/plan%3Aapi/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'judgment-wrong', note: 'This task family is different.' }),
    });
    expect(feedback.status).toBe(201);
    expect(await feedback.json()).toMatchObject({ storedLocally: true });
    expect(getDb().prepare(`SELECT kind, note FROM improvement_feedback
      WHERE plan_id = 'plan:api'`).get()).toEqual({
        kind: 'judgment-wrong',
        note: 'This task family is different.',
      });
  });
});
