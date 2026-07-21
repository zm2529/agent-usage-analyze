import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { closeDb, getDb } from '@agent-analytics/cli/db/client';
import {
  createScorecardVersion,
  evaluateScorecard,
  transitionScorecardVersion,
} from '@agent-analytics/cli/canonical/scorecards';
import { recordObserverOverhead } from '@agent-analytics/cli/canonical/observer-overhead';
import { createApp } from '../index.js';

let dataDir: string;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'agent-analytics-scorecards-api-'));
  process.env.AGENT_ANALYTICS_CONFIG_DIR = dataDir;
  const db = getDb();
  db.prepare(`INSERT INTO observation_eras
    (id, name, mode, parser_version, capabilities_json, starts_at)
    VALUES ('era:scorecard', 'scorecard fixture', 'continuous-observation', 'fixture-v1', '[]',
      '2026-07-21T00:00:00.000Z')`).run();
  db.prepare(`INSERT INTO work_tasks
    (id, root_task_id, thread_id, role, status, started_at, ended_at, era_id)
    VALUES ('task:one', 'task:one', 'task:one', 'root', 'completed',
      '2026-07-21T00:00:00.000Z', '2026-07-21T00:10:00.000Z', 'era:scorecard')`).run();
  db.prepare(`INSERT INTO source_artifacts
    (id, source_kind, parser_version, locator_hash, observed_at, era_id)
    VALUES ('source:scorecard', 'synthetic-codex', 'fixture-v1', 'sha256:scorecard',
      '2026-07-21T00:00:00.000Z', 'era:scorecard')`).run();
  db.prepare(`INSERT INTO canonical_events
    (id, source_artifact_id, era_id, native_event_id, sequence, occurred_at, kind, actor,
     sensitivity, payload_json, task_id, thread_id, parser_version)
    VALUES ('event:score', 'source:scorecard', 'era:scorecard', 'score', 1,
      '2026-07-21T00:05:00.000Z', 'tool-result', 'tool', 'structural',
      '{"status":"completed"}', 'task:one', 'task:one', 'fixture-v1')`).run();
  db.prepare(`INSERT INTO semantic_analysis_runs
    (id, task_id, status, provider, model, locality, rubric_version, analysis_version,
     input_coverage, estimated_input_tokens, input_tokens, output_tokens, cost_usd,
     evidence_refs_json, rejection_code)
    VALUES ('semantic-run:advice', 'task:one', 'accepted', 'fixture', 'fixture', 'local',
      'semantic-rubric-v1', 'semantic-analysis-v1', 1, 10, 8, 2, 0, '[]', NULL)`).run();
  db.prepare(`INSERT INTO analysis_claims
    (id, pattern_key, source_category, algorithm_version, window_start, window_end,
     sample_count, total_task_count, coverage, confidence, era_compatibility,
     sample_task_refs_json, evidence_refs_json)
    VALUES ('claim:one', 'semantic:improvement-advice', 'llm-semantic', 'semantic-analysis-v1',
      '2026-07-21T00:00:00.000Z', '2026-07-21T00:10:00.000Z', 1, 1, 1, 0.9,
      'compatible', '["task:one"]', '[]')`).run();
  db.prepare(`INSERT INTO semantic_claim_details
    (claim_id, run_id, claim_type, title, summary, expected_benefit, verification)
    VALUES ('claim:one', 'semantic-run:advice', 'improvement-advice', 'Advice', 'Summary',
      'Benefit', 'Verify')`).run();
  const version = createScorecardVersion(db, {
    name: 'Personal delivery evidence', version: 'fixture-v1',
    features: [{ key: 'deliveryEvidence', label: 'Delivery evidence', weight: 1, requiresQualityGate: false }],
    qualityGates: ['delivery-observed'], safetyGates: ['no-unsafe-attribution'],
    missingRules: { deliveryEvidence: 'unavailable' }, thresholds: { minimumCoverage: 0.8 },
    calibrationDataVersion: 'fixture-calibration', scope: { kind: 'personal' },
    evidenceRefs: ['evidence:definition'],
  });
  transitionScorecardVersion(db, version.id, 'calibrating', ['evidence:start']);
  evaluateScorecard(db, {
    taskId: 'task:one', scorecardVersionId: version.id,
    rawFeatures: { deliveryEvidence: 0.8 },
    gateResults: { quality: true, safety: true, calibration: true },
    coverage: 1, uncertainty: 0.1, evidenceRefs: ['event:score'],
  });
  recordObserverOverhead(db, {
    category: 'llm', observerRunId: 'semantic:one', inputTokens: 120, outputTokens: 20,
    costUsd: null, evidenceRefs: ['semantic:one'],
  });
});

afterEach(() => {
  closeDb();
  delete process.env.AGENT_ANALYTICS_CONFIG_DIR;
  rmSync(dataDir, { recursive: true, force: true });
});

describe('scorecard and observer overhead APIs', () => {
  it('returns version state, diagnostics, missing reason, and evidence without inventing an aggregate', async () => {
    const response = await createApp().request('/api/scorecards');
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      versions: [{ version: 'fixture-v1', status: 'calibrating', qualityGates: ['delivery-observed'] }],
      results: [{ taskId: 'task:one', rootTaskId: 'task:one', indexValue: null, unavailableReason: 'scorecard-not-active',
        evidenceRefs: ['event:score'], evidenceLinks: [{ ref: 'event:score', eventId: 'event:score', rootTaskId: 'task:one' }] }],
    });
  });

  it('resolves a child scorecard subject and child event to the root task drilldown', async () => {
    const db = getDb();
    db.prepare(`INSERT INTO work_tasks
      (id, root_task_id, parent_task_id, thread_id, role, status, started_at, ended_at, era_id)
      VALUES ('task:worker', 'task:one', 'task:one', 'task:worker', 'worker', 'completed',
        '2026-07-21T00:02:00.000Z', '2026-07-21T00:04:00.000Z', 'era:scorecard')`).run();
    db.prepare(`INSERT INTO canonical_events
      (id, source_artifact_id, era_id, native_event_id, sequence, occurred_at, kind, actor,
       sensitivity, payload_json, task_id, thread_id, parser_version)
      VALUES ('event:worker', 'source:scorecard', 'era:scorecard', 'worker', 2,
        '2026-07-21T00:03:00.000Z', 'tool-result', 'tool', 'structural',
        '{"status":"completed"}', 'task:worker', 'task:worker', 'fixture-v1')`).run();
    const version = db.prepare(`SELECT id FROM scorecard_versions WHERE version = 'fixture-v1'`)
      .get() as { id: string };
    evaluateScorecard(db, {
      taskId: 'task:worker', scorecardVersionId: version.id,
      rawFeatures: { deliveryEvidence: 0.9 },
      gateResults: { quality: true, safety: true, calibration: true },
      coverage: 1, uncertainty: 0.1, evidenceRefs: ['event:worker'],
    });

    const response = await createApp().request('/api/scorecards?taskId=task%3Aworker');
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      results: [{
        taskId: 'task:worker', rootTaskId: 'task:one',
        evidenceLinks: [{ ref: 'event:worker', eventId: 'event:worker', rootTaskId: 'task:one' }],
      }],
    });
  });

  it('returns observer-only LLM usage with unknown cost preserved', async () => {
    const response = await createApp().request('/api/observer-overhead');
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      eventCount: 1,
      totals: { inputTokens: 120, outputTokens: 20, costUsd: null },
      recentEvents: [{ subjectKind: 'observer', observerRunId: 'semantic:one' }],
    });
  });

  it('records advisory display and interaction through the production API', async () => {
    const response = await createApp().request('/api/observer-overhead/advisory', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ claimId: 'claim:one', action: 'adopted' }),
    });
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ recorded: true, degraded: false });
    expect(getDb().prepare(`SELECT category, advisory_action AS action,
      analyzed_task_id AS taskId FROM observer_overhead_events
      WHERE category = 'advisory'`).get()).toEqual({ category: 'advisory', action: 'adopted', taskId: 'task:one' });
  });

  it('rejects forged, missing, or raw advisory identifiers without polluting observer totals', async () => {
    const app = createApp();
    const raw = await app.request('/api/observer-overhead/advisory', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ claimId: 'password=hunter2', action: 'adopted' }),
    });
    const missing = await app.request('/api/observer-overhead/advisory', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ claimId: 'claim:missing', action: 'adopted' }),
    });
    expect(raw.status).toBe(400);
    expect(missing.status).toBe(404);
    expect(getDb().prepare(`SELECT COUNT(*) AS count FROM observer_overhead_events
      WHERE category = 'advisory'`).get()).toEqual({ count: 0 });
    expect(JSON.stringify(await (await app.request('/api/observer-overhead')).json())).not.toContain('hunter2');
  });
});
