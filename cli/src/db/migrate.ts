import type Database from 'better-sqlite3';
import { SCHEMA_SQL, CURRENT_SCHEMA_VERSION } from './schema.js';

export interface MigrationResult {
  v6Applied: boolean;
  v7Applied: boolean;
  v8Applied: boolean;
  v9Applied: boolean;
}

/**
 * Apply schema migrations to the database.
 * Called once on startup before any reads or writes.
 *
 * Version 1: Initial schema (projects, sessions, messages, insights, usage_stats)
 * Version 2: Add compound index on insights(confidence DESC, timestamp DESC) for depth-ordered export queries
 * Version 3: Add session_facets table for cross-session analysis
 * Version 4: Add reflect_snapshots table for caching LLM-generated synthesis results
 * Version 5: Add deleted_at column to sessions for soft-delete (user-initiated hide)
 * Version 6: Add compact_count, auto_compact_count, slash_commands columns to sessions
 * Version 7: Add analysis_usage table for tracking LLM analysis costs per session
 * Version 8: Add session_message_count to analysis_usage for resume detection
 * Version 9: Add analysis_queue table for async hook-triggered analysis
 * Version 10: Add canonical ingestion, observation era, coverage, and diagnostics tables
 * Version 11: Add monotonic source cursors, canonical identity edges, and repository locators
 */
export function runMigrations(db: Database.Database): MigrationResult {
  // Create schema_version table first if it doesn't exist.
  // This table is created inline (not via SCHEMA_SQL) so migrations can check it.
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version    INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  const currentVersion = getCurrentVersion(db);

  if (currentVersion < 1) {
    applyV1(db);
  }

  if (currentVersion < 2) {
    applyV2(db);
  }

  if (currentVersion < 3) {
    applyV3(db);
  }

  if (currentVersion < 4) {
    applyV4(db);
  }

  if (currentVersion < 5) {
    applyV5(db);
  }

  let v6Applied = false;
  if (currentVersion < 6) {
    applyV6(db);
    v6Applied = true;
  }

  let v7Applied = false;
  if (currentVersion < 7) {
    applyV7(db);
    v7Applied = true;
  }

  let v8Applied = false;
  if (currentVersion < 8) {
    applyV8(db);
    v8Applied = true;
  }

  let v9Applied = false;
  if (currentVersion < 9) {
    applyV9(db);
    v9Applied = true;
  }

  if (currentVersion < 10) {
    applyV10(db);
  }

  if (currentVersion < 11) {
    applyV11(db);
  }

  return { v6Applied, v7Applied, v8Applied, v9Applied };
}

function getCurrentVersion(db: Database.Database): number {
  const row = db.prepare('SELECT MAX(version) as v FROM schema_version').get() as { v: number | null };
  return row.v ?? 0;
}

function applyV1(db: Database.Database): void {
  db.exec(SCHEMA_SQL);
  db.prepare('INSERT OR IGNORE INTO schema_version (version) VALUES (?)').run(1);
}

function applyV2(db: Database.Database): void {
  db.exec(`CREATE INDEX IF NOT EXISTS idx_insights_confidence_timestamp ON insights(confidence DESC, timestamp DESC)`);
  db.prepare('INSERT OR IGNORE INTO schema_version (version) VALUES (?)').run(2);
}

function applyV3(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS session_facets (
      session_id              TEXT PRIMARY KEY REFERENCES sessions(id),
      outcome_satisfaction    TEXT NOT NULL,
      workflow_pattern        TEXT,
      had_course_correction   INTEGER NOT NULL DEFAULT 0,
      course_correction_reason TEXT,
      iteration_count         INTEGER NOT NULL DEFAULT 0,
      friction_points         TEXT,
      effective_patterns      TEXT,
      extracted_at            TEXT NOT NULL DEFAULT (datetime('now')),
      analysis_version        TEXT NOT NULL DEFAULT '1.0.0'
    );

    CREATE INDEX IF NOT EXISTS idx_facets_outcome ON session_facets(outcome_satisfaction);
    CREATE INDEX IF NOT EXISTS idx_facets_workflow ON session_facets(workflow_pattern);
  `);

  db.prepare('INSERT OR IGNORE INTO schema_version (version) VALUES (?)').run(3);
}

function applyV4(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS reflect_snapshots (
      period        TEXT NOT NULL,
      project_id    TEXT NOT NULL DEFAULT '__all__',
      results_json  TEXT NOT NULL,
      generated_at  TEXT NOT NULL,
      window_start  TEXT,
      window_end    TEXT NOT NULL,
      session_count INTEGER NOT NULL,
      facet_count   INTEGER NOT NULL,
      PRIMARY KEY (period, project_id)
    );
  `);

  db.prepare('INSERT OR IGNORE INTO schema_version (version) VALUES (?)').run(4);
}

function applyV5(db: Database.Database): void {
  db.exec(`ALTER TABLE sessions ADD COLUMN deleted_at TEXT`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_sessions_deleted_at ON sessions(deleted_at)`);
  db.prepare('INSERT OR IGNORE INTO schema_version (version) VALUES (?)').run(5);
}

function applyV6(db: Database.Database): void {
  db.exec(`ALTER TABLE sessions ADD COLUMN compact_count INTEGER NOT NULL DEFAULT 0`);
  db.exec(`ALTER TABLE sessions ADD COLUMN auto_compact_count INTEGER NOT NULL DEFAULT 0`);
  db.exec(`ALTER TABLE sessions ADD COLUMN slash_commands TEXT NOT NULL DEFAULT '[]'`);
  db.prepare('INSERT OR IGNORE INTO schema_version (version) VALUES (?)').run(6);
}


function applyV7(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS analysis_usage (
      session_id            TEXT NOT NULL REFERENCES sessions(id),
      analysis_type         TEXT NOT NULL,
      provider              TEXT NOT NULL,
      model                 TEXT NOT NULL,
      input_tokens          INTEGER NOT NULL DEFAULT 0,
      output_tokens         INTEGER NOT NULL DEFAULT 0,
      cache_creation_tokens INTEGER NOT NULL DEFAULT 0,
      cache_read_tokens     INTEGER NOT NULL DEFAULT 0,
      estimated_cost_usd    REAL NOT NULL DEFAULT 0,
      duration_ms           INTEGER,
      chunk_count           INTEGER NOT NULL DEFAULT 1,
      analyzed_at           TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (session_id, analysis_type)
    )
  `);
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_analysis_usage_analyzed_at
      ON analysis_usage(analyzed_at DESC)
  `);
  db.prepare('INSERT OR IGNORE INTO schema_version (version) VALUES (?)').run(7);
}
function applyV8(db: Database.Database): void {
  db.exec(`ALTER TABLE analysis_usage ADD COLUMN session_message_count INTEGER`);
  db.prepare('INSERT OR IGNORE INTO schema_version (version) VALUES (?)').run(8);
}

function applyV9(db: Database.Database): void {
  // analysis_queue: tracks async hook-triggered analysis jobs
  // One row per session (session_id is PK) — retries increment attempt_count in-place
  db.exec(
    `CREATE TABLE IF NOT EXISTS analysis_queue (
      session_id    TEXT PRIMARY KEY REFERENCES sessions(id),
      status        TEXT NOT NULL DEFAULT 'pending',
      runner_type   TEXT NOT NULL DEFAULT 'native',
      enqueued_at   TEXT NOT NULL DEFAULT (datetime('now')),
      started_at    TEXT,
      completed_at  TEXT,
      error_message TEXT,
      attempt_count INTEGER NOT NULL DEFAULT 0,
      max_attempts  INTEGER NOT NULL DEFAULT 3
    )`
  );
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_analysis_queue_status ON analysis_queue(status)`
  );
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_analysis_queue_enqueued_at ON analysis_queue(enqueued_at ASC)`
  );
  db.prepare('INSERT OR IGNORE INTO schema_version (version) VALUES (?)').run(9);
}

function applyV10(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS observation_eras (
      id                TEXT PRIMARY KEY,
      name              TEXT NOT NULL,
      mode              TEXT NOT NULL CHECK (mode IN ('historical-backfill', 'continuous-observation')),
      parser_version    TEXT NOT NULL,
      capabilities_json TEXT NOT NULL DEFAULT '[]',
      starts_at         TEXT NOT NULL,
      ends_at           TEXT,
      created_at        TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS source_artifacts (
      id             TEXT PRIMARY KEY,
      source_kind    TEXT NOT NULL,
      locator_hash   TEXT NOT NULL,
      observed_at    TEXT NOT NULL,
      content_hash   TEXT,
      cursor         TEXT,
      era_id         TEXT NOT NULL REFERENCES observation_eras(id),
      created_at     TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS canonical_events (
      id                 TEXT PRIMARY KEY,
      source_artifact_id TEXT NOT NULL REFERENCES source_artifacts(id),
      era_id             TEXT NOT NULL REFERENCES observation_eras(id),
      native_event_id    TEXT NOT NULL,
      sequence           INTEGER NOT NULL,
      occurred_at        TEXT NOT NULL,
      kind               TEXT NOT NULL,
      actor              TEXT NOT NULL,
      sensitivity        TEXT NOT NULL,
      payload_json       TEXT NOT NULL DEFAULT '{}',
      parent_event_id    TEXT,
      task_id            TEXT,
      thread_id          TEXT,
      turn_id            TEXT,
      attempt            INTEGER,
      generation         INTEGER,
      parser_version     TEXT NOT NULL,
      created_at         TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(source_artifact_id, native_event_id)
    );

    CREATE TABLE IF NOT EXISTS ingestion_runs (
      id                   TEXT PRIMARY KEY,
      adapter_name         TEXT NOT NULL,
      started_at           TEXT NOT NULL,
      completed_at         TEXT,
      status               TEXT NOT NULL,
      discovered_count     INTEGER NOT NULL DEFAULT 0,
      parsed_count         INTEGER NOT NULL DEFAULT 0,
      skipped_count        INTEGER NOT NULL DEFAULT 0,
      failed_count         INTEGER NOT NULL DEFAULT 0,
      unknown_count        INTEGER NOT NULL DEFAULT 0,
      inserted_event_count INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS ingestion_diagnostics (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id     TEXT NOT NULL REFERENCES ingestion_runs(id),
      severity   TEXT NOT NULL,
      code       TEXT NOT NULL,
      count      INTEGER NOT NULL DEFAULT 1,
      detail     TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_canonical_events_source_sequence
      ON canonical_events(source_artifact_id, sequence);
    CREATE INDEX IF NOT EXISTS idx_canonical_events_task_time
      ON canonical_events(task_id, occurred_at);
    CREATE INDEX IF NOT EXISTS idx_ingestion_runs_adapter_time
      ON ingestion_runs(adapter_name, started_at DESC);
  `);
  db.prepare('INSERT OR IGNORE INTO schema_version (version) VALUES (?)').run(10);
}

function applyV11(db: Database.Database): void {
  db.exec(`ALTER TABLE source_artifacts ADD COLUMN cursor_position INTEGER NOT NULL DEFAULT 0`);
  db.exec(`ALTER TABLE canonical_events ADD COLUMN repo_root TEXT`);
  db.exec(`ALTER TABLE canonical_events ADD COLUMN worktree_path TEXT`);
  db.exec(`ALTER TABLE canonical_events ADD COLUMN git_branch TEXT`);
  db.exec(`ALTER TABLE canonical_events ADD COLUMN payload_ref TEXT`);
  db.exec(`
    CREATE TABLE IF NOT EXISTS canonical_identity_edges (
      source_artifact_id TEXT NOT NULL REFERENCES source_artifacts(id),
      kind               TEXT NOT NULL,
      from_id            TEXT NOT NULL,
      to_id              TEXT NOT NULL,
      created_at         TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (source_artifact_id, kind, from_id, to_id)
    )
  `);
  db.prepare('INSERT OR IGNORE INTO schema_version (version) VALUES (?)').run(11);
}
