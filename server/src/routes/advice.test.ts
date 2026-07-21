import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { closeDb, getDb } from '@agent-analytics/cli/db/client';
import { createApp } from '../index.js';

let dataDir: string;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'agent-analytics-advice-api-'));
  process.env.AGENT_ANALYTICS_CONFIG_DIR = dataDir;
  getDb().exec(`
    INSERT INTO observation_eras
      (id, name, mode, parser_version, capabilities_json, starts_at)
    VALUES
      ('era:advice', 'advice fixture', 'continuous-observation', 'fixture-v1', '[]',
        '2026-07-21T00:00:00.000Z'),
      ('era:followup', 'follow-up fixture', 'continuous-observation', 'fixture-v2', '[]',
        '2026-07-28T00:00:00.000Z');
    INSERT INTO work_tasks
      (id, root_task_id, thread_id, role, status, started_at, era_id)
    VALUES
      ('task:advice', 'task:advice', 'thread:advice', 'root', 'active',
        '2026-07-21T00:00:00.000Z', 'era:advice'),
      ('task:followup', 'task:followup', 'thread:followup', 'root', 'active',
        '2026-07-28T00:00:00.000Z', 'era:followup');
    INSERT INTO source_artifacts
      (id, source_kind, parser_version, locator_hash, observed_at, era_id)
    VALUES
      ('source:advice', 'synthetic-codex', 'fixture-v1', 'sha256:advice',
        '2026-07-21T00:00:00.000Z', 'era:advice'),
      ('source:followup', 'synthetic-codex', 'fixture-v2', 'sha256:followup',
        '2026-07-28T00:00:00.000Z', 'era:followup');
    INSERT INTO canonical_events
      (id, source_artifact_id, era_id, native_event_id, sequence, occurred_at, kind,
       actor, sensitivity, payload_json, task_id, thread_id, parser_version)
    VALUES
      ('event:advice', 'source:advice', 'era:advice', 'native:advice', 1,
        '2026-07-21T00:01:00.000Z', 'task-completed', 'system', 'structural',
        '{"status":"completed"}', 'task:advice', 'thread:advice', 'fixture-v1'),
      ('event:followup', 'source:followup', 'era:followup', 'native:followup', 1,
        '2026-07-28T00:01:00.000Z', 'task-completed', 'system', 'structural',
        '{"status":"completed"}', 'task:followup', 'thread:followup', 'fixture-v2');
    INSERT INTO evidence_records
      (id, evidence_type, subject_ref, position, source_category, algorithm_version,
       coverage, confidence, era_compatibility, era_ids_json, human_status, fact_refs_json)
    VALUES
      ('evidence:advice', 'canonical-event-observation', 'pattern:validation-missing',
        'supports', 'deterministic', 'deterministic-patterns-v1', 0.9, 0.8, 'compatible',
        '["era:advice"]', 'unreviewed',
        '[{"eventId":"event:advice","taskId":"task:advice"}]'),
      ('evidence:followup', 'canonical-event-observation', 'pattern:validation-missing',
        'supports', 'deterministic', 'deterministic-patterns-v1', 0.7, 0.75, 'compatible',
        '["era:followup"]', 'unreviewed',
        '[{"eventId":"event:followup","taskId":"task:followup"}]');
    INSERT INTO analysis_claims
      (id, pattern_key, source_category, algorithm_version, window_start, window_end,
       sample_count, total_task_count, coverage, confidence, era_compatibility,
       sample_task_refs_json, evidence_refs_json)
    VALUES
      ('claim:advice', 'validation-missing', 'deterministic',
        'deterministic-patterns-v1', '2026-07-14T00:00:00.000Z',
        '2026-07-21T00:00:00.000Z', 1, 1, 0.9, 0.8, 'compatible',
        '["task:advice"]', '["evidence:advice"]'),
      ('claim:followup', 'validation-missing', 'deterministic',
        'deterministic-patterns-v1', '2026-07-21T00:00:00.000Z',
        '2026-07-28T00:00:00.000Z', 1, 1, 0.7, 0.75, 'compatible',
        '["task:followup"]', '["evidence:followup"]');
  `);
});

afterEach(() => {
  closeDb();
  delete process.env.AGENT_ANALYTICS_CONFIG_DIR;
  rmSync(dataDir, { recursive: true, force: true });
});

describe('Advice API', () => {
  it('returns active and muted advice with evidence, history, and attention overhead', async () => {
    const response = await createApp().request('/api/advice?taskId=task%3Aadvice');

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      status: 'ok', diagnostics: [],
      active: [{
        issueKey: 'pattern:validation-missing', confidence: 0.8, coverage: 0.9,
        evidenceRefs: ['event:advice'], muted: false,
      }],
      muted: [], history: { events: [], comparisons: [] },
      attention: { shown: 0, adopted: 0, ignored: 0, dismissed: 0 },
    });
  });

  it('returns recent task advice for the global Advice page without requiring a task filter', async () => {
    const response = await createApp().request('/api/advice');

    expect(response.status).toBe(200);
    const state = await response.json() as { status: string; active: unknown[]; muted: unknown[] };
    expect(state.status).toBe('ok');
    expect(state.active).toEqual(expect.arrayContaining([
      expect.objectContaining({ taskId: 'task:advice', issueKey: 'pattern:validation-missing' }),
      expect.objectContaining({ taskId: 'task:followup', issueKey: 'pattern:validation-missing' }),
    ]));
    expect(state.muted).toEqual([]);
  });

  it('fails open with an empty successful response when the advisory store is unavailable', async () => {
    getDb().exec('DROP TABLE analysis_claims');

    const response = await createApp().request('/api/advice?taskId=task%3Aadvice');

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: 'ok', active: [], muted: [],
      history: { events: [], comparisons: [] },
      attention: { shown: 0, adopted: 0, ignored: 0, dismissed: 0 },
      diagnostics: ['unavailable'],
    });
  });

  it('records validated interactions and follow-up outcomes as separate derived events', async () => {
    const app = createApp();
    const shown = await app.request('/api/advice/events', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        taskId: 'task:advice', issueKey: 'pattern:validation-missing', action: 'shown',
      }),
    });
    const shownBody = await shown.json() as { interventionId: string };
    const afterShown = await (await app.request('/api/advice?taskId=task%3Aadvice')).json() as {
      active: unknown[];
    };
    const outcome = await app.request('/api/advice/events', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        taskId: 'task:followup', issueKey: 'pattern:validation-missing',
        action: 'outcome', outcome: 'improved', interventionId: shownBody.interventionId,
      }),
    });

    expect(shown.status).toBe(202);
    expect(afterShown.active).toEqual([]);
    expect(outcome.status, await outcome.clone().text()).toBe(202);
    const state = await (await app.request('/api/advice?taskId=task%3Aadvice')).json() as {
      history: { events: Array<{ action: string; outcome: string | null; observationEraId: string; coverage: number }> };
      attention: { shown: number };
    };
    expect(state.history.events).toMatchObject([
      { action: 'outcome', outcome: 'improved', observationEraId: 'era:followup', coverage: 0.7 },
      { action: 'shown', outcome: null, observationEraId: 'era:advice', coverage: 0.9 },
    ]);
    expect(state.attention.shown).toBe(1);
  });

  it('rejects an older task as follow-up evidence for a newer intervention', async () => {
    const app = createApp();
    const shown = await app.request('/api/advice/events', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        taskId: 'task:followup', issueKey: 'pattern:validation-missing', action: 'shown',
      }),
    });
    const shownBody = await shown.json() as { interventionId: string };

    const outcome = await app.request('/api/advice/events', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        taskId: 'task:advice', issueKey: 'pattern:validation-missing', action: 'outcome',
        outcome: 'improved', interventionId: shownBody.interventionId,
      }),
    });

    expect(shown.status).toBe(202);
    expect(outcome.status).toBe(400);
    expect(await outcome.json()).toEqual({
      error: 'Follow-up evidence must occur after the intervention',
    });
  });

  it('mutes an issue without accepting client-owned evidence or era fields', async () => {
    const app = createApp();
    const forged = await app.request('/api/advice/events', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        taskId: 'task:advice', issueKey: 'pattern:validation-missing', action: 'shown',
        evidenceRefs: ['password=hunter2'], observationEraId: 'era:forged', coverage: 1,
      }),
    });
    const muted = await app.request('/api/advice/mutes', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        scopeKind: 'issue', scopeKey: 'pattern:validation-missing',
        mutedUntil: '2099-01-01T00:00:00.000Z',
      }),
    });

    expect(forged.status).toBe(400);
    expect(muted.status).toBe(204);
    const state = await (await app.request('/api/advice?taskId=task%3Aadvice')).json() as {
      active: unknown[]; muted: Array<{ issueKey: string }>;
    };
    expect(state.active).toEqual([]);
    expect(state.muted).toMatchObject([{ issueKey: 'pattern:validation-missing' }]);
    expect(JSON.stringify(state)).not.toContain('hunter2');

    const unmuted = await app.request('/api/advice/mutes', {
      method: 'DELETE', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scopeKind: 'issue', scopeKey: 'pattern:validation-missing' }),
    });
    expect(unmuted.status).toBe(204);
    expect(await (await app.request('/api/advice?taskId=task%3Aadvice')).json())
      .toMatchObject({ active: [{ issueKey: 'pattern:validation-missing' }], muted: [] });
  });
});
