import type Database from 'better-sqlite3';

export class IdentityConflictError extends Error {
  override readonly name = 'IdentityConflictError';
}

export interface WorkTaskNode {
  id: string;
  rootTaskId: string;
  parentTaskId: string | null;
  threadId: string;
  role: string;
  status: string;
  startedAt: string;
  endedAt: string | null;
  repository: { root: string | null; worktree: string | null; branch: string | null };
}

export interface TaskTokenDelta {
  eventId: string;
  taskId: string;
  laneKey: string;
  segment: number;
  status: 'known' | 'unknown-baseline' | 'unknown-reset' | 'unknown-out-of-order' | 'unknown-missing';
  inputTokens: number | null;
  cachedInputTokens: number | null;
  cacheCreationTokens: number | null;
  outputTokens: number | null;
  reasoningTokens: number | null;
  compactionTokens: number | null;
}

export interface WorkTaskDetail {
  id: string;
  nodes: WorkTaskNode[];
  events: Array<{
    id: string;
    sourceArtifactId: string;
    sequence: number;
    kind: string;
    actor: string;
    sensitivity: string;
    occurredAt: string;
    taskId: string | null;
    threadId: string | null;
    turnId: string | null;
    attempt: number | null;
    generation: number | null;
    payloadRef: string | null;
  }>;
  tokenDeltas: TaskTokenDelta[];
  coverage: { discovered: number; parsed: number; skipped: number; failed: number; unknown: number };
  diagnostics: Array<{ severity: string; code: string; count: number }>;
}

interface EventRow {
  id: string;
  sourceArtifactId: string;
  taskId: string;
  threadId: string;
  turnId: string | null;
  eraId: string;
  occurredAt: string;
  kind: string;
  payloadJson: string;
  generation: number | null;
  attempt: number | null;
  sequence: number;
  repoRoot: string | null;
  worktreePath: string | null;
  gitBranch: string | null;
}

function payload(row: Pick<EventRow, 'payloadJson'>): Record<string, unknown> {
  try {
    return JSON.parse(row.payloadJson) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function resolveRoot(id: string, parents: Map<string, string>): string {
  const seen = new Set<string>();
  let current = id;
  while (parents.has(current) && !seen.has(current)) {
    seen.add(current);
    current = parents.get(current)!;
  }
  if (seen.has(current)) throw new IdentityConflictError('Task identity contains a parent cycle');
  return current;
}

/** Rebuilds deterministic projections exclusively from canonical facts. */
export function rebuildTaskProjection(db: Database.Database): void {
  db.prepare('DELETE FROM task_token_deltas').run();
  db.prepare('DELETE FROM work_tasks').run();

  const metaEvents = db.prepare(`
    SELECT id, task_id AS taskId, thread_id AS threadId, era_id AS eraId,
           occurred_at AS occurredAt, kind, payload_json AS payloadJson,
           generation, attempt, sequence, repo_root AS repoRoot,
           worktree_path AS worktreePath, git_branch AS gitBranch
    FROM canonical_events
    WHERE kind = 'session-meta' AND task_id IS NOT NULL AND thread_id IS NOT NULL
    ORDER BY occurred_at, source_artifact_id, sequence
  `).all() as EventRow[];
  const parents = new Map<string, string>();
  for (const edge of db.prepare(`
      SELECT from_id AS parentId, to_id AS childId
      FROM canonical_identity_edges WHERE kind = 'root-child'
    `).all() as Array<{ parentId: string; childId: string }>) {
    const prior = parents.get(edge.childId);
    if (prior && prior !== edge.parentId) {
      throw new IdentityConflictError('Task identity has more than one parent');
    }
    parents.set(edge.childId, edge.parentId);
  }
  const statusRows = db.prepare(`
    SELECT task_id AS taskId, kind, occurred_at AS occurredAt, payload_json AS payloadJson
    FROM canonical_events
    WHERE task_id IS NOT NULL AND kind IN ('task-started', 'task-completed', 'task-status')
    ORDER BY occurred_at, sequence
  `).all() as Array<{ taskId: string; kind: string; occurredAt: string; payloadJson: string }>;
  const statuses = new Map<string, { status: string; endedAt: string | null }>();
  for (const row of statusRows) {
    const value = payload(row).status;
    const status = typeof value === 'string'
      ? value
      : row.kind === 'task-completed' ? 'completed' : 'running';
    statuses.set(row.taskId, {
      status,
      endedAt: ['completed', 'failed', 'cancelled', 'aborted'].includes(status) ? row.occurredAt : null,
    });
  }

  const insertTask = db.prepare(`
    INSERT INTO work_tasks (
      id, root_task_id, parent_task_id, thread_id, role, status,
      started_at, ended_at, era_id, repo_root, worktree_path, git_branch
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      root_task_id = excluded.root_task_id,
      parent_task_id = COALESCE(excluded.parent_task_id, work_tasks.parent_task_id),
      role = CASE WHEN work_tasks.role = 'unknown' THEN excluded.role ELSE work_tasks.role END,
      status = excluded.status,
      started_at = MIN(work_tasks.started_at, excluded.started_at),
      ended_at = COALESCE(excluded.ended_at, work_tasks.ended_at),
      repo_root = COALESCE(excluded.repo_root, work_tasks.repo_root),
      worktree_path = COALESCE(excluded.worktree_path, work_tasks.worktree_path),
      git_branch = COALESCE(excluded.git_branch, work_tasks.git_branch)
  `);
  const identities = new Map<string, { threadId: string; role: string; parent: string | null }>();
  for (const row of metaEvents) {
    const meta = payload(row);
    const role = typeof meta.taskRole === 'string' ? meta.taskRole : 'unknown';
    const identity = { threadId: row.threadId, role, parent: parents.get(row.taskId) ?? null };
    const prior = identities.get(row.taskId);
    if (prior && JSON.stringify(prior) !== JSON.stringify(identity)) {
      throw new IdentityConflictError('Task identity metadata conflicts across sources');
    }
    identities.set(row.taskId, identity);
    const status = statuses.get(row.taskId) ?? { status: 'running', endedAt: null };
    insertTask.run(
      row.taskId,
      resolveRoot(row.taskId, parents),
      parents.get(row.taskId) ?? null,
      row.threadId,
      role,
      status.status,
      row.occurredAt,
      status.endedAt,
      row.eraId,
      row.repoRoot,
      row.worktreePath,
      row.gitBranch,
    );
  }

  const tokenRows = db.prepare(`
    SELECT id, source_artifact_id AS sourceArtifactId,
           task_id AS taskId, thread_id AS threadId, turn_id AS turnId, era_id AS eraId,
           occurred_at AS occurredAt, kind, payload_json AS payloadJson,
           generation, attempt, sequence, repo_root AS repoRoot,
           worktree_path AS worktreePath, git_branch AS gitBranch
    FROM canonical_events
    WHERE kind = 'token-snapshot' AND task_id IS NOT NULL
    ORDER BY task_id, source_artifact_id, sequence
  `).all() as EventRow[];
  type Counters = { inputTokens: number; cachedInputTokens: number; cacheCreationTokens: number; outputTokens: number; reasoningTokens: number; compactionTokens: number };
  const previous = new Map<string, { counters: Counters; occurredAt: string; segment: number }>();
  const laneSegments = new Map<string, number>();
  const insertDelta = db.prepare(`
    INSERT INTO task_token_deltas (
      event_id, task_id, lane_key, segment, status,
      input_tokens, cached_input_tokens, cache_creation_tokens,
      output_tokens, reasoning_tokens, compaction_tokens
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const row of tokenRows) {
    const raw = payload(row);
    const required = ['inputTokens', 'cachedInputTokens', 'cacheCreationTokens', 'outputTokens', 'reasoningTokens', 'compactionTokens'] as const;
    const hasLaneIdentity = row.generation !== null && row.attempt !== null;
    const lane = hasLaneIdentity
      ? `${row.taskId}:${row.generation}:${row.attempt}`
      : `${row.taskId}:unknown:${row.turnId ?? 'no-turn'}`;
    if (!hasLaneIdentity || !required.every((key) => typeof raw[key] === 'number')) {
      const segment = (laneSegments.get(lane) ?? 0) + 1;
      laneSegments.set(lane, segment);
      previous.delete(lane);
      insertDelta.run(row.id, row.taskId, lane, segment, 'unknown-missing', null, null, null, null, null, null);
      continue;
    }
    const counters: Counters = {
      inputTokens: Number(raw.inputTokens),
      cachedInputTokens: Number(raw.cachedInputTokens),
      cacheCreationTokens: Number(raw.cacheCreationTokens),
      outputTokens: Number(raw.outputTokens),
      reasoningTokens: Number(raw.reasoningTokens),
      compactionTokens: Number(raw.compactionTokens),
    };
    const prior = previous.get(lane);
    let segment = laneSegments.get(lane) ?? 0;
    let status: TaskTokenDelta['status'] = 'unknown-baseline';
    let deltas: Array<number | null> = [null, null, null, null, null, null];
    if (prior && row.occurredAt < prior.occurredAt) {
      status = 'unknown-out-of-order';
      segment += 1;
    } else if (prior && Object.keys(counters).some(
      (key) => counters[key as keyof Counters] < prior.counters[key as keyof Counters],
    )) {
      status = 'unknown-reset';
      segment += 1;
    } else if (prior) {
      status = 'known';
      deltas = [
        counters.inputTokens - prior.counters.inputTokens,
        counters.cachedInputTokens - prior.counters.cachedInputTokens,
        counters.cacheCreationTokens - prior.counters.cacheCreationTokens,
        counters.outputTokens - prior.counters.outputTokens,
        counters.reasoningTokens - prior.counters.reasoningTokens,
        counters.compactionTokens - prior.counters.compactionTokens,
      ];
    }
    insertDelta.run(row.id, row.taskId, lane, segment, status, ...deltas);
    laneSegments.set(lane, segment);
    previous.set(lane, { counters, occurredAt: row.occurredAt, segment });
  }
}

function mapNode(row: Record<string, unknown>): WorkTaskNode {
  return {
    id: String(row.id),
    rootTaskId: String(row.rootTaskId),
    parentTaskId: row.parentTaskId === null ? null : String(row.parentTaskId),
    threadId: String(row.threadId),
    role: String(row.role),
    status: String(row.status),
    startedAt: String(row.startedAt),
    endedAt: row.endedAt === null ? null : String(row.endedAt),
    repository: {
      root: row.repoRoot === null ? null : String(row.repoRoot),
      worktree: row.worktreePath === null ? null : String(row.worktreePath),
      branch: row.gitBranch === null ? null : String(row.gitBranch),
    },
  };
}

export function listWorkTasks(db: Database.Database): WorkTaskNode[] {
  return (db.prepare(`
    SELECT id, root_task_id AS rootTaskId, parent_task_id AS parentTaskId,
           thread_id AS threadId, role, status, started_at AS startedAt,
           ended_at AS endedAt, repo_root AS repoRoot,
           worktree_path AS worktreePath, git_branch AS gitBranch
    FROM work_tasks WHERE id = root_task_id ORDER BY started_at DESC
  `).all() as Record<string, unknown>[]).map(mapNode);
}

export function readWorkTaskDetail(db: Database.Database, rootTaskId: string): WorkTaskDetail | null {
  const rows = db.prepare(`
    SELECT id, root_task_id AS rootTaskId, parent_task_id AS parentTaskId,
           thread_id AS threadId, role, status, started_at AS startedAt,
           ended_at AS endedAt, repo_root AS repoRoot,
           worktree_path AS worktreePath, git_branch AS gitBranch
    FROM work_tasks WHERE root_task_id = ? ORDER BY started_at, id
  `).all(rootTaskId) as Record<string, unknown>[];
  if (rows.length === 0) return null;
  const nodes = rows.map(mapNode);
  const ids = nodes.map((node) => node.id);
  const placeholders = ids.map(() => '?').join(',');
  const events = db.prepare(`
    SELECT id, source_artifact_id AS sourceArtifactId, sequence, kind, actor, sensitivity,
           occurred_at AS occurredAt, task_id AS taskId, thread_id AS threadId,
           turn_id AS turnId, attempt, generation, payload_ref AS payloadRef
    FROM canonical_events WHERE task_id IN (${placeholders})
    ORDER BY occurred_at, source_artifact_id, sequence
  `).all(...ids) as WorkTaskDetail['events'];
  const tokenDeltas = db.prepare(`
    SELECT event_id AS eventId, task_id AS taskId, lane_key AS laneKey, segment, status,
           input_tokens AS inputTokens, cached_input_tokens AS cachedInputTokens,
           cache_creation_tokens AS cacheCreationTokens, output_tokens AS outputTokens,
           reasoning_tokens AS reasoningTokens, compaction_tokens AS compactionTokens
    FROM task_token_deltas WHERE task_id IN (${placeholders})
    ORDER BY task_id, lane_key, segment, event_id
  `).all(...ids) as TaskTokenDelta[];
  const stats = db.prepare(`
    SELECT discovered_count AS discovered, parsed_count AS parsed,
           skipped_count AS skipped, failed_count AS failed,
           unknown_count AS unknown, diagnostics_json AS diagnosticsJson
    FROM source_ingestion_stats
    WHERE source_artifact_id IN (
      SELECT DISTINCT source_artifact_id FROM canonical_events WHERE task_id IN (${placeholders})
    )
  `).all(...ids) as Array<{
    discovered: number; parsed: number; skipped: number; failed: number;
    unknown: number; diagnosticsJson: string;
  }>;
  const coverage = stats.reduce((total, row) => ({
    discovered: total.discovered + 1,
    parsed: total.parsed,
    skipped: total.skipped + row.skipped,
    failed: total.failed + row.failed,
    unknown: total.unknown + row.unknown,
  }), { discovered: 0, parsed: 0, skipped: 0, failed: 0, unknown: 0 });
  coverage.parsed = events.length;
  coverage.unknown = events.filter((event) => event.kind === 'unknown').length;
  const diagnosticCounts = new Map<string, { severity: string; code: string; count: number }>();
  for (const row of stats) {
    let values: Array<{ severity: string; code: string; count: number }> = [];
    try { values = JSON.parse(row.diagnosticsJson) as typeof values; } catch { /* safe empty fallback */ }
    for (const value of values) {
      const key = `${value.severity}:${value.code}`;
      const prior = diagnosticCounts.get(key);
      diagnosticCounts.set(key, { ...value, count: value.count + (prior?.count ?? 0) });
    }
  }
  return {
    id: rootTaskId,
    nodes,
    events,
    tokenDeltas,
    coverage,
    diagnostics: [...diagnosticCounts.values()].sort((a, b) => a.code.localeCompare(b.code)),
  };
}
