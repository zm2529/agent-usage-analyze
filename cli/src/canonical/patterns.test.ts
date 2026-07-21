import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { runMigrations } from '../db/migrate.js';
import { comparePatternWindows, type TrendState } from './patterns.js';

const PREVIOUS = ['2026-07-07T00:00:00.000Z', '2026-07-14T00:00:00.000Z'] as const;
const CURRENT = ['2026-07-14T00:00:00.000Z', '2026-07-21T00:00:00.000Z'] as const;

function setup(): Database.Database {
  const db = new Database(':memory:');
  runMigrations(db);
  db.prepare(`INSERT INTO observation_eras (id, name, mode, parser_version, capabilities_json, starts_at)
    VALUES ('era', 'era', 'historical-backfill', 'v1', '["task-tree"]', '2026-07-01T00:00:00.000Z')`).run();
  db.prepare(`INSERT INTO source_artifacts (id, source_kind, parser_version, locator_hash, observed_at, era_id)
    VALUES ('source', 'codex-rollout', 'v1', 'sha256:source', '2026-07-01T00:00:00.000Z', 'era')`).run();
  db.prepare(`INSERT INTO source_ingestion_stats
    (source_artifact_id, discovered_count, parsed_count, skipped_count, failed_count, unknown_count)
    VALUES ('source', 1, 100, 0, 0, 0)`).run();
  return db;
}

function task(db: Database.Database, id: string, startedAt: string, withPattern: boolean): void {
  db.prepare(`INSERT INTO work_tasks
    (id, root_task_id, thread_id, role, status, started_at, ended_at, era_id)
    VALUES (?, ?, ?, 'root', 'completed', ?, ?, 'era')`).run(id, id, id, startedAt, startedAt);
  db.prepare(`INSERT INTO canonical_events
    (id, source_artifact_id, era_id, native_event_id, sequence, occurred_at, kind, actor,
     sensitivity, payload_json, task_id, thread_id, parser_version)
    VALUES (?, 'source', 'era', ?, 0, ?, 'session-meta', 'system', 'metadata',
      '{"taskRole":"root"}', ?, ?, 'v1')`).run(`${id}:meta`, `${id}:meta`, startedAt, id, id);
  if (!withPattern) return;
  db.prepare(`INSERT INTO canonical_events
    (id, source_artifact_id, era_id, native_event_id, sequence, occurred_at, kind, actor,
     sensitivity, payload_json, task_id, thread_id, parser_version)
    VALUES (?, 'source', 'era', ?, 1, ?, 'file-change', 'tool', 'metadata',
      '{"changeType":"modified","pathHash":"path"}', ?, ?, 'v1')`)
    .run(`${id}:change`, `${id}:change`, startedAt, id, id);
  db.prepare(`INSERT INTO canonical_events
    (id, source_artifact_id, era_id, native_event_id, sequence, occurred_at, kind, actor,
     sensitivity, payload_json, task_id, thread_id, parser_version)
    VALUES (?, 'source', 'era', ?, 2, ?, 'task-completed', 'system', 'structural',
      '{"status":"completed","reason":"normal"}', ?, ?, 'v1')`)
    .run(`${id}:done`, `${id}:done`, startedAt, id, id);
}

function event(
  db: Database.Database,
  taskId: string,
  id: string,
  kind: string,
  occurredAt: string,
  payload: Record<string, unknown> = {},
  options: { parentEventId?: string; repoRoot?: string; worktreePath?: string; turnId?: string } = {},
): void {
  db.prepare(`INSERT INTO canonical_events (
    id, source_artifact_id, era_id, native_event_id, sequence, occurred_at, kind, actor,
    sensitivity, payload_json, parent_event_id, task_id, thread_id, parser_version,
    repo_root, worktree_path, turn_id
  ) VALUES (?, 'source', 'era', ?, 50, ?, ?, 'system', 'metadata', ?, ?, ?, ?, 'v1', ?, ?, ?)`)
    .run(id, id, occurredAt, kind, JSON.stringify(payload), options.parentEventId ?? null,
      taskId, taskId, options.repoRoot ?? null, options.worktreePath ?? null, options.turnId ?? null);
}

function classification(previousCount: number, currentCount: number): { state: TrendState; change: number | null } {
  const db = setup();
  for (let index = 0; index < 2; index += 1) {
    task(db, `p${index}`, `2026-07-${String(8 + index).padStart(2, '0')}T00:00:00.000Z`, index < previousCount);
    task(db, `c${index}`, `2026-07-${String(15 + index).padStart(2, '0')}T00:00:00.000Z`, index < currentCount);
  }
  const comparison = comparePatternWindows(db, { currentStart: CURRENT[0], currentEnd: CURRENT[1] });
  const trend = comparison.trends.find((item) => item.pattern === 'validation-missing')!;
  db.close();
  return { state: trend.state, change: trend.change };
}

describe('era-aware deterministic pattern comparison', () => {
  it('classifies new, persistent, improving, regressed, and resolved equal-window trends', () => {
    expect(classification(0, 1)).toEqual({ state: 'new', change: 0.5 });
    expect(classification(1, 1)).toEqual({ state: 'persistent', change: 0 });
    expect(classification(2, 1)).toEqual({ state: 'improving', change: -0.5 });
    expect(classification(1, 2)).toEqual({ state: 'regressed', change: 0.5 });
    expect(classification(1, 0)).toEqual({ state: 'resolved', change: -0.5 });
  });

  it('returns incomparable instead of direction when samples are insufficient', () => {
    const db = setup();
    task(db, 'previous', '2026-07-10T00:00:00.000Z', true);
    task(db, 'current', '2026-07-17T00:00:00.000Z', true);
    const trend = comparePatternWindows(db, { currentStart: CURRENT[0], currentEnd: CURRENT[1] })
      .trends.find((item) => item.pattern === 'validation-missing');
    expect(trend).toMatchObject({ state: 'incomparable', unknownReason: 'insufficient-sample' });
    db.close();
  });

  it('persists evidence-closed claims with version, coverage, confidence, samples, and era compatibility', () => {
    const db = setup();
    task(db, 'p0', '2026-07-10T00:00:00.000Z', false);
    task(db, 'p1', '2026-07-11T00:00:00.000Z', false);
    task(db, 'c0', '2026-07-17T00:00:00.000Z', true);
    task(db, 'c1', '2026-07-18T00:00:00.000Z', false);
    const trend = comparePatternWindows(db, { currentStart: CURRENT[0], currentEnd: CURRENT[1] })
      .trends.find((item) => item.pattern === 'validation-missing');
    expect(trend?.current).toMatchObject({
      sourceCategory: 'deterministic', algorithmVersion: 'deterministic-patterns-v1',
      sampleCount: 1, totalTaskCount: 2, coverage: 1, eraCompatibility: 'compatible',
      sampleTaskRefs: ['c0'],
    });
    expect(trend?.current?.evidenceRefs[0]).toMatch(/^evidence:/);
    expect(trend?.current?.evidence[0]?.factRefs).toEqual(['c0:change', 'c0:done']);
    expect(trend?.current?.confidence).toBeGreaterThan(0);
    expect(db.prepare('SELECT COUNT(*) AS count FROM analysis_claims').get()).toEqual({ count: 1 });
    expect(db.prepare('SELECT COUNT(*) AS count FROM evidence_records').get()).toEqual({ count: 1 });
    db.close();
  });

  it('detects all six observable patterns without judging user ability or intent', () => {
    const db = setup();
    task(db, 'p0', '2026-07-10T00:00:00.000Z', false);
    task(db, 'p1', '2026-07-11T00:00:00.000Z', false);
    task(db, 'c0', '2026-07-17T00:00:00.000Z', true);
    task(db, 'c1', '2026-07-18T00:00:00.000Z', false);
    event(db, 'c0', 'c0:change-again', 'file-change', '2026-07-17T00:01:00.000Z', { pathHash: 'path', changeType: 'modified' });
    event(db, 'c0', 'c0:call', 'tool-call', '2026-07-17T00:02:00.000Z', { toolName: 'shell', callId: 'wait' });
    event(db, 'c0', 'c0:result', 'tool-result', '2026-07-17T00:03:01.000Z', {}, { parentEventId: 'c0:call' });
    event(db, 'c0', 'c0:repo-a', 'turn-context', '2026-07-17T00:04:00.000Z', {}, { repoRoot: '/a', worktreePath: '/a' });
    event(db, 'c0', 'c0:repo-b', 'turn-context', '2026-07-17T00:05:00.000Z', {}, { repoRoot: '/b', worktreePath: '/b' });
    event(db, 'c0', 'c0:constraint', 'user-message', '2026-07-17T00:06:00.000Z', { constraintKind: 'scope-change' });
    event(db, 'c0', 'c0:failed-1', 'task-status', '2026-07-17T00:07:00.000Z', { status: 'failed' }, { turnId: 'turn-1' });
    event(db, 'c0', 'c0:failed-2', 'task-status', '2026-07-17T00:08:00.000Z', { status: 'failed' }, { turnId: 'turn-2' });

    const comparison = comparePatternWindows(db, { currentStart: CURRENT[0], currentEnd: CURRENT[1] });
    expect(comparison.trends.map((trend) => [trend.pattern, trend.state])).toEqual([
      ['rework', 'new'], ['waiting', 'new'], ['context-switching', 'new'],
      ['validation-missing', 'new'], ['late-constraint', 'new'], ['repeated-failure', 'new'],
    ]);
    expect(comparison.trends.every((trend) => trend.current && trend.current.evidenceRefs.length > 0)).toBe(true);
    expect(JSON.stringify(comparison)).not.toMatch(/ability|intent/i);
    db.close();
  });

  it('marks compatible era changes limited and capability or mode changes incomparable', () => {
    const db = setup();
    db.prepare(`INSERT INTO observation_eras (id, name, mode, parser_version, capabilities_json, starts_at)
      VALUES ('era-2', 'era-2', 'historical-backfill', 'v1', '["task-tree"]', '2026-07-14T00:00:00.000Z')`).run();
    db.prepare(`INSERT INTO source_artifacts (id, source_kind, parser_version, locator_hash, observed_at, era_id)
      VALUES ('source-2', 'codex-rollout', 'v1', 'sha256:source-2', '2026-07-14T00:00:00.000Z', 'era-2')`).run();
    db.prepare(`INSERT INTO source_ingestion_stats
      (source_artifact_id, discovered_count, parsed_count, skipped_count, failed_count, unknown_count)
      VALUES ('source-2', 1, 100, 0, 0, 0)`).run();
    for (const [id, date] of [['p0', '2026-07-10'], ['p1', '2026-07-11'], ['c0', '2026-07-17'], ['c1', '2026-07-18']] as const) {
      task(db, id, `${date}T00:00:00.000Z`, true);
    }
    db.prepare(`UPDATE work_tasks SET era_id = 'era-2' WHERE id IN ('c0', 'c1')`).run();
    expect(comparePatternWindows(db, { currentStart: CURRENT[0], currentEnd: CURRENT[1] }).eraCompatibility).toBe('limited');
    db.prepare(`UPDATE observation_eras SET mode = 'continuous-observation' WHERE id = 'era-2'`).run();
    const comparison = comparePatternWindows(db, { currentStart: CURRENT[0], currentEnd: CURRENT[1] });
    expect(comparison.eraCompatibility).toBe('incomparable');
    expect(comparison.trends.every((trend) => trend.state === 'incomparable'
      && trend.unknownReason === 'era-incompatible')).toBe(true);
    db.close();
  });

  it('treats window boundaries as half-open and refuses low-coverage direction', () => {
    const db = setup();
    task(db, 'p-start', PREVIOUS[0], true);
    task(db, 'p-end', PREVIOUS[1], true);
    task(db, 'c-inside', '2026-07-20T23:59:59.000Z', true);
    task(db, 'c-end', CURRENT[1], true);
    db.prepare(`INSERT INTO source_artifacts (id, source_kind, parser_version, locator_hash, observed_at, era_id)
      VALUES ('source-low', 'codex-rollout', 'v1', 'sha256:low', '2026-07-14T00:00:00.000Z', 'era')`).run();
    db.prepare(`INSERT INTO source_ingestion_stats
      (source_artifact_id, discovered_count, parsed_count, skipped_count, failed_count, unknown_count)
      VALUES ('source-low', 1, 1, 0, 9, 0)`).run();
    db.prepare(`UPDATE canonical_events SET source_artifact_id = 'source-low'
      WHERE task_id IN ('p-end', 'c-inside', 'c-end')`).run();
    const comparison = comparePatternWindows(db, { currentStart: CURRENT[0], currentEnd: CURRENT[1], minSampleSize: 1 });
    expect(comparison.previousWindow.taskCount).toBe(1);
    expect(comparison.currentWindow.taskCount).toBe(2);
    expect(comparison.currentWindow.coverage).toBe(0.1);
    expect(comparison.trends.every((trend) => trend.state === 'incomparable'
      && trend.unknownReason === 'insufficient-coverage')).toBe(true);
    expect(comparison.trends.every((trend) => trend.change === null)).toBe(true);
    db.close();
  });

  it('content-addresses claim changes and abstains when opposing evidence exists', () => {
    const db = setup();
    for (const [id, date] of [['p0', '2026-07-10'], ['p1', '2026-07-11'], ['c0', '2026-07-17'], ['c1', '2026-07-18']] as const) {
      task(db, id, `${date}T00:00:00.000Z`, true);
    }
    const first = comparePatternWindows(db, { currentStart: CURRENT[0], currentEnd: CURRENT[1] });
    const firstClaim = first.trends.find((trend) => trend.pattern === 'validation-missing')!.current!;
    db.prepare(`UPDATE source_ingestion_stats SET failed_count = 10 WHERE source_artifact_id = 'source'`).run();
    const second = comparePatternWindows(db, { currentStart: CURRENT[0], currentEnd: CURRENT[1], minCoverage: 0 });
    const secondClaim = second.trends.find((trend) => trend.pattern === 'validation-missing')!.current!;
    expect(secondClaim.id).not.toBe(firstClaim.id);
    expect(secondClaim.evidenceRefs[0]).not.toBe(firstClaim.evidenceRefs[0]);

    db.prepare(`INSERT INTO evidence_records (
      id, evidence_type, subject_ref, position, source_category, algorithm_version,
      coverage, confidence, era_compatibility, era_ids_json, human_status, fact_refs_json
    ) VALUES ('opposes', 'human-review', ?, 'opposes', 'human-corrected', 'human-v1',
      1, 1, 'compatible', '["era"]', 'confirmed', '[{"eventId":"c0:change","taskId":"c0"}]')`)
      .run(`pattern:validation-missing:${CURRENT[0]}:${CURRENT[1]}`);
    const conflicted = comparePatternWindows(db, { currentStart: CURRENT[0], currentEnd: CURRENT[1], minCoverage: 0 })
      .trends.find((trend) => trend.pattern === 'validation-missing');
    expect(conflicted).toMatchObject({
      state: 'incomparable', change: null, unknownReason: 'conflicting-evidence', current: null,
    });
    expect(conflicted?.conflictingEvidence).toEqual([
      expect.objectContaining({ id: 'opposes', position: 'opposes', factRefs: ['c0:change'] }),
    ]);
    db.close();
  });

  it('does not treat status messages or parallel subagent contexts as late constraints or switching', () => {
    const db = setup();
    task(db, 'p0', '2026-07-10T00:00:00.000Z', false);
    task(db, 'p1', '2026-07-11T00:00:00.000Z', false);
    task(db, 'c0', '2026-07-17T00:00:00.000Z', true);
    task(db, 'c1', '2026-07-18T00:00:00.000Z', false);
    event(db, 'c0', 'c0:status-question', 'user-message', '2026-07-17T00:06:00.000Z');
    db.prepare(`INSERT INTO work_tasks
      (id, root_task_id, parent_task_id, thread_id, role, status, started_at, ended_at, era_id)
      VALUES ('child', 'c0', 'c0', 'child', 'subagent', 'completed',
        '2026-07-17T00:01:00.000Z', '2026-07-17T00:02:00.000Z', 'era')`).run();
    event(db, 'c0', 'c0:root-context', 'turn-context', '2026-07-17T00:01:00.000Z', {}, { repoRoot: '/root', worktreePath: '/root' });
    event(db, 'child', 'child:context', 'turn-context', '2026-07-17T00:01:30.000Z', {}, { repoRoot: '/child', worktreePath: '/child' });

    const patterns = comparePatternWindows(db, { currentStart: CURRENT[0], currentEnd: CURRENT[1] }).trends
      .map((trend) => trend.pattern);
    expect(patterns).not.toContain('late-constraint');
    expect(patterns).not.toContain('context-switching');
    db.close();
  });
});
