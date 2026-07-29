import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { closeDb, getDb } from 'agent-usage-analyze/db/client';
import { createApp } from '../index.js';

let dataDir: string;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'agent-analytics-practices-api-'));
  process.env.AGENT_USAGE_ANALYZE_CONFIG_DIR = dataDir;
});

afterEach(() => {
  closeDb();
  delete process.env.AGENT_USAGE_ANALYZE_CONFIG_DIR;
  rmSync(dataDir, { recursive: true, force: true });
});

describe('practice library API', () => {
  it('allows settings to enable and disable public research', async () => {
    const app = createApp();
    const enabled = await app.request('/api/practices/authorization', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enabled: true }),
    });
    expect(enabled.status).toBe(200);
    expect(await enabled.json()).toMatchObject({ enabled: true, authorizedAt: expect.any(String) });

    const disabled = await app.request('/api/practices/authorization', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enabled: false }),
    });
    expect(disabled.status).toBe(200);
    expect(await disabled.json()).toEqual({ enabled: false, authorizedAt: null });
  });

  it('shows the external boundary before authorization and returns independent evidence dimensions', async () => {
    getDb().prepare(`INSERT INTO knowledge_snapshots (
      id, scope, snapshot_version, prompt_version, status,
      source_count, practice_count, query_summary_json, output_json
    ) VALUES ('snapshot:api', 'weekly', 'v1', 'p1', 'completed', 1, 1, '{}', '{}')`).run();
    getDb().prepare(`INSERT INTO knowledge_practices (
      id, snapshot_id, title, summary, applicability, source_trust,
      discussion_breadth, recency, local_relevance, local_effect_status,
      rationale, tags_json, source_refs_json, conflicts_json
    ) VALUES (
      'practice:api', 'snapshot:api', 'Evidence-first completion', 'Require fresh evidence.',
      'Implementation tasks', 'official', 'medium', 'current', 'high', 'not-reviewed',
      'Official primary source', '["validation"]',
      '[{"url":"https://example.com/official","sourceType":"official"}]', '[]'
    )`).run();
    const app = createApp();

    const status = await app.request('/api/practices/status');
    expect(status.status).toBe(200);
    expect(await status.json()).toMatchObject({
      authorization: { enabled: false, authorizedAt: null },
      boundary: {
        externalPayload: expect.stringContaining('隐私门'),
        localEffect: expect.stringContaining('改进追踪'),
      },
    });

    const list = await app.request('/api/practices?trust=official&relevance=high&tag=validation');
    expect(list.status).toBe(200);
    expect(await list.json()).toMatchObject({
      practices: [{
        id: 'practice:api',
        sourceTrust: 'official',
        discussionBreadth: 'medium',
        localRelevance: 'high',
        localEffectStatus: 'not-reviewed',
        tags: ['validation'],
      }],
    });
  });

  it('queues automatic research while local analysis is writing', async () => {
    getDb().prepare(`INSERT INTO analysis_queue
      (source_tool, session_id, status, runner_type, generation, started_at)
      VALUES ('codex-cli', 'active-analysis', 'processing', 'auto', 1, datetime('now'))`).run();
    const app = createApp();

    const enabled = await app.request('/api/practices/authorization', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enabled: true }),
    });
    expect(enabled.status).toBe(200);
    await new Promise((resolve) => setTimeout(resolve, 10));

    const status = await app.request('/api/practices/status');
    expect(await status.json()).toMatchObject({
      due: true,
      generation: {
        running: false,
        queued: true,
        scope: 'weekly',
        lastError: null,
      },
    });

    const disabled = await app.request('/api/practices/authorization', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enabled: false }),
    });
    expect(disabled.status).toBe(200);
  });
});
