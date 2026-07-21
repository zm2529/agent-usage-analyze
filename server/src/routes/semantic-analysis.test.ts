import Database from 'better-sqlite3';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { runMigrations } from '@agent-analytics/cli/db/schema';
import type { SemanticProvider } from '@agent-analytics/cli/canonical/semantic-analysis';
import { createSemanticAnalysisRouter } from './semantic-analysis.js';

function setup(): Database.Database {
  const db = new Database(':memory:');
  runMigrations(db);
  db.exec(`
    INSERT INTO observation_eras
      (id, name, mode, parser_version, capabilities_json, starts_at)
      VALUES ('era', 'continuous', 'continuous-observation', 'codex-rollout-v2',
        '["turn-safe-content"]', '2026-07-21T00:00:00.000Z');
    INSERT INTO source_artifacts
      (id, source_kind, parser_version, locator_hash, observed_at, era_id)
      VALUES ('source', 'codex-rollout', 'codex-rollout-v2', 'sha256:source',
        '2026-07-21T00:00:00.000Z', 'era');
    INSERT INTO source_ingestion_stats
      (source_artifact_id, discovered_count, parsed_count, skipped_count, failed_count, unknown_count)
      VALUES ('source', 1, 1, 0, 0, 0);
    INSERT INTO work_tasks
      (id, root_task_id, thread_id, role, status, started_at, ended_at, era_id)
      VALUES ('task', 'task', 'thread', 'root', 'completed',
        '2026-07-21T08:00:00.000Z', '2026-07-21T09:00:00.000Z', 'era');
    INSERT INTO canonical_events
      (id, source_artifact_id, era_id, native_event_id, sequence, occurred_at, kind,
       actor, sensitivity, payload_json, task_id, thread_id, turn_id, parser_version, payload_ref)
      VALUES ('event:user', 'source', 'era', 'native', 1, '2026-07-21T08:00:01.000Z',
        'user-message', 'user', 'sensitive-content', '{}', 'task', 'thread', 'turn-1',
        'codex-rollout-v2', 'source:source#offset=1');
  `);
  return db;
}

function appFor(input: {
  db: Database.Database;
  enabled: boolean;
  provider?: SemanticProvider;
}): Hono {
  const app = new Hono();
  app.route('/api/semantic', createSemanticAnalysisRouter({
    getDb: () => input.db,
    loadConfig: () => input.enabled ? {
      sync: { claudeDir: '', excludeProjects: [] },
      dashboard: {
        semanticAnalysisEnabled: true,
        llm: { provider: 'ollama', model: 'fixture-v1' },
      },
    } : null,
    resolvePayload: async () => 'Observed local evidence; secret=private-value',
    createProvider: () => input.provider!,
  }));
  return app;
}

describe('semantic analysis API', () => {
  it('returns an explicit disabled state without requiring a task or provider', async () => {
    const db = setup();
    const response = await appFor({ db, enabled: false }).request('/api/semantic/preview', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ taskId: 'missing' }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: 'disabled', reason: 'not-enabled', deterministicAvailable: true,
    });
    db.close();
  });

  it('returns a bounded not-found response when an enabled task is absent', async () => {
    const db = setup();
    const response = await appFor({
      db,
      enabled: true,
      provider: {
        provider: 'ollama', model: 'fixture-v1', locality: 'local',
        estimateTokens: () => 1,
        analyze: async () => { throw new Error('must not run'); },
      },
    }).request('/api/semantic/preview', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ taskId: 'missing' }),
    });

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'Task not found' });
    db.close();
  });

  it.each([
    ['gpt-4o-mini', 'known'],
    ['custom-unpriced-model', 'unknown'],
  ])('reports remote pricing as %s rather than assuming unknown cost is free', async (model, pricing) => {
    const db = setup();
    const app = new Hono();
    app.route('/api/semantic', createSemanticAnalysisRouter({
      getDb: () => db,
      loadConfig: () => ({
        sync: { claudeDir: '', excludeProjects: [] },
        dashboard: {
          semanticAnalysisEnabled: true,
          llm: { provider: 'openai', model, apiKey: 'explicit-test-key' },
        },
      }),
      resolvePayload: async () => 'safe evidence',
      createProvider: () => { throw new Error('preview must not create a provider'); },
    }));

    const response = await app.request('/api/semantic/preview', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ taskId: 'task' }),
    });
    const body = await response.json() as { estimatedCostUsd: number | null };
    if (pricing === 'known') expect(body.estimatedCostUsd).toBeGreaterThan(0);
    else expect(body.estimatedCostUsd).toBeNull();
    db.close();
  });

  it('fails closed when a legacy config marks a remote Ollama endpoint as enabled', async () => {
    const db = setup();
    const app = new Hono();
    app.route('/api/semantic', createSemanticAnalysisRouter({
      getDb: () => db,
      loadConfig: () => ({
        sync: { claudeDir: '', excludeProjects: [] },
        dashboard: {
          semanticAnalysisEnabled: true,
          llm: { provider: 'ollama', model: 'fixture', baseUrl: 'https://remote.example' },
        },
      }),
      resolvePayload: async () => 'must not resolve',
      createProvider: () => { throw new Error('must not create'); },
    }));

    const response = await app.request('/api/semantic/preview', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ taskId: 'task' }),
    });
    expect(await response.json()).toEqual({
      status: 'disabled', reason: 'not-enabled', deterministicAvailable: true,
    });
    db.close();
  });

  it('previews provider scope and returns accepted LLM-semantic claims through evidence links', async () => {
    const db = setup();
    const provider: SemanticProvider = {
      provider: 'ollama', model: 'fixture-v1', locality: 'local',
      estimateTokens: () => 16,
      analyze: async () => ({
        content: JSON.stringify({
          schemaVersion: 'agent-analytics.semantic-output.v1',
          claims: [{
            claimType: 'improvement-advice', title: 'Validate the first slice',
            summary: 'The evidence supports an earlier validation checkpoint.',
            expectedBenefit: 'A shorter feedback loop may reduce rework.',
            verification: 'Observe the first validation event in the next task.',
            confidence: 0.82, evidenceRefs: ['event:user'],
          }],
        }),
        usage: { inputTokens: 14, outputTokens: 9, costUsd: 0 },
      }),
    };
    const app = appFor({ db, enabled: true, provider });
    const preview = await app.request('/api/semantic/preview', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ taskId: 'task' }),
    });
    expect(await preview.json()).toMatchObject({
      status: 'ready', provider: 'ollama', model: 'fixture-v1', locality: 'local',
      evidenceScope: {
        firstTurn: expect.stringMatching(/^turn:[a-f0-9]{24}$/),
        lastTurn: expect.stringMatching(/^turn:[a-f0-9]{24}$/),
        turnCount: 1, eventCount: 1,
      },
      inputCoverage: 1, estimatedCostUsd: 0,
    });

    const analyzed = await app.request('/api/semantic/analyze', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ taskId: 'task' }),
    });
    expect(analyzed.status).toBe(200);
    expect(await analyzed.json()).toMatchObject({
      status: 'accepted', claims: [expect.objectContaining({
        sourceCategory: 'llm-semantic', evidenceRefs: ['event:user'],
      })],
    });
    const claims = await app.request('/api/semantic/claims?taskId=task');
    expect(await claims.json()).toEqual({
      claims: [expect.objectContaining({
        sourceCategory: 'llm-semantic', claimType: 'improvement-advice',
        run: expect.objectContaining({ provider: 'ollama', model: 'fixture-v1' }),
      })],
    });
    db.close();
  });
});
