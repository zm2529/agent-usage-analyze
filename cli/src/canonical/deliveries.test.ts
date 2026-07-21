import Database from 'better-sqlite3';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runMigrations } from '../db/migrate.js';
import { rebuildTaskProjection } from './tasks.js';
import {
  appendCandidateCorrection,
  discoverRepositoryDeliveries,
  discoverCanonicalTestRunDeliveries,
  listDeliveries,
  recordLocalArtifactDelivery,
  readDeliveryDetail,
  readTaskDeliveries,
} from './deliveries.js';

const created: string[] = [];

function disposableRepository(): string {
  const repositoryPath = mkdtempSync(join(tmpdir(), 'agent-analytics-delivery-'));
  created.push(repositoryPath);
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: repositoryPath });
  execFileSync('git', ['config', 'user.name', 'Delivery Test'], { cwd: repositoryPath });
  execFileSync('git', ['config', 'user.email', 'delivery@example.invalid'], { cwd: repositoryPath });
  execFileSync('git', ['config', 'commit.gpgSign', 'false'], { cwd: repositoryPath });
  execFileSync('git', ['config', 'core.hooksPath', '/dev/null'], { cwd: repositoryPath });
  return repositoryPath;
}

function commit(repositoryPath: string, content: string, message: string, timestamp = '2026-07-21T08:00:00Z'): string {
  writeFileSync(join(repositoryPath, 'result.txt'), content);
  execFileSync('git', ['add', 'result.txt'], { cwd: repositoryPath });
  execFileSync('git', ['commit', '-q', '-m', message], {
    cwd: repositoryPath,
    env: { ...process.env, GIT_AUTHOR_DATE: timestamp, GIT_COMMITTER_DATE: timestamp },
  });
  return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repositoryPath, encoding: 'utf8' }).trim();
}

afterEach(() => {
  for (const path of created.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe('delivery evidence', () => {
  it('keeps rewritten Git commits as distinct immutable deliveries', () => {
    const repositoryPath = disposableRepository();
    const db = new Database(':memory:');
    runMigrations(db);
    const originalOid = commit(repositoryPath, 'one', 'first result');

    discoverRepositoryDeliveries(db, { repositoryPath });
    writeFileSync(join(repositoryPath, 'result.txt'), 'two');
    execFileSync('git', ['add', 'result.txt'], { cwd: repositoryPath });
    execFileSync('git', ['commit', '--amend', '-q', '-m', 'rewritten result'], {
      cwd: repositoryPath,
      env: { ...process.env, GIT_AUTHOR_DATE: '2026-07-21T08:01:00Z', GIT_COMMITTER_DATE: '2026-07-21T08:01:00Z' },
    });
    const rewrittenOid = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repositoryPath, encoding: 'utf8' }).trim();
    discoverRepositoryDeliveries(db, { repositoryPath });

    expect(rewrittenOid).not.toBe(originalOid);
    expect(listDeliveries(db).map((delivery) => [delivery.kind, delivery.resultIdentity])).toEqual([
      ['git-commit', rewrittenOid],
      ['git-commit', originalOid],
    ]);
    db.close();
  });

  it('keeps task-delivery links many-to-many and abstains on message plus time evidence alone', () => {
    const repositoryPath = disposableRepository();
    const db = new Database(':memory:');
    runMigrations(db);
    db.prepare(`INSERT INTO observation_eras
      (id, name, mode, parser_version, capabilities_json, starts_at)
      VALUES ('era', 'era', 'historical-backfill', 'v1', '[]', '2026-07-21T00:00:00.000Z')`).run();
    const insertTask = db.prepare(`INSERT INTO work_tasks
      (id, root_task_id, thread_id, role, status, started_at, ended_at, era_id,
       repo_root, worktree_path, git_branch)
      VALUES (?, ?, ?, 'root', 'completed', ?, ?, 'era', ?, ?, 'main')`);
    insertTask.run('task-a', 'task-a', 'task-a', '2026-07-21T08:00:00.000Z', '2026-07-21T08:30:00.000Z', repositoryPath, repositoryPath);
    insertTask.run('task-b', 'task-b', 'task-b', '2026-07-21T08:15:00.000Z', '2026-07-21T08:25:00.000Z', repositoryPath, repositoryPath);
    db.prepare(`UPDATE work_tasks SET git_branch = 'feature/other' WHERE id = 'task-b'`).run();
    insertTask.run('task-without-delivery', 'task-without-delivery', 'task-without-delivery',
      '2026-07-21T09:00:00.000Z', '2026-07-21T09:10:00.000Z', repositoryPath, repositoryPath);
    db.prepare(`INSERT INTO source_artifacts
      (id, source_kind, parser_version, locator_hash, observed_at, era_id)
      VALUES ('source', 'codex-rollout', 'v1', 'sha256:source', '2026-07-21T08:00:00.000Z', 'era')`).run();
    db.prepare(`INSERT INTO source_ingestion_stats
      (source_artifact_id, discovered_count, parsed_count, skipped_count, failed_count, unknown_count)
      VALUES ('source', 1, 10, 0, 0, 2)`).run();
    const insertEvent = db.prepare(`INSERT INTO canonical_events
      (id, source_artifact_id, era_id, native_event_id, sequence, occurred_at, kind,
       actor, sensitivity, payload_json, task_id, thread_id, parser_version)
      VALUES (?, 'source', 'era', ?, ?, ?, 'session-meta', 'system', 'metadata', '{}', ?, ?, 'v1')`);
    insertEvent.run('event-a', 'event-a', 1, '2026-07-21T08:00:00.000Z', 'task-a', 'task-a');
    insertEvent.run('event-b', 'event-b', 2, '2026-07-21T08:15:00.000Z', 'task-b', 'task-b');
    insertEvent.run('event-none', 'event-none', 3, '2026-07-21T09:00:00.000Z', 'task-without-delivery', 'task-without-delivery');
    const firstOid = commit(repositoryPath, 'one', 'result for task-a', '2026-07-21T08:10:00Z');
    const sharedOid = commit(repositoryPath, 'two', 'shared result task-a task-b', '2026-07-21T08:20:00Z');

    discoverRepositoryDeliveries(db, { repositoryPath });
    const taskA = readTaskDeliveries(db, 'task-a');
    const taskB = readTaskDeliveries(db, 'task-b');

    expect(taskA.map((candidate) => candidate.delivery.resultIdentity)).toEqual([sharedOid, firstOid]);
    expect(taskB.map((candidate) => candidate.delivery.resultIdentity)).toEqual([sharedOid]);
    expect(readTaskDeliveries(db, 'task-without-delivery')).toEqual([]);
    expect(taskA.every((candidate) => candidate.status === 'abstained'
      && candidate.algorithmVersion === 'task-delivery-v1'
      // Unknown events are already included in parsed_count, so known coverage is 8 / 10.
      && candidate.coverage === 0.8
      && candidate.confidence <= 0.5)).toBe(true);
    expect(taskA[0]?.evidence.map((record) => [record.evidenceType, record.position])).toEqual([
      ['repository-scope-match', 'supports'],
      ['temporal-proximity', 'supports'],
      ['commit-message-task-reference', 'supports'],
    ]);
    expect(taskA[0]?.evidence.every((record) => record.coverage === 0.8
      && record.eraCompatibility === 'compatible' && record.eraIds[0] === 'era')).toBe(true);
    expect(readDeliveryDetail(db, taskA[0]!.delivery.id)?.candidates.map((candidate) => candidate.taskId))
      .toEqual(['task-a', 'task-b']);
    expect(taskB[0]?.evidence).toEqual(expect.arrayContaining([
      expect.objectContaining({ evidenceType: 'branch-mismatch', position: 'opposes' }),
    ]));
    db.close();
  });

  it('records directly observed test runs and local artifacts as strong task candidates', () => {
    const repositoryPath = disposableRepository();
    commit(repositoryPath, 'source', 'baseline');
    const db = new Database(':memory:');
    runMigrations(db);
    db.prepare(`INSERT INTO observation_eras
      (id, name, mode, parser_version, capabilities_json, starts_at)
      VALUES ('era', 'era', 'continuous-observation', 'v2', '["validation-kind"]', '2026-07-21T00:00:00.000Z')`).run();
    db.prepare(`INSERT INTO source_artifacts
      (id, source_kind, parser_version, locator_hash, observed_at, era_id)
      VALUES ('source', 'codex-rollout', 'v2', 'sha256:source', '2026-07-21T08:00:00.000Z', 'era')`).run();
    db.prepare(`INSERT INTO work_tasks
      (id, root_task_id, thread_id, role, status, started_at, ended_at, era_id,
       repo_root, worktree_path, git_branch)
      VALUES ('task', 'task', 'task', 'root', 'completed',
        '2026-07-21T08:00:00.000Z', '2026-07-21T08:30:00.000Z', 'era', ?, ?, 'main')`)
      .run(repositoryPath, repositoryPath);
    db.prepare(`INSERT INTO canonical_events
      (id, source_artifact_id, era_id, native_event_id, sequence, occurred_at, kind,
       actor, sensitivity, payload_json, task_id, thread_id, parser_version)
      VALUES ('call', 'source', 'era', 'call', 1, '2026-07-21T08:10:00.000Z',
        'tool-call', 'assistant', 'metadata', '{"toolName":"shell","callId":"validation","validationKind":"test"}',
        'task', 'task', 'v2')`).run();
    db.prepare(`INSERT INTO source_ingestion_stats
      (source_artifact_id, discovered_count, parsed_count, skipped_count, failed_count, unknown_count)
      VALUES ('source', 1, 2, 0, 0, 0)`).run();
    db.prepare(`INSERT INTO canonical_events
      (id, source_artifact_id, era_id, native_event_id, sequence, occurred_at, kind,
       actor, sensitivity, payload_json, parent_event_id, task_id, thread_id, parser_version)
      VALUES ('result', 'source', 'era', 'result', 2, '2026-07-21T08:11:00.000Z',
        'tool-result', 'tool', 'sensitive-content', '{"status":"completed"}', 'call',
        'task', 'task', 'v2')`).run();

    discoverCanonicalTestRunDeliveries(db);
    const artifactPath = join(repositoryPath, 'app.bundle');
    writeFileSync(artifactPath, 'v1');
    const firstArtifact = recordLocalArtifactDelivery(db, { repositoryPath, artifactPath, taskId: 'task', occurredAt: '2026-07-21T08:20:00.000Z' });
    writeFileSync(artifactPath, 'v2');
    const secondArtifact = recordLocalArtifactDelivery(db, { repositoryPath, artifactPath, taskId: 'task', occurredAt: '2026-07-21T08:21:00.000Z' });

    expect(secondArtifact.id).not.toBe(firstArtifact.id);
    const candidates = readTaskDeliveries(db, 'task');
    expect(candidates.map((candidate) => [candidate.delivery.kind, candidate.status])).toEqual([
      ['local-artifact', 'candidate'],
      ['local-artifact', 'candidate'],
      ['test-run', 'candidate'],
    ]);
    expect(candidates.every((candidate) => candidate.evidence.some((record) =>
      ['canonical-validation-result', 'explicit-task-artifact'].includes(record.evidenceType)
        && record.position === 'supports'))).toBe(true);
    expect(JSON.stringify(candidates)).not.toContain(artifactPath);
    db.close();
  });

  it('appends human confirmation, rejection, and pending evidence without replacing machine facts', () => {
    const repositoryPath = disposableRepository();
    const db = new Database(':memory:');
    runMigrations(db);
    db.prepare(`INSERT INTO observation_eras
      (id, name, mode, parser_version, capabilities_json, starts_at)
      VALUES ('era', 'era', 'historical-backfill', 'v1', '[]', '2026-07-21T00:00:00.000Z')`).run();
    db.prepare(`INSERT INTO work_tasks
      (id, root_task_id, thread_id, role, status, started_at, ended_at, era_id,
       repo_root, worktree_path, git_branch)
      VALUES ('task', 'task', 'task', 'root', 'completed',
        '2026-07-21T08:00:00.000Z', '2026-07-21T08:30:00.000Z', 'era', ?, ?, 'main')`)
      .run(repositoryPath, repositoryPath);
    commit(repositoryPath, 'one', 'result for task', '2026-07-21T08:10:00Z');
    discoverRepositoryDeliveries(db, { repositoryPath });
    const candidate = readTaskDeliveries(db, 'task')[0]!;
    const machineEvidenceIds = candidate.evidence.map((record) => record.id);

    appendCandidateCorrection(db, { candidateId: candidate.id, decision: 'confirmed' });
    expect(readTaskDeliveries(db, 'task')[0]?.status).toBe('confirmed');
    appendCandidateCorrection(db, { candidateId: candidate.id, decision: 'rejected' });
    expect(readTaskDeliveries(db, 'task')[0]?.status).toBe('rejected');
    appendCandidateCorrection(db, { candidateId: candidate.id, decision: 'pending' });
    const corrected = readTaskDeliveries(db, 'task')[0]!;

    expect(corrected.status).toBe('pending');
    expect(corrected.evidence.filter((record) => record.sourceCategory === 'human-corrected')
      .map((record) => [record.evidenceType, record.position])).toEqual([
      ['human-confirmation', 'supports'],
      ['human-rejection', 'opposes'],
      ['human-pending', 'limits'],
    ]);
    expect(corrected.evidence.map((record) => record.id)).toEqual(expect.arrayContaining(machineEvidenceIds));
    expect(db.prepare(`SELECT COUNT(*) AS count FROM task_delivery_corrections`).get()).toEqual({ count: 3 });
    db.close();
  });

  it('distinguishes same-content artifact paths and rejects artifacts outside the repository', () => {
    const repositoryPath = disposableRepository();
    commit(repositoryPath, 'source', 'baseline');
    const db = new Database(':memory:');
    runMigrations(db);
    const firstPath = join(repositoryPath, 'first.bundle');
    const secondPath = join(repositoryPath, 'second.bundle');
    writeFileSync(firstPath, 'same bytes');
    writeFileSync(secondPath, 'same bytes');

    const first = recordLocalArtifactDelivery(db, { repositoryPath, artifactPath: firstPath });
    const second = recordLocalArtifactDelivery(db, { repositoryPath, artifactPath: secondPath });
    expect(second.id).not.toBe(first.id);

    const outsideRoot = mkdtempSync(join(tmpdir(), 'agent-analytics-outside-'));
    created.push(outsideRoot);
    const outside = join(outsideRoot, 'private.bin');
    writeFileSync(outside, 'private');
    expect(() => recordLocalArtifactDelivery(db, { repositoryPath, artifactPath: outside }))
      .toThrow('Artifact must be inside the repository');
    db.close();
  });

  it('normalizes remote credentials and SSH or HTTPS transport into one repository identity', () => {
    const httpsRepository = disposableRepository();
    const sshRepository = disposableRepository();
    commit(httpsRepository, 'same', 'same result');
    commit(sshRepository, 'same', 'same result');
    execFileSync('git', ['remote', 'add', 'origin', 'https://secret-token@GitHub.com/Owner/Repo.git'], { cwd: httpsRepository });
    execFileSync('git', ['remote', 'add', 'origin', 'git@github.com:Owner/Repo.git'], { cwd: sshRepository });
    const db = new Database(':memory:');
    runMigrations(db);

    const httpsIdentity = discoverRepositoryDeliveries(db, { repositoryPath: httpsRepository }).repositoryIdentity;
    const sshIdentity = discoverRepositoryDeliveries(db, { repositoryPath: sshRepository }).repositoryIdentity;
    expect(sshIdentity).toBe(httpsIdentity);
    db.close();
  });

  it('preserves task-delivery candidates when the rebuildable task projection refreshes with foreign keys enabled', () => {
    const repositoryPath = disposableRepository();
    commit(repositoryPath, 'result', 'result for task', '2026-07-21T08:10:00Z');
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    db.prepare(`INSERT INTO observation_eras
      (id, name, mode, parser_version, capabilities_json, starts_at)
      VALUES ('era', 'era', 'historical-backfill', 'v1', '[]', '2026-07-21T00:00:00.000Z')`).run();
    db.prepare(`INSERT INTO source_artifacts
      (id, source_kind, parser_version, locator_hash, observed_at, era_id)
      VALUES ('source', 'codex-rollout', 'v1', 'sha256:source', '2026-07-21T08:00:00.000Z', 'era')`).run();
    db.prepare(`INSERT INTO source_ingestion_stats
      (source_artifact_id, discovered_count, parsed_count, skipped_count, failed_count, unknown_count)
      VALUES ('source', 1, 1, 0, 0, 0)`).run();
    db.prepare(`INSERT INTO canonical_events
      (id, source_artifact_id, era_id, native_event_id, sequence, occurred_at, kind,
       actor, sensitivity, payload_json, task_id, thread_id, parser_version,
       repo_root, worktree_path, git_branch)
      VALUES ('meta', 'source', 'era', 'meta', 0, '2026-07-21T08:00:00.000Z',
        'session-meta', 'system', 'metadata', '{"taskRole":"root"}', 'task', 'task', 'v1', ?, ?, 'main')`)
      .run(repositoryPath, repositoryPath);
    rebuildTaskProjection(db);
    discoverRepositoryDeliveries(db, { repositoryPath });
    expect(readTaskDeliveries(db, 'task')).toHaveLength(1);

    expect(() => rebuildTaskProjection(db)).not.toThrow();
    expect(readTaskDeliveries(db, 'task')).toHaveLength(1);
    db.close();
  });
});
