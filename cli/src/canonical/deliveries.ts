import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import type Database from 'better-sqlite3';
import { discoverGitCommits, repositoryIdentity } from './delivery-repository.js';
import { gitAiConsumptionEnabled } from './git-ai-state.js';

export type DeliveryKind = 'git-commit' | 'test-run' | 'local-artifact';

export interface Delivery {
  id: string;
  kind: DeliveryKind;
  repositoryIdentity: string;
  resultIdentity: string;
  occurredAt: string;
  metadata: Record<string, unknown>;
}

export interface DeliveryEvidence {
  id: string;
  evidenceType: string;
  position: 'supports' | 'opposes' | 'limits';
  sourceCategory: 'deterministic' | 'human-corrected';
  algorithmVersion: string;
  coverage: number;
  confidence: number;
  eraCompatibility: 'compatible' | 'limited' | 'incomparable';
  eraIds: string[];
  humanStatus: 'unreviewed' | 'confirmed' | 'rejected' | 'corrected';
  facts: Array<{ deliveryId: string; taskId: string; factRef?: string }>;
}

export interface TaskDeliveryCandidate {
  id: string;
  taskId: string;
  delivery: Delivery;
  algorithmVersion: string;
  coverage: number;
  confidence: number;
  status: 'candidate' | 'abstained' | 'confirmed' | 'rejected' | 'pending';
  evidence: DeliveryEvidence[];
}

export interface DeliveryDetail extends Delivery {
  candidates: TaskDeliveryCandidate[];
}

const ASSOCIATION_VERSION = 'task-delivery-v1';

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function taskEvidenceCoverage(db: Database.Database, rootTaskId: string): number {
  const rows = db.prepare(`SELECT stats.parsed_count AS parsed,
    stats.skipped_count AS skipped, stats.failed_count AS failed, stats.unknown_count AS unknown
    FROM source_ingestion_stats stats
    WHERE stats.source_artifact_id IN (
      SELECT DISTINCT event.source_artifact_id
      FROM canonical_events event
      JOIN work_tasks task ON task.id = event.task_id
      WHERE task.root_task_id = ?
    )`).all(rootTaskId) as Array<{ parsed: number; skipped: number; failed: number; unknown: number }>;
  const totals = rows.reduce((sum, row) => ({
    known: sum.known + row.parsed - row.unknown,
    total: sum.total + row.parsed + row.skipped + row.failed,
  }), { known: 0, total: 0 });
  return totals.total === 0 ? 0 : totals.known / totals.total;
}

function writeEvidenceRecord(
  db: Database.Database,
  input: DeliveryEvidence & { subjectRef: string },
): void {
  db.prepare(`INSERT OR IGNORE INTO evidence_records (
    id, evidence_type, subject_ref, position, source_category, algorithm_version,
    coverage, confidence, era_compatibility, era_ids_json, human_status, fact_refs_json
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(input.id, input.evidenceType, input.subjectRef, input.position,
      input.sourceCategory, input.algorithmVersion, input.coverage, input.confidence,
      input.eraCompatibility, JSON.stringify(input.eraIds), input.humanStatus,
      JSON.stringify(input.facts));
}

function mapDelivery(row: Record<string, unknown>): Delivery {
  let metadata: Record<string, unknown> = {};
  try { metadata = JSON.parse(String(row.metadataJson)) as Record<string, unknown>; } catch { /* safe empty */ }
  return {
    id: String(row.id),
    kind: row.kind as DeliveryKind,
    repositoryIdentity: String(row.repositoryIdentity),
    resultIdentity: String(row.resultIdentity),
    occurredAt: String(row.occurredAt),
    metadata,
  };
}

export function discoverRepositoryDeliveries(
  db: Database.Database,
  request: { repositoryPath: string },
): { repositoryIdentity: string; deliveries: Delivery[] } {
  const repoIdentity = repositoryIdentity(request.repositoryPath);
  const records = discoverGitCommits(request.repositoryPath);
  const insert = db.prepare(`INSERT OR IGNORE INTO deliveries (
    id, kind, repository_identity, result_identity, occurred_at, metadata_json
  ) VALUES (?, 'git-commit', ?, ?, ?, ?)`);
  const transaction = db.transaction(() => {
    for (const record of records) {
      const id = `delivery:git-commit:${hash(`${repoIdentity}\0${record.objectId}`)}`;
      insert.run(id, repoIdentity, record.objectId, record.occurredAt, JSON.stringify({ branches: record.branches }));
      associateCommit(db, {
        deliveryId: id,
        repositoryPath: request.repositoryPath,
        occurredAt: record.occurredAt,
        message: record.message,
        branches: record.branches,
      });
    }
  });
  transaction();
  return {
    repositoryIdentity: repoIdentity,
    deliveries: listDeliveries(db, { repositoryIdentity: repoIdentity }),
  };
}

function taskReference(message: string, taskId: string): boolean {
  const escaped = taskId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^A-Za-z0-9])${escaped}($|[^A-Za-z0-9])`).test(message);
}

function associateCommit(
  db: Database.Database,
  commit: { deliveryId: string; repositoryPath: string; occurredAt: string; message: string; branches: string[] },
): void {
  const tasks = db.prepare(`SELECT id, started_at AS startedAt, ended_at AS endedAt,
    era_id AS eraId, git_branch AS gitBranch
    FROM work_tasks
    WHERE id = root_task_id AND (repo_root = ? OR worktree_path = ?)
    ORDER BY started_at, id`).all(commit.repositoryPath, commit.repositoryPath) as Array<{
      id: string; startedAt: string; endedAt: string | null; eraId: string; gitBranch: string | null;
    }>;
  const insertCandidate = db.prepare(`INSERT OR IGNORE INTO task_delivery_candidates (
    id, task_id, delivery_id, algorithm_version, coverage, confidence, machine_status
  ) VALUES (?, ?, ?, ?, ?, ?, 'abstained')`);
  const occurredAt = Date.parse(commit.occurredAt);
  for (const task of tasks) {
    const endsAt = task.endedAt ? Date.parse(task.endedAt) : Date.parse(task.startedAt) + 4 * 60 * 60 * 1_000;
    const temporal = occurredAt >= Date.parse(task.startedAt) && occurredAt <= endsAt;
    const referenced = taskReference(commit.message, task.id);
    if (!temporal && !referenced) continue;
    const candidateId = `candidate:${hash(`${ASSOCIATION_VERSION}\0${task.id}\0${commit.deliveryId}`)}`;
    const branchConflict = Boolean(task.gitBranch && commit.branches.length > 0
      && !commit.branches.some((branch) => branch === task.gitBranch || branch.endsWith(`/${task.gitBranch}`)));
    const coverage = taskEvidenceCoverage(db, task.id);
    const rawConfidence = 0.1 + (temporal ? 0.15 : 0) + (referenced ? 0.15 : 0) - (branchConflict ? 0.1 : 0);
    const confidence = Math.max(0, rawConfidence) * coverage;
    insertCandidate.run(candidateId, task.id, commit.deliveryId, ASSOCIATION_VERSION, coverage, confidence);
    const facts = [{ deliveryId: commit.deliveryId, taskId: task.id }];
    const evidence: Array<{ type: string; position: DeliveryEvidence['position']; confidence: number }> = [
      { type: 'repository-scope-match', position: 'supports', confidence: 0.1 },
      ...(temporal ? [{ type: 'temporal-proximity', position: 'supports' as const, confidence: 0.15 }] : []),
      ...(referenced ? [{ type: 'commit-message-task-reference', position: 'supports' as const, confidence: 0.15 }] : []),
      ...(branchConflict ? [{ type: 'branch-mismatch', position: 'opposes' as const, confidence: 0.1 }] : []),
    ];
    for (const record of evidence) {
      const identity = `${candidateId}\0${record.type}\0${record.position}\0${record.confidence}`;
      writeEvidenceRecord(db, {
        id: `evidence:${hash(identity)}`,
        evidenceType: record.type,
        subjectRef: candidateId,
        position: record.position,
        sourceCategory: 'deterministic',
        algorithmVersion: ASSOCIATION_VERSION,
        coverage,
        confidence: record.confidence * coverage,
        eraCompatibility: 'compatible',
        eraIds: [task.eraId],
        humanStatus: 'unreviewed',
        facts,
      });
    }
  }
}

function insertStrongCandidate(
  db: Database.Database,
  input: { taskId: string; deliveryId: string; eraId: string; evidenceType: string; factRef?: string; coverage: number },
): void {
  const candidateId = `candidate:${hash(`${ASSOCIATION_VERSION}\0${input.taskId}\0${input.deliveryId}`)}`;
  db.prepare(`INSERT OR IGNORE INTO task_delivery_candidates (
    id, task_id, delivery_id, algorithm_version, coverage, confidence, machine_status
  ) VALUES (?, ?, ?, ?, ?, ?, 'candidate')`)
    .run(candidateId, input.taskId, input.deliveryId, ASSOCIATION_VERSION, input.coverage, input.coverage);
  const facts = [{ deliveryId: input.deliveryId, taskId: input.taskId, factRef: input.factRef }];
  const evidenceIdentity = `${candidateId}\0${input.evidenceType}\0${input.factRef ?? ''}`;
  writeEvidenceRecord(db, {
    id: `evidence:${hash(evidenceIdentity)}`,
    evidenceType: input.evidenceType,
    subjectRef: candidateId,
    position: 'supports',
    sourceCategory: 'deterministic',
    algorithmVersion: ASSOCIATION_VERSION,
    coverage: input.coverage,
    confidence: input.coverage,
    eraCompatibility: 'compatible',
    eraIds: [input.eraId],
    humanStatus: 'unreviewed',
    facts,
  });
}

export function discoverCanonicalTestRunDeliveries(db: Database.Database): Delivery[] {
  const rows = db.prepare(`SELECT result.id AS resultEventId, result.occurred_at AS occurredAt,
    result.payload_json AS resultPayloadJson, call.payload_json AS callPayloadJson,
    task.root_task_id AS rootTaskId, root.era_id AS eraId,
    COALESCE(root.worktree_path, root.repo_root) AS repositoryPath
    FROM canonical_events result
    JOIN canonical_events call ON call.id = result.parent_event_id AND call.kind = 'tool-call'
    JOIN work_tasks task ON task.id = result.task_id
    JOIN work_tasks root ON root.id = task.root_task_id
    WHERE result.kind = 'tool-result' AND result.task_id IS NOT NULL
    ORDER BY result.occurred_at, result.id`).all() as Array<{
      resultEventId: string; occurredAt: string; resultPayloadJson: string; callPayloadJson: string;
      rootTaskId: string; eraId: string; repositoryPath: string | null;
    }>;
  const inserted: Delivery[] = [];
  const transaction = db.transaction(() => {
    for (const row of rows) {
      let callPayload: Record<string, unknown> = {};
      let resultPayload: Record<string, unknown> = {};
      try { callPayload = JSON.parse(row.callPayloadJson) as Record<string, unknown>; } catch { /* safe empty */ }
      try { resultPayload = JSON.parse(row.resultPayloadJson) as Record<string, unknown>; } catch { /* safe empty */ }
      const validationKind = callPayload.validationKind;
      if (typeof validationKind !== 'string' || !row.repositoryPath) continue;
      let repoIdentity: string;
      try { repoIdentity = repositoryIdentity(row.repositoryPath); } catch { continue; }
      const id = `delivery:test-run:${hash(`${repoIdentity}\0${row.resultEventId}`)}`;
      const metadata = {
        validationKind,
        status: typeof resultPayload.status === 'string' ? resultPayload.status : 'unknown',
      };
      db.prepare(`INSERT OR IGNORE INTO deliveries (
        id, kind, repository_identity, result_identity, occurred_at, metadata_json
      ) VALUES (?, 'test-run', ?, ?, ?, ?)`)
        .run(id, repoIdentity, row.resultEventId, row.occurredAt, JSON.stringify(metadata));
      insertStrongCandidate(db, {
        taskId: row.rootTaskId, deliveryId: id, eraId: row.eraId,
        evidenceType: 'canonical-validation-result', factRef: row.resultEventId,
        coverage: taskEvidenceCoverage(db, row.rootTaskId),
      });
      inserted.push({ id, kind: 'test-run', repositoryIdentity: repoIdentity,
        resultIdentity: row.resultEventId, occurredAt: row.occurredAt, metadata });
    }
  });
  transaction();
  return inserted;
}

export function discoverRecordedTaskDeliveries(db: Database.Database): {
  repositories: number; deliveries: number; failed: number;
} {
  const deliveryIds = new Set(discoverCanonicalTestRunDeliveries(db).map((delivery) => delivery.id));
  const paths = (db.prepare(`SELECT DISTINCT COALESCE(worktree_path, repo_root) AS repositoryPath
    FROM work_tasks WHERE id = root_task_id AND COALESCE(worktree_path, repo_root) IS NOT NULL
    ORDER BY repositoryPath`).all() as Array<{ repositoryPath: string }>).map((row) => row.repositoryPath);
  let repositories = 0;
  let failed = 0;
  for (const repositoryPath of paths) {
    try {
      const result = discoverRepositoryDeliveries(db, { repositoryPath });
      repositories += 1;
      for (const delivery of result.deliveries) deliveryIds.add(delivery.id);
    } catch {
      failed += 1;
    }
  }
  return { repositories, deliveries: deliveryIds.size, failed };
}

export function recordLocalArtifactDelivery(
  db: Database.Database,
  request: { repositoryPath: string; artifactPath: string; taskId?: string; occurredAt?: string },
): Delivery {
  const repoIdentity = repositoryIdentity(request.repositoryPath);
  const repositoryRoot = realpathSync(request.repositoryPath);
  const artifactRealPath = realpathSync(request.artifactPath);
  const relativePath = relative(repositoryRoot, artifactRealPath);
  if (!relativePath || relativePath.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`)
      || relativePath === '..' || isAbsolute(relativePath)) {
    throw new Error('Artifact must be inside the repository');
  }
  const pathIdentity = `sha256:${hash(relativePath)}`;
  const contentIdentity = `sha256:${createHash('sha256').update(readFileSync(request.artifactPath)).digest('hex')}`;
  const resultIdentity = `artifact:${pathIdentity}:${contentIdentity}`;
  const id = `delivery:local-artifact:${hash(`${repoIdentity}\0${resultIdentity}`)}`;
  const occurredAt = request.occurredAt ?? statSync(request.artifactPath).mtime.toISOString();
  const metadata = { pathHash: pathIdentity };
  const transaction = db.transaction(() => {
    db.prepare(`INSERT OR IGNORE INTO deliveries (
      id, kind, repository_identity, result_identity, occurred_at, metadata_json
    ) VALUES (?, 'local-artifact', ?, ?, ?, ?)`)
      .run(id, repoIdentity, resultIdentity, occurredAt, JSON.stringify(metadata));
    if (request.taskId) {
      const task = db.prepare(`SELECT root_task_id AS rootTaskId, era_id AS eraId
        FROM work_tasks WHERE id = ?`).get(request.taskId) as { rootTaskId: string; eraId: string } | undefined;
      if (!task) throw new Error('Artifact task does not exist');
      insertStrongCandidate(db, {
        taskId: task.rootTaskId, deliveryId: id, eraId: task.eraId,
        evidenceType: 'explicit-task-artifact', coverage: 1,
      });
    }
  });
  transaction();
  return { id, kind: 'local-artifact', repositoryIdentity: repoIdentity,
    resultIdentity, occurredAt, metadata };
}

export function recordTaskLocalArtifactDelivery(
  db: Database.Database,
  request: { taskId: string; relativePath: string; occurredAt?: string },
): { delivery: Delivery; candidate: TaskDeliveryCandidate } {
  const task = db.prepare(`SELECT root.id AS rootTaskId,
    COALESCE(root.worktree_path, root.repo_root) AS repositoryPath
    FROM work_tasks task
    JOIN work_tasks root ON root.id = task.root_task_id
    WHERE task.id = ?`).get(request.taskId) as { rootTaskId: string; repositoryPath: string | null } | undefined;
  if (!task) throw new Error('Artifact task does not exist');
  if (!task.repositoryPath) throw new Error('Artifact task has no repository');
  const delivery = recordLocalArtifactDelivery(db, {
    repositoryPath: task.repositoryPath,
    artifactPath: resolve(task.repositoryPath, request.relativePath),
    taskId: task.rootTaskId,
    occurredAt: request.occurredAt,
  });
  const candidate = readTaskDeliveries(db, task.rootTaskId)
    .find((item) => item.delivery.id === delivery.id);
  if (!candidate) throw new Error('Artifact candidate was not created');
  return { delivery, candidate };
}

export function appendCandidateCorrection(
  db: Database.Database,
  request: { candidateId: string; decision: 'confirmed' | 'rejected' | 'pending' },
): DeliveryEvidence {
  const candidate = db.prepare(`SELECT candidate.task_id AS taskId, candidate.delivery_id AS deliveryId,
    task.era_id AS eraId
    FROM task_delivery_candidates candidate
    JOIN work_tasks task ON task.id = candidate.task_id
    WHERE candidate.id = ?`).get(request.candidateId) as {
      taskId: string; deliveryId: string; eraId: string;
    } | undefined;
  if (!candidate) throw new Error('Task-delivery candidate does not exist');
  const attributes = request.decision === 'confirmed'
    ? { evidenceType: 'human-confirmation', position: 'supports' as const, humanStatus: 'confirmed' as const, confidence: 1 }
    : request.decision === 'rejected'
      ? { evidenceType: 'human-rejection', position: 'opposes' as const, humanStatus: 'rejected' as const, confidence: 1 }
      : { evidenceType: 'human-pending', position: 'limits' as const, humanStatus: 'unreviewed' as const, confidence: 0 };
  const evidence: DeliveryEvidence = {
    id: `evidence:human:${randomUUID()}`,
    ...attributes,
    sourceCategory: 'human-corrected',
    algorithmVersion: 'human-correction-v1',
    coverage: 1,
    eraCompatibility: 'compatible',
    eraIds: [candidate.eraId],
    facts: [{ deliveryId: candidate.deliveryId, taskId: candidate.taskId }],
  };
  const transaction = db.transaction(() => {
    writeEvidenceRecord(db, { ...evidence, subjectRef: request.candidateId });
    db.prepare(`INSERT INTO task_delivery_corrections (candidate_id, evidence_id, decision)
      VALUES (?, ?, ?)`).run(request.candidateId, evidence.id, request.decision);
  });
  transaction();
  return evidence;
}

export function listDeliveries(
  db: Database.Database,
  filter: { repositoryIdentity?: string; linkedOnly?: boolean } = {},
): Delivery[] {
  const predicates: string[] = [];
  const params: string[] = [];
  if (filter.repositoryIdentity) {
    predicates.push('delivery.repository_identity = ?');
    params.push(filter.repositoryIdentity);
  }
  if (filter.linkedOnly) {
    predicates.push(`EXISTS (
      SELECT 1 FROM task_delivery_candidates candidate
      WHERE candidate.delivery_id = delivery.id AND (
        candidate.machine_status = 'candidate'
        OR COALESCE((SELECT correction.decision FROM task_delivery_corrections correction
          WHERE correction.candidate_id = candidate.id
          ORDER BY correction.sequence DESC LIMIT 1), '') IN ('confirmed', 'pending')
      )
    )`);
  }
  const where = predicates.length > 0 ? `WHERE ${predicates.join(' AND ')}` : '';
  const rows = db.prepare(`SELECT delivery.id, delivery.kind,
    delivery.repository_identity AS repositoryIdentity,
    delivery.result_identity AS resultIdentity, delivery.occurred_at AS occurredAt,
    delivery.metadata_json AS metadataJson
    FROM deliveries delivery ${where}
    ORDER BY delivery.occurred_at DESC, delivery.id`).all(...params);
  return (rows as Record<string, unknown>[]).map(mapDelivery);
}

function readCandidateEvidence(db: Database.Database, candidateId: string): DeliveryEvidence[] {
  const rows = db.prepare(`SELECT id, evidence_type AS evidenceType, position,
    source_category AS sourceCategory, algorithm_version AS algorithmVersion,
    coverage, confidence, era_compatibility AS eraCompatibility,
    era_ids_json AS eraIdsJson, human_status AS humanStatus, fact_refs_json AS factsJson,
    correction.sequence AS correctionSequence
    FROM evidence_records evidence
    LEFT JOIN task_delivery_corrections correction ON correction.evidence_id = evidence.id
    WHERE evidence.subject_ref = ?`).all(candidateId) as Array<Record<string, unknown>>;
  const order = new Map([
    ['canonical-validation-result', 0], ['explicit-task-artifact', 0],
    ['repository-scope-match', 1], ['temporal-proximity', 2],
    ['commit-message-task-reference', 3], ['branch-mismatch', 4],
  ]);
  return rows.map((row) => {
    let facts: DeliveryEvidence['facts'] = [];
    let eraIds: string[] = [];
    try { facts = JSON.parse(String(row.factsJson)) as DeliveryEvidence['facts']; } catch { /* safe empty */ }
    try { eraIds = JSON.parse(String(row.eraIdsJson)) as string[]; } catch { /* safe empty */ }
    return {
      id: String(row.id),
      evidenceType: String(row.evidenceType),
      position: row.position as DeliveryEvidence['position'],
      sourceCategory: row.sourceCategory as DeliveryEvidence['sourceCategory'],
      algorithmVersion: String(row.algorithmVersion),
      coverage: Number(row.coverage),
      confidence: Number(row.confidence),
      eraCompatibility: row.eraCompatibility as DeliveryEvidence['eraCompatibility'],
      eraIds,
      humanStatus: row.humanStatus as DeliveryEvidence['humanStatus'],
      facts,
      correctionSequence: row.correctionSequence === null ? null : Number(row.correctionSequence),
    };
  }).sort((left, right) => {
    const leftHuman = left.correctionSequence !== null;
    const rightHuman = right.correctionSequence !== null;
    if (leftHuman !== rightHuman) return leftHuman ? 1 : -1;
    if (leftHuman && rightHuman) return left.correctionSequence! - right.correctionSequence!;
    return (order.get(left.evidenceType) ?? 99) - (order.get(right.evidenceType) ?? 99)
      || left.id.localeCompare(right.id);
  }).map(({ correctionSequence: _sequence, ...record }) => record);
}

function readCandidateStatus(
  db: Database.Database,
  candidateId: string,
  machineStatus: string,
): TaskDeliveryCandidate['status'] {
  const correction = db.prepare(`SELECT decision FROM task_delivery_corrections
    WHERE candidate_id = ? ORDER BY sequence DESC LIMIT 1`).get(candidateId) as { decision: TaskDeliveryCandidate['status'] } | undefined;
  return correction?.decision ?? machineStatus as TaskDeliveryCandidate['status'];
}

function readCandidateRows(
  db: Database.Database,
  where: 'task' | 'delivery',
  value: string,
): TaskDeliveryCandidate[] {
  const column = where === 'task' ? 'candidate.task_id' : 'candidate.delivery_id';
  const rows = db.prepare(`SELECT candidate.id, candidate.task_id AS taskId,
    candidate.algorithm_version AS algorithmVersion, candidate.coverage,
    candidate.confidence, candidate.machine_status AS machineStatus,
    delivery.id AS deliveryId, delivery.kind, delivery.repository_identity AS repositoryIdentity,
    delivery.result_identity AS resultIdentity, delivery.occurred_at AS occurredAt,
    delivery.metadata_json AS metadataJson
    FROM task_delivery_candidates candidate
    JOIN deliveries delivery ON delivery.id = candidate.delivery_id
    WHERE ${column} = ? ORDER BY delivery.occurred_at DESC, candidate.task_id`).all(value) as Array<Record<string, unknown>>;
  const showGitAi = !rows.some((row) => row.algorithmVersion === 'git-ai-provenance-v1')
    || gitAiConsumptionEnabled(db);
  return rows.filter((row) => row.algorithmVersion !== 'git-ai-provenance-v1' || showGitAi).map((row) => ({
    id: String(row.id),
    taskId: String(row.taskId),
    delivery: mapDelivery({
      id: row.deliveryId, kind: row.kind, repositoryIdentity: row.repositoryIdentity,
      resultIdentity: row.resultIdentity, occurredAt: row.occurredAt, metadataJson: row.metadataJson,
    }),
    algorithmVersion: String(row.algorithmVersion),
    coverage: Number(row.coverage),
    confidence: Number(row.confidence),
    status: readCandidateStatus(db, String(row.id), String(row.machineStatus)),
    evidence: readCandidateEvidence(db, String(row.id)),
  }));
}

export function readTaskDeliveries(db: Database.Database, taskId: string): TaskDeliveryCandidate[] {
  return readCandidateRows(db, 'task', taskId);
}

export function readDeliveryDetail(db: Database.Database, deliveryId: string): DeliveryDetail | null {
  const row = db.prepare(`SELECT id, kind, repository_identity AS repositoryIdentity,
    result_identity AS resultIdentity, occurred_at AS occurredAt, metadata_json AS metadataJson
    FROM deliveries WHERE id = ?`).get(deliveryId) as Record<string, unknown> | undefined;
  if (!row) return null;
  return { ...mapDelivery(row), candidates: readCandidateRows(db, 'delivery', deliveryId) };
}
