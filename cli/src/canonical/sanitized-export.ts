import { createHash } from 'node:crypto';
import type Database from 'better-sqlite3';

export const SANITIZED_EXPORT_SCHEMA_VERSION = 'agent-analytics.sanitized-export.v1';

export interface SanitizedExport {
  schemaVersion: typeof SANITIZED_EXPORT_SCHEMA_VERSION;
  generatedAt: string;
  summary: {
    taskCount: number;
    eventCount: number;
    sourceCount: number;
    eraCount: number;
  };
  coverage: {
    discovered: number;
    parsed: number;
    skipped: number;
    failed: number;
    unknown: number;
  };
  diagnostics: {
    completedRuns: number;
    partialRuns: number;
    failedRuns: number;
    codes: Array<{ severity: string; code: string; count: number }>;
  };
  versions: {
    databaseSchema: number;
    parsers: string[];
  };
  evidenceLocators: string[];
}

function hashLocator(kind: string, value: string): string {
  return `${kind}:sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function count(db: Database.Database, table: string): number {
  return (db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count;
}

export function buildSanitizedExport(
  db: Database.Database,
  options: { now?: string } = {},
): SanitizedExport {
  const generatedAt = new Date(options.now ?? Date.now());
  if (!Number.isFinite(generatedAt.getTime())) throw new Error('Export time is invalid');

  const coverage = db.prepare(`SELECT
    COALESCE(SUM(discovered_count), 0) AS discovered,
    COALESCE(SUM(parsed_count), 0) AS parsed,
    COALESCE(SUM(skipped_count), 0) AS skipped,
    COALESCE(SUM(failed_count), 0) AS failed,
    COALESCE(SUM(unknown_count), 0) AS unknown
    FROM source_ingestion_stats`).get() as SanitizedExport['coverage'];
  const runDiagnostics = db.prepare(`SELECT
    COALESCE(SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END), 0) AS completedRuns,
    COALESCE(SUM(CASE WHEN status = 'completed-with-errors' THEN 1 ELSE 0 END), 0) AS partialRuns,
    COALESCE(SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END), 0) AS failedRuns
    FROM ingestion_runs`).get() as Omit<SanitizedExport['diagnostics'], 'codes'>;
  const diagnosticCodes = db.prepare(`SELECT severity, code, SUM(count) AS count
    FROM ingestion_diagnostics GROUP BY severity, code ORDER BY severity, code`).all() as
    SanitizedExport['diagnostics']['codes'];
  const databaseSchema = (db.prepare('SELECT COALESCE(MAX(version), 0) AS version FROM schema_version')
    .get() as { version: number }).version;
  const parsers = (db.prepare(`SELECT parser_version AS parser FROM source_artifacts
    UNION SELECT parser_version AS parser FROM canonical_events
    ORDER BY parser`).all() as Array<{ parser: string }>).map((row) => row.parser);
  const eventIds = db.prepare('SELECT id FROM canonical_events ORDER BY occurred_at, sequence, id')
    .all() as Array<{ id: string }>;

  return {
    schemaVersion: SANITIZED_EXPORT_SCHEMA_VERSION,
    generatedAt: generatedAt.toISOString(),
    summary: {
      taskCount: count(db, 'work_tasks'),
      eventCount: eventIds.length,
      sourceCount: count(db, 'source_artifacts'),
      eraCount: count(db, 'observation_eras'),
    },
    coverage,
    diagnostics: { ...runDiagnostics, codes: diagnosticCodes },
    versions: { databaseSchema, parsers },
    evidenceLocators: eventIds.map(({ id }) => hashLocator('event', id)),
  };
}
