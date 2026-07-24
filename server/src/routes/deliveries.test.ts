import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { closeDb, getDb } from 'agent-usage-analyze/db/client';
import { createApp } from '../index.js';

let dataDir: string;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'agent-analytics-deliveries-api-'));
  process.env.AGENT_ANALYTICS_CONFIG_DIR = dataDir;
  const db = getDb();
  db.prepare(`INSERT INTO observation_eras (id, name, mode, parser_version, capabilities_json, starts_at)
    VALUES ('era', 'era', 'historical-backfill', 'v1', '[]', '2026-07-21T00:00:00.000Z')`).run();
  db.prepare(`INSERT INTO work_tasks
    (id, root_task_id, thread_id, role, status, started_at, ended_at, era_id)
    VALUES ('task', 'task', 'task', 'root', 'completed',
      '2026-07-21T08:00:00.000Z', '2026-07-21T08:30:00.000Z', 'era')`).run();
  db.prepare(`INSERT INTO deliveries
    (id, kind, repository_identity, result_identity, occurred_at, metadata_json)
    VALUES ('delivery', 'git-commit', 'repository:sha256:test', 'abc123',
      '2026-07-21T08:10:00.000Z', '{}')`).run();
  db.prepare(`INSERT INTO task_delivery_candidates
    (id, task_id, delivery_id, algorithm_version, coverage, confidence, machine_status)
    VALUES ('candidate', 'task', 'delivery', 'task-delivery-v1', 1, 0.4, 'candidate')`).run();
  db.prepare(`INSERT INTO evidence_records
    (id, evidence_type, subject_ref, position, source_category, algorithm_version,
     coverage, confidence, era_compatibility, era_ids_json, human_status, fact_refs_json)
    VALUES ('machine', 'temporal-proximity', 'candidate', 'supports', 'deterministic',
      'task-delivery-v1', 1, 0.15, 'compatible', '["era"]', 'unreviewed',
      '[{"deliveryId":"delivery","taskId":"task"}]')`).run();
});

afterEach(() => {
  closeDb();
  delete process.env.AGENT_ANALYTICS_CONFIG_DIR;
  rmSync(dataDir, { recursive: true, force: true });
});

describe('deliveries API', () => {
  it('drills from deliveries to task evidence and from tasks back to deliveries', async () => {
    const app = createApp();
    const list = await app.request('/api/deliveries');
    const detail = await app.request('/api/deliveries/delivery');
    const task = await app.request('/api/tasks/task');

    expect(await list.json()).toMatchObject({ deliveries: [{ id: 'delivery', resultIdentity: 'abc123' }] });
    expect(await detail.json()).toMatchObject({ delivery: {
      id: 'delivery', candidates: [{ id: 'candidate', taskId: 'task', status: 'candidate',
        evidence: [{ id: 'machine', position: 'supports' }] }],
    } });
    expect(await task.json()).toMatchObject({ task: {
      id: 'task', deliveries: [{ id: 'candidate', delivery: { id: 'delivery' } }],
    } });
  });

  it('hides results that have no usable task association', async () => {
    getDb().prepare(`INSERT INTO deliveries
      (id, kind, repository_identity, result_identity, occurred_at, metadata_json)
      VALUES ('unlinked', 'git-commit', 'repository:sha256:test', 'deadbeef',
        '2026-07-21T09:00:00.000Z', '{}')`).run();
    const list = await createApp().request('/api/deliveries');
    expect(await list.json()).toEqual({ deliveries: [expect.objectContaining({ id: 'delivery' })] });
    expect((await createApp().request('/api/deliveries/unlinked')).status).toBe(404);
  });

  it('appends a validated correction and preserves machine evidence', async () => {
    const response = await createApp().request('/api/deliveries/delivery/candidates/candidate/corrections', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision: 'confirmed' }),
    });
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ candidate: {
      id: 'candidate', status: 'confirmed', evidence: [
        { id: 'machine', sourceCategory: 'deterministic' },
        { evidenceType: 'human-confirmation', sourceCategory: 'human-corrected' },
      ],
    } });
    expect(getDb().prepare(`SELECT COUNT(*) AS count FROM evidence_records`).get()).toEqual({ count: 2 });
  });

  it('rejects invalid correction decisions without appending evidence', async () => {
    const response = await createApp().request('/api/deliveries/delivery/candidates/candidate/corrections', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision: 'maybe' }),
    });
    expect(response.status).toBe(400);
    expect(getDb().prepare(`SELECT COUNT(*) AS count FROM evidence_records`).get()).toEqual({ count: 1 });
  });

  it('offers explicit local discovery without exposing repository paths', async () => {
    const response = await createApp().request('/api/deliveries/discover', { method: 'POST' });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ repositories: 0, deliveries: 0, failed: 0 });
    expect(JSON.stringify(body)).not.toMatch(/repoRoot|repositoryPath/);
  });

  it('records a task-scoped local artifact through a relative-path API without returning local paths', async () => {
    const repositoryPath = join(dataDir, 'repository');
    mkdirSync(repositoryPath);
    execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: repositoryPath });
    mkdirSync(join(repositoryPath, 'build'));
    writeFileSync(join(repositoryPath, 'build', 'app.bundle'), 'artifact');
    getDb().prepare(`UPDATE work_tasks SET repo_root = ?, worktree_path = ? WHERE id = 'task'`)
      .run(repositoryPath, repositoryPath);

    const response = await createApp().request('/api/deliveries/artifacts', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ taskId: 'task', relativePath: 'build/app.bundle' }),
    });
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body).toMatchObject({ delivery: { kind: 'local-artifact' }, candidate: { taskId: 'task', status: 'candidate' } });
    expect(JSON.stringify(body)).not.toContain(repositoryPath);
  });
});
