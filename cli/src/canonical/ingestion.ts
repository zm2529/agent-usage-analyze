import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';

export type SourceKind = 'synthetic-codex' | 'codex-rollout' | 'codex-hook' | 'git';
export type EraMode = 'historical-backfill' | 'continuous-observation';
export type EventActor = 'user' | 'assistant' | 'system' | 'tool' | 'subagent' | 'unknown';
export type Sensitivity = 'structural' | 'metadata' | 'sensitive-content';

export interface SourceArtifact {
  id: string;
  sourceKind: SourceKind;
  locatorHash: string;
  observedAt: string;
  contentHash?: string;
  priorCursor?: string;
}

export interface ObservationEraSeed {
  id: string;
  name: string;
  mode: EraMode;
  parserVersion: string;
  capabilities: string[];
  startsAt: string;
  endsAt?: string;
}

export interface CanonicalEvent {
  id: string;
  nativeEventId: string;
  sequence: number;
  occurredAt: string;
  kind: string;
  actor: EventActor;
  sensitivity: Sensitivity;
  payload: Record<string, unknown>;
  parentEventId?: string;
  taskId?: string;
  threadId?: string;
  turnId?: string;
  attempt?: number;
  generation?: number;
}

export interface IngestionDiagnostic {
  severity: 'info' | 'warning' | 'error';
  code: string;
  count: number;
  detail?: string;
}

export interface CoverageCounts {
  discovered: number;
  parsed: number;
  skipped: number;
  failed: number;
  unknown: number;
}

export interface CanonicalBatch {
  artifact: SourceArtifact;
  era: ObservationEraSeed;
  events: CanonicalEvent[];
  diagnostics: IngestionDiagnostic[];
  coverage: CoverageCounts;
  nextCursor: string;
}

export interface SourceAdapter {
  readonly name: string;
  discover(): Promise<SourceArtifact[]>;
  parse(artifact: SourceArtifact): Promise<CanonicalBatch>;
}

export interface IngestionSummary {
  runId: string;
  adapter: string;
  insertedEvents: number;
  advancedSources: number;
  coverage: CoverageCounts;
}

const EMPTY_COVERAGE: CoverageCounts = {
  discovered: 0,
  parsed: 0,
  skipped: 0,
  failed: 0,
  unknown: 0,
};

export async function ingestSourceAdapter(
  adapter: SourceAdapter,
  db: Database.Database,
): Promise<IngestionSummary> {
  const runId = `ingestion:${randomUUID()}`;
  const startedAt = new Date().toISOString();
  const artifacts = await adapter.discover();
  const coverage = { ...EMPTY_COVERAGE, discovered: artifacts.length };
  let insertedEvents = 0;
  let advancedSources = 0;

  db.prepare(`
    INSERT INTO ingestion_runs (
      id, adapter_name, started_at, status, discovered_count,
      parsed_count, skipped_count, failed_count, unknown_count
    ) VALUES (?, ?, ?, 'running', ?, 0, 0, 0, 0)
  `).run(runId, adapter.name, startedAt, artifacts.length);

  try {
    for (const artifact of artifacts) {
      let batch: CanonicalBatch;
      try {
        batch = await adapter.parse(artifact);
      } catch (error) {
        coverage.failed += 1;
        db.prepare(`
          INSERT INTO ingestion_diagnostics (run_id, severity, code, count, detail)
          VALUES (?, 'error', 'adapter-parse-failed', 1, ?)
        `).run(runId, error instanceof Error ? error.message : String(error));
        continue;
      }

      const writeBatch = db.transaction(() => {
        db.prepare(`
          INSERT INTO observation_eras (
            id, name, mode, parser_version, capabilities_json, starts_at, ends_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            name = excluded.name,
            ends_at = COALESCE(excluded.ends_at, observation_eras.ends_at)
        `).run(
          batch.era.id,
          batch.era.name,
          batch.era.mode,
          batch.era.parserVersion,
          JSON.stringify(batch.era.capabilities),
          batch.era.startsAt,
          batch.era.endsAt ?? null,
        );

        db.prepare(`
          INSERT INTO source_artifacts (
            id, source_kind, locator_hash, observed_at, content_hash, cursor, era_id
          ) VALUES (?, ?, ?, ?, ?, NULL, ?)
          ON CONFLICT(id) DO UPDATE SET
            locator_hash = excluded.locator_hash,
            observed_at = excluded.observed_at,
            content_hash = excluded.content_hash,
            era_id = excluded.era_id
        `).run(
          artifact.id,
          artifact.sourceKind,
          artifact.locatorHash,
          artifact.observedAt,
          artifact.contentHash ?? null,
          batch.era.id,
        );

        const insertEvent = db.prepare(`
          INSERT OR IGNORE INTO canonical_events (
            id, source_artifact_id, era_id, native_event_id, sequence,
            occurred_at, kind, actor, sensitivity, payload_json,
            parent_event_id, task_id, thread_id, turn_id, attempt, generation,
            parser_version
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        for (const event of batch.events) {
          const result = insertEvent.run(
            event.id,
            artifact.id,
            batch.era.id,
            event.nativeEventId,
            event.sequence,
            event.occurredAt,
            event.kind,
            event.actor,
            event.sensitivity,
            JSON.stringify(event.payload),
            event.parentEventId ?? null,
            event.taskId ?? null,
            event.threadId ?? null,
            event.turnId ?? null,
            event.attempt ?? null,
            event.generation ?? null,
            batch.era.parserVersion,
          );
          insertedEvents += result.changes;
        }

        const insertDiagnostic = db.prepare(`
          INSERT INTO ingestion_diagnostics (run_id, severity, code, count, detail)
          VALUES (?, ?, ?, ?, ?)
        `);
        for (const diagnostic of batch.diagnostics) {
          insertDiagnostic.run(
            runId,
            diagnostic.severity,
            diagnostic.code,
            diagnostic.count,
            diagnostic.detail ?? null,
          );
        }

        db.prepare(`
          UPDATE source_artifacts SET cursor = ?, updated_at = datetime('now') WHERE id = ?
        `).run(batch.nextCursor, artifact.id);
      });

      writeBatch();
      advancedSources += 1;
      coverage.parsed += batch.coverage.parsed;
      coverage.skipped += batch.coverage.skipped;
      coverage.failed += batch.coverage.failed;
      coverage.unknown += batch.coverage.unknown;
    }

    db.prepare(`
      UPDATE ingestion_runs SET
        completed_at = ?, status = 'completed', inserted_event_count = ?,
        parsed_count = ?, skipped_count = ?, failed_count = ?, unknown_count = ?
      WHERE id = ?
    `).run(
      new Date().toISOString(),
      insertedEvents,
      coverage.parsed,
      coverage.skipped,
      coverage.failed,
      coverage.unknown,
      runId,
    );
  } catch (error) {
    db.prepare(`
      UPDATE ingestion_runs SET completed_at = ?, status = 'failed', failed_count = failed_count + 1
      WHERE id = ?
    `).run(new Date().toISOString(), runId);
    throw error;
  }

  return { runId, adapter: adapter.name, insertedEvents, advancedSources, coverage };
}

export interface IngestionHealth {
  coverage: CoverageCounts;
  eventCount: number;
  sourceCount: number;
  eras: Array<{ id: string; mode: EraMode; parserVersion: string }>;
}

export function readIngestionHealth(db: Database.Database): IngestionHealth {
  const latestCoverage = db.prepare(`
    SELECT discovered_count AS discovered, parsed_count AS parsed,
           skipped_count AS skipped, failed_count AS failed, unknown_count AS unknown
    FROM ingestion_runs
    WHERE status = 'completed'
    ORDER BY completed_at DESC, rowid DESC
    LIMIT 1
  `).get() as CoverageCounts | undefined;
  const eventCount = db.prepare('SELECT COUNT(*) AS count FROM canonical_events').get() as { count: number };
  const sourceCount = db.prepare('SELECT COUNT(*) AS count FROM source_artifacts').get() as { count: number };
  const eras = db.prepare(`
    SELECT id, mode, parser_version AS parserVersion
    FROM observation_eras
    ORDER BY starts_at ASC, id ASC
  `).all() as Array<{ id: string; mode: EraMode; parserVersion: string }>;

  return {
    coverage: latestCoverage ?? { ...EMPTY_COVERAGE },
    eventCount: eventCount.count,
    sourceCount: sourceCount.count,
    eras,
  };
}
