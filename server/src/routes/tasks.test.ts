import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { closeDb, getDb } from '@agent-analytics/cli/db/client';
import { createApp } from '../index.js';

let dataDir: string;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'agent-analytics-tasks-api-'));
  process.env.AGENT_ANALYTICS_CONFIG_DIR = dataDir;
  const db = getDb();
  db.prepare(`INSERT INTO observation_eras (id, name, mode, parser_version, capabilities_json, starts_at)
    VALUES ('era:test', 'test', 'historical-backfill', 'test-v1', '[]', '2026-07-21T00:00:00Z')`).run();
  db.prepare(`INSERT INTO work_tasks (
    id, root_task_id, parent_task_id, thread_id, role, status, started_at, era_id
  ) VALUES ('task-root', 'task-root', NULL, 'thread-root', 'root', 'running', '2026-07-21T00:00:00Z', 'era:test')`).run();
});

afterEach(() => {
  closeDb();
  delete process.env.AGENT_ANALYTICS_CONFIG_DIR;
  rmSync(dataDir, { recursive: true, force: true });
});

describe('work task API', () => {
  it('lists roots and returns an evidence-only task detail', async () => {
    const app = createApp();
    const list = await app.request('/api/tasks');
    const detail = await app.request('/api/tasks/task-root');
    expect(list.status).toBe(200);
    expect(await list.json()).toMatchObject({ tasks: [{ id: 'task-root', role: 'root' }] });
    expect(detail.status).toBe(200);
    expect(await detail.json()).toEqual({
      task: {
        id: 'task-root',
        nodes: [expect.objectContaining({ id: 'task-root', parentTaskId: null })],
        events: [], tokenDeltas: [],
        coverage: { discovered: 0, parsed: 0, skipped: 0, failed: 0, unknown: 0 },
        diagnostics: [],
        deliveries: [],
      },
    });
  });

  it('returns 404 for an unknown root', async () => {
    expect((await createApp().request('/api/tasks/missing')).status).toBe(404);
  });
});
