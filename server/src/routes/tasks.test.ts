import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { closeDb, getDb } from 'agent-usage-analyze/db/client';
import { createApp } from '../index.js';

let dataDir: string;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'agent-analytics-tasks-api-'));
  process.env.AGENT_ANALYTICS_CONFIG_DIR = dataDir;
  const db = getDb();
  db.prepare(`INSERT INTO observation_eras (id, name, mode, parser_version, capabilities_json, starts_at)
    VALUES ('era:test', 'test', 'historical-backfill', 'test-v1', '[]', '2026-07-21T00:00:00Z')`).run();
  db.prepare(`INSERT INTO projects (id, name, path, last_activity, session_count)
    VALUES ('project-test', 'test-project', '/test', '2026-07-21T00:00:00Z', 1)`).run();
  db.prepare(`INSERT INTO sessions (
    id, project_id, project_name, project_path, started_at, ended_at,
    message_count, source_tool, generated_title
  ) VALUES (
    'codex:thread-root', 'project-test', 'test-project', '/test',
    '2026-07-21T00:00:00Z', '2026-07-21T01:00:00Z', 5, 'codex-cli',
    '实现交付映射'
  )`).run();
  db.prepare(`INSERT INTO work_tasks (
    id, root_task_id, parent_task_id, thread_id, role, status, started_at, era_id
  ) VALUES ('task-root', 'task-root', NULL, 'thread-root', 'root', 'running', '2026-07-21T00:00:00Z', 'era:test')`).run();
  const message = db.prepare(`INSERT INTO messages
    (id, session_id, type, content, tool_calls, tool_results, timestamp)
    VALUES (?, 'codex:thread-root', ?, ?, '[]', '[]', ?)`);
  message.run('message-user', 'user', '实现交付映射', '2026-07-21T00:00:01Z');
  message.run('message-assistant', 'assistant', '已经完成', '2026-07-21T00:01:00Z');
});

afterEach(() => {
  closeDb();
  delete process.env.AGENT_ANALYTICS_CONFIG_DIR;
  rmSync(dataDir, { recursive: true, force: true });
});

describe('work task API', () => {
  it('lists roots and returns an evidence-only task detail', async () => {
    getDb().prepare(`INSERT INTO analysis_usage
      (session_id, analysis_type, provider, model, analyzed_at)
      VALUES ('codex:thread-root', 'session', 'codex-native', 'codex-default', '2026-07-21T02:00:00Z')`).run();
    const app = createApp();
    const list = await app.request('/api/tasks');
    const detail = await app.request('/api/tasks/task-root');
    expect(list.status).toBe(200);
    expect(await list.json()).toMatchObject({
      tasks: [{ id: 'task-root', role: 'root', sessionTitle: '实现交付映射', analysisStatus: 'analyzed', analyzedAt: '2026-07-21T02:00:00Z' }],
      total: 1,
    });
    expect(detail.status).toBe(200);
    expect(await detail.json()).toEqual({
      task: {
        id: 'task-root',
        nodes: [expect.objectContaining({ id: 'task-root', parentTaskId: null })],
        events: [], tokenDeltas: [],
        coverage: { discovered: 0, parsed: 0, skipped: 0, failed: 0, unknown: 0 },
        diagnostics: [],
        sessionId: 'codex:thread-root',
        analysisStatus: 'analyzed',
        analyzedAt: '2026-07-21T02:00:00Z',
        deliveries: [],
      },
    });
  });

  it('returns 404 for an unknown root', async () => {
    expect((await createApp().request('/api/tasks/missing')).status).toBe(404);
  });

  it('does not list a task whose projected counters have no real conversation rows', async () => {
    getDb().prepare(`DELETE FROM messages WHERE session_id = 'codex:thread-root'`).run();
    const response = await createApp().request('/api/tasks');
    expect(await response.json()).toEqual({ tasks: [], total: 0 });
  });
});
