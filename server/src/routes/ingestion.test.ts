import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { closeDb, getDb } from 'agent-usage-analyze/db/client';
import {
  ingestSourceAdapter,
  type CanonicalBatch,
  type SourceAdapter,
  type SourceArtifact,
} from 'agent-usage-analyze/canonical/ingestion';
import { createApp } from '../index.js';
import { reconcileHistoryProjection } from './ingestion.js';

let dataDir: string;

const artifact: SourceArtifact = {
  id: 'fixture:api',
  sourceKind: 'synthetic-codex',
  parserVersion: 'api-v1',
  locatorHash: 'sha256:api',
  observedAt: '2026-07-21T09:00:00.000Z',
};

class ApiFixtureAdapter implements SourceAdapter {
  readonly name = 'api-fixture';

  async discover(): Promise<SourceArtifact[]> {
    return [artifact];
  }

  async parse(): Promise<CanonicalBatch> {
    return {
      artifact,
      era: {
        id: 'era:api',
        name: 'API fixture',
        mode: 'historical-backfill',
        parserVersion: 'api-v1',
        capabilities: ['canonical-event'],
        startsAt: artifact.observedAt,
      },
      events: [{
        id: 'event:api:0', nativeEventId: '0', sequence: 0,
        occurredAt: artifact.observedAt, kind: 'task-started', actor: 'system',
        sensitivity: 'structural', payload: {},
      }],
      identityEdges: [],
      diagnostics: [],
      coverage: { discovered: 1, parsed: 1, skipped: 0, failed: 0, unknown: 0 },
      previousCursor: null,
      nextCursor: { token: 'line:1', position: 1 },
    };
  }
}

describe('GET /api/ingestion/health', () => {
  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'agent-analytics-api-'));
    process.env.AGENT_ANALYTICS_CONFIG_DIR = dataDir;
  });

  afterEach(() => {
    closeDb();
    delete process.env.AGENT_ANALYTICS_CONFIG_DIR;
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('returns canonical coverage and observation eras', async () => {
    await ingestSourceAdapter(new ApiFixtureAdapter(), getDb());

    const response = await createApp().request('/api/ingestion/health');

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: 'completed',
      diagnostics: [],
      coverage: { discovered: 1, parsed: 1, skipped: 0, failed: 0, unknown: 0 },
      eventCount: 1,
      sourceCount: 1,
      processedSources: 1,
      startedAt: expect.any(String),
      completedAt: expect.any(String),
      eras: [{ id: 'era:api', mode: 'historical-backfill', parserVersion: 'api-v1' }],
    });
  });

  it('returns the newest failed run instead of stale successful health', async () => {
    await ingestSourceAdapter(new ApiFixtureAdapter(), getDb());
    const failing = new ApiFixtureAdapter();
    failing.parse = async () => { throw new Error('raw private failure detail'); };
    await ingestSourceAdapter(failing, getDb());

    const response = await createApp().request('/api/ingestion/health');
    const body = await response.json() as {
      status: string;
      diagnostics: Array<{ severity: string; code: string; count: number }>;
    };

    expect(body.status).toBe('failed');
    expect(body.diagnostics).toEqual([
      { severity: 'error', code: 'adapter-parse-failed', count: 1 },
    ]);
    expect(JSON.stringify(body)).not.toContain('raw private failure detail');
  });

  it('repairs stale message counters and invalidates placeholder LLM output', () => {
    const db = getDb();
    db.prepare(`INSERT INTO projects (id, name, path, last_activity)
      VALUES ('project', 'project', '/project', '2026-07-22T00:00:00.000Z')`).run();
    db.prepare(`INSERT INTO sessions
      (id, project_id, project_name, project_path, started_at, ended_at,
       message_count, user_message_count, assistant_message_count, source_tool,
       generated_title, title_source)
      VALUES ('codex:stale', 'project', 'project', '/project',
        '2026-07-22T00:00:00.000Z', '2026-07-22T01:00:00.000Z',
        12, 6, 6, 'codex-cli', 'No coding activity captured', 'insight')`).run();
    db.prepare(`INSERT INTO insights
      (id, session_id, project_id, project_name, type, title, content, summary,
       bullets, confidence, source, metadata, timestamp, created_at)
      VALUES ('placeholder', 'codex:stale', 'project', 'project', 'summary',
        'No coding activity captured', 'none', 'none', '[]', 0.1, 'llm',
        'not-json', '2026-07-22T01:00:00.000Z', '2026-07-22T01:00:00.000Z')`).run();

    expect(reconcileHistoryProjection()).toMatchObject({ staleBefore: 1, usableSessions: 0, emptySessions: 1 });
    expect(db.prepare(`SELECT message_count AS messageCount, generated_title AS title
      FROM sessions WHERE id = 'codex:stale'`).get()).toEqual({ messageCount: 0, title: null });
    expect(db.prepare(`SELECT source, json_extract(metadata, '$.unavailable_reason') AS reason
      FROM insights WHERE id = 'placeholder'`).get()).toEqual({
      source: 'invalidated', reason: 'missing-conversation-evidence',
    });
  });

  it('repairs only an injected Codex title from the first genuine stored request', () => {
    const db = getDb();
    db.prepare(`INSERT INTO projects (id, name, path, last_activity)
      VALUES ('title-project', 'title-project', '/title-project', '2026-07-22T00:00:00.000Z')`).run();
    db.prepare(`INSERT INTO sessions
      (id, project_id, project_name, project_path, started_at, ended_at,
       message_count, user_message_count, assistant_message_count, source_tool,
       generated_title, title_source, custom_title)
      VALUES ('codex:title-repair', 'title-project', 'title-project', '/title-project',
        '2026-07-22T00:00:00.000Z', '2026-07-22T01:00:00.000Z',
        3, 2, 1, 'codex-cli', '<recommendedplugins> Here is a list...', 'user_message', '用户自定义标题')`).run();
    const insertMessage = db.prepare(`INSERT INTO messages
      (id, session_id, type, content, tool_calls, tool_results, timestamp)
      VALUES (?, 'codex:title-repair', ?, ?, '[]', '[]', ?)`);
    insertMessage.run('context', 'user', '<recommended_plugins>context</recommended_plugins>', '2026-07-22T00:00:01.000Z');
    insertMessage.run('request', 'user', '# Files mentioned by the user:\n\n## logs: /tmp/logs\n\n## My request for Codex:\n投屏是否有异常', '2026-07-22T00:00:02.000Z');
    insertMessage.run('answer', 'assistant', '正在分析', '2026-07-22T00:00:03.000Z');

    expect(reconcileHistoryProjection()).toMatchObject({ repairedTitles: 1 });
    expect(db.prepare(`SELECT generated_title AS generatedTitle, custom_title AS customTitle
      FROM sessions WHERE id = 'codex:title-repair'`).get()).toEqual({
      generatedTitle: '投屏是否有异常', customTitle: '用户自定义标题',
    });
  });

  it('repairs a Codex goal wrapper title from its user-provided objective', () => {
    const db = getDb();
    db.prepare(`INSERT INTO projects (id, name, path, last_activity)
      VALUES ('goal-project', 'goal-project', '/goal-project', '2026-07-22T00:00:00.000Z')`).run();
    db.prepare(`INSERT INTO sessions
      (id, project_id, project_name, project_path, started_at, ended_at,
       message_count, user_message_count, assistant_message_count, source_tool,
       generated_title, title_source)
      VALUES ('codex:goal-repair', 'goal-project', 'goal-project', '/goal-project',
        '2026-07-22T00:00:00.000Z', '2026-07-22T01:00:00.000Z',
        2, 1, 1, 'codex-cli', '<codexinternalcontext source="goal"> Continue...', 'user_message')`).run();
    db.prepare(`INSERT INTO messages
      (id, session_id, type, content, tool_calls, tool_results, timestamp)
      VALUES ('goal', 'codex:goal-repair', 'user', ?, '[]', '[]', '2026-07-22T00:00:01.000Z')`)
      .run('<codex_internal_context source="goal"><objective>完成 Codex 自动分析</objective></codex_internal_context>');
    db.prepare(`INSERT INTO messages
      (id, session_id, type, content, tool_calls, tool_results, timestamp)
      VALUES ('goal-answer', 'codex:goal-repair', 'assistant', '继续执行', '[]', '[]', '2026-07-22T00:00:02.000Z')`).run();

    expect(reconcileHistoryProjection()).toMatchObject({ repairedTitles: 1 });
    expect(db.prepare(`SELECT generated_title AS title FROM sessions WHERE id = 'codex:goal-repair'`).get())
      .toEqual({ title: '完成 Codex 自动分析' });
  });
});
