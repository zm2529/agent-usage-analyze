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
 * Version 12: Make parser version part of immutable source identity
 * Version 13: Add work-task tree and segmented token delta projections
 * Version 14: Complete token counters and add durable per-source ingestion coverage
 * Version 15: Add evidence-closed, versioned analysis claims
 * Version 16: Add immutable engineering deliveries
 * Version 17: Add isolated Buildermark helper gate reports
 * Version 18: Add managed Git AI prospective sidecar gate reports
 * Version 19: Add privacy-controlled semantic analysis runs and claim details
 * Version 20: Add immutable scorecards, versioned results, and observer overhead
 * Version 21: Add non-blocking advisory interaction history and mute policy
 * Version 22: Add immutable expand-project-contract migration records
 * Version 23: Expand the analysis queue for turn-settled, source-scoped automation
 * Version 24: Record cached-input and reasoning tokens in observer overhead
 * Version 25: Record live source progress for background canonical imports
 * Version 26: Add immutable, locally inspectable LLM analysis run records
 * Version 27: Repair missing settled-frontier support in databases already marked v23+
 * Version 28: Add event-time hourly Token usage projection
 * Version 29: Add versioned practice research and LLM-led improvement tracking
 * Version 30: Decouple durable improvement observations from the rebuildable task projection
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

  if (currentVersion < 12) {
    applyV12(db);
  }

  if (currentVersion < 13) {
    applyV13(db);
  }

  if (currentVersion < 14) {
    applyV14(db);
  }

  if (currentVersion < 15) {
    applyV15(db);
  }

  if (currentVersion < 16) {
    applyV16(db);
  }

  if (currentVersion < 17) {
    applyV17(db);
  }

  if (currentVersion < 18) {
    applyV18(db);
  }

  if (currentVersion < 19) {
    applyV19(db);
  }

  if (currentVersion < 20) {
    applyV20(db);
  }

  if (currentVersion < 21) {
    applyV21(db);
  }

  if (currentVersion < 22) {
    applyV22(db);
  }

  if (currentVersion < 23) {
    applyV23(db);
  }

  if (currentVersion < 24) {
    applyV24(db);
  }

  if (currentVersion < 25) {
    applyV25(db);
  }

  if (currentVersion < 26) {
    applyV26(db);
  }

  if (currentVersion < 27) {
    applyV27(db);
  }

  if (currentVersion < 28) {
    applyV28(db);
  }

  if (currentVersion < 29) {
    applyV29(db);
  }

  if (currentVersion < 30) {
    applyV30(db);
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

function applyV12(db: Database.Database): void {
  db.exec(`ALTER TABLE source_artifacts ADD COLUMN parser_version TEXT NOT NULL DEFAULT 'unknown'`);
  db.prepare(`
    UPDATE source_artifacts
    SET parser_version = COALESCE(
      (SELECT parser_version FROM observation_eras WHERE observation_eras.id = source_artifacts.era_id),
      'unknown'
    )
  `).run();
  db.prepare('INSERT OR IGNORE INTO schema_version (version) VALUES (?)').run(12);
}

function applyV13(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS work_tasks (
      id              TEXT PRIMARY KEY,
      root_task_id    TEXT NOT NULL,
      parent_task_id  TEXT,
      thread_id       TEXT NOT NULL,
      role            TEXT NOT NULL,
      status          TEXT NOT NULL,
      started_at      TEXT NOT NULL,
      ended_at        TEXT,
      era_id          TEXT NOT NULL REFERENCES observation_eras(id),
      repo_root       TEXT,
      worktree_path   TEXT,
      git_branch      TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_work_tasks_root ON work_tasks(root_task_id, started_at);

    CREATE TABLE IF NOT EXISTS task_token_deltas (
      event_id            TEXT PRIMARY KEY REFERENCES canonical_events(id) ON DELETE CASCADE,
      task_id             TEXT NOT NULL,
      lane_key            TEXT NOT NULL,
      segment             INTEGER NOT NULL,
      status              TEXT NOT NULL,
      input_tokens        INTEGER,
      cached_input_tokens INTEGER,
      output_tokens       INTEGER,
      reasoning_tokens    INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_task_token_deltas_task ON task_token_deltas(task_id, lane_key, segment);

  `);
  db.prepare('INSERT OR IGNORE INTO schema_version (version) VALUES (?)').run(13);
}

function applyV14(db: Database.Database): void {
  const tokenColumns = new Set((db.prepare('PRAGMA table_info(task_token_deltas)').all() as Array<{ name: string }>)
    .map((column) => column.name));
  if (!tokenColumns.has('cache_creation_tokens')) {
    db.exec(`ALTER TABLE task_token_deltas ADD COLUMN cache_creation_tokens INTEGER`);
  }
  if (!tokenColumns.has('compaction_tokens')) {
    db.exec(`ALTER TABLE task_token_deltas ADD COLUMN compaction_tokens INTEGER`);
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS source_ingestion_stats (
      source_artifact_id TEXT PRIMARY KEY REFERENCES source_artifacts(id) ON DELETE CASCADE,
      discovered_count  INTEGER NOT NULL,
      parsed_count      INTEGER NOT NULL,
      skipped_count     INTEGER NOT NULL,
      failed_count      INTEGER NOT NULL,
      unknown_count     INTEGER NOT NULL,
      diagnostics_json  TEXT NOT NULL DEFAULT '[]',
      updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS canonical_projection_state (
      id         INTEGER PRIMARY KEY CHECK (id = 1),
      dirty      INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    INSERT INTO canonical_projection_state (id, dirty) VALUES (1, 1)
      ON CONFLICT(id) DO UPDATE SET dirty = 1, updated_at = datetime('now');
  `);
  db.prepare('INSERT OR IGNORE INTO schema_version (version) VALUES (?)').run(14);
}

function applyV15(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS evidence_records (
      id                TEXT PRIMARY KEY,
      evidence_type     TEXT NOT NULL,
      subject_ref       TEXT NOT NULL,
      position          TEXT NOT NULL CHECK (position IN ('supports', 'opposes', 'limits')),
      source_category   TEXT NOT NULL CHECK (source_category IN ('deterministic', 'statistical', 'llm-semantic', 'human-corrected')),
      algorithm_version TEXT NOT NULL,
      coverage          REAL NOT NULL,
      confidence        REAL NOT NULL,
      era_compatibility TEXT NOT NULL CHECK (era_compatibility IN ('compatible', 'limited', 'incomparable')),
      era_ids_json      TEXT NOT NULL,
      human_status      TEXT NOT NULL DEFAULT 'unreviewed' CHECK (human_status IN ('unreviewed', 'confirmed', 'rejected', 'corrected')),
      fact_refs_json    TEXT NOT NULL,
      created_at        TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS analysis_claims (
      id                TEXT PRIMARY KEY,
      pattern_key       TEXT NOT NULL,
      source_category   TEXT NOT NULL CHECK (source_category IN ('deterministic', 'statistical', 'llm-semantic', 'human-corrected')),
      algorithm_version TEXT NOT NULL,
      window_start      TEXT NOT NULL,
      window_end        TEXT NOT NULL,
      sample_count      INTEGER NOT NULL,
      total_task_count  INTEGER NOT NULL,
      coverage          REAL NOT NULL,
      confidence        REAL NOT NULL,
      era_compatibility TEXT NOT NULL CHECK (era_compatibility IN ('compatible', 'limited', 'incomparable')),
      sample_task_refs_json TEXT NOT NULL,
      evidence_refs_json TEXT NOT NULL,
      created_at        TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_analysis_claims_window
      ON analysis_claims(window_start, window_end, pattern_key);
  `);
  db.prepare('INSERT OR IGNORE INTO schema_version (version) VALUES (?)').run(15);
}

function applyV16(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS deliveries (
      id                  TEXT PRIMARY KEY,
      kind                TEXT NOT NULL CHECK (kind IN ('git-commit', 'test-run', 'local-artifact')),
      repository_identity TEXT NOT NULL,
      result_identity     TEXT NOT NULL,
      occurred_at         TEXT NOT NULL,
      metadata_json       TEXT NOT NULL DEFAULT '{}',
      created_at          TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(kind, repository_identity, result_identity)
    );
    CREATE INDEX IF NOT EXISTS idx_deliveries_repository_time
      ON deliveries(repository_identity, occurred_at DESC);

    CREATE TABLE IF NOT EXISTS task_delivery_candidates (
      id                TEXT PRIMARY KEY,
      task_id           TEXT NOT NULL,
      delivery_id       TEXT NOT NULL REFERENCES deliveries(id),
      algorithm_version TEXT NOT NULL,
      coverage          REAL NOT NULL,
      confidence        REAL NOT NULL,
      machine_status    TEXT NOT NULL CHECK (machine_status IN ('candidate', 'abstained')),
      created_at        TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(task_id, delivery_id, algorithm_version)
    );
    CREATE INDEX IF NOT EXISTS idx_task_delivery_candidates_task
      ON task_delivery_candidates(task_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_task_delivery_candidates_delivery
      ON task_delivery_candidates(delivery_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS task_delivery_corrections (
      sequence     INTEGER PRIMARY KEY AUTOINCREMENT,
      candidate_id TEXT NOT NULL REFERENCES task_delivery_candidates(id),
      evidence_id  TEXT NOT NULL UNIQUE REFERENCES evidence_records(id),
      decision     TEXT NOT NULL CHECK (decision IN ('confirmed', 'rejected', 'pending')),
      created_at   TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_task_delivery_corrections_candidate
      ON task_delivery_corrections(candidate_id, sequence DESC);
  `);
  db.prepare('INSERT OR IGNORE INTO schema_version (version) VALUES (?)').run(16);
}

function applyV17(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS buildermark_gate_runs (
      sequence                 INTEGER PRIMARY KEY AUTOINCREMENT,
      id                       TEXT NOT NULL UNIQUE,
      helper_version           TEXT NOT NULL,
      helper_source_commit     TEXT NOT NULL,
      evidence_schema_version  TEXT NOT NULL,
      mode                     TEXT NOT NULL CHECK (mode IN ('synthetic', 'real')),
      status                   TEXT NOT NULL CHECK (status IN ('testing', 'passed', 'failed')),
      repository_identity      TEXT NOT NULL,
      report_json              TEXT,
      failure_codes_json       TEXT NOT NULL DEFAULT '[]',
      started_at               TEXT NOT NULL,
      completed_at             TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_buildermark_gate_runs_started
      ON buildermark_gate_runs(sequence DESC);
  `);
  db.prepare('INSERT OR IGNORE INTO schema_version (version) VALUES (?)').run(17);
}

function applyV18(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS git_ai_gate_runs (
      sequence             INTEGER PRIMARY KEY AUTOINCREMENT,
      id                   TEXT NOT NULL UNIQUE,
      status               TEXT NOT NULL CHECK (status IN ('testing', 'passed', 'failed')),
      repository_identity  TEXT NOT NULL,
      source_version       TEXT NOT NULL,
      source_commit        TEXT NOT NULL,
      notes_schema         TEXT NOT NULL,
      report_json          TEXT,
      failure_codes_json   TEXT NOT NULL DEFAULT '[]',
      started_at           TEXT NOT NULL,
      completed_at         TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_git_ai_gate_runs_started
      ON git_ai_gate_runs(sequence DESC);
  `);
  db.prepare('INSERT OR IGNORE INTO schema_version (version) VALUES (?)').run(18);
}

function applyV19(db: Database.Database): void {
  db.transaction(() => {
    db.exec(`
    CREATE TABLE IF NOT EXISTS semantic_analysis_runs (
      id                     TEXT PRIMARY KEY,
      task_id                TEXT NOT NULL,
      status                 TEXT NOT NULL CHECK (status IN ('accepted', 'rejected', 'failed')),
      provider               TEXT NOT NULL,
      model                  TEXT NOT NULL,
      locality               TEXT NOT NULL CHECK (locality IN ('local', 'remote')),
      rubric_version         TEXT NOT NULL,
      analysis_version       TEXT NOT NULL,
      input_coverage         REAL NOT NULL CHECK (input_coverage >= 0 AND input_coverage <= 1),
      estimated_input_tokens INTEGER NOT NULL CHECK (estimated_input_tokens >= 0),
      input_tokens           INTEGER CHECK (input_tokens IS NULL OR input_tokens >= 0),
      output_tokens          INTEGER CHECK (output_tokens IS NULL OR output_tokens >= 0),
      cost_usd               REAL CHECK (cost_usd IS NULL OR cost_usd >= 0),
      evidence_refs_json     TEXT NOT NULL
        CHECK (json_valid(evidence_refs_json) AND json_type(evidence_refs_json) = 'array'),
      rejection_code         TEXT,
      created_at             TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_semantic_analysis_runs_task
      ON semantic_analysis_runs(task_id, created_at DESC, id DESC);

    CREATE TABLE IF NOT EXISTS semantic_claim_details (
      claim_id         TEXT PRIMARY KEY REFERENCES analysis_claims(id) ON DELETE CASCADE,
      run_id           TEXT NOT NULL REFERENCES semantic_analysis_runs(id) ON DELETE CASCADE,
      claim_type       TEXT NOT NULL CHECK (claim_type IN ('pattern-explanation', 'improvement-advice')),
      title            TEXT NOT NULL,
      summary          TEXT NOT NULL,
      expected_benefit TEXT NOT NULL,
      verification     TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_semantic_claim_details_run
      ON semantic_claim_details(run_id, claim_id);
    `);
    db.prepare('INSERT OR IGNORE INTO schema_version (version) VALUES (?)').run(19);
  })();
}

function applyV20(db: Database.Database): void {
  db.transaction(() => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS scorecard_versions (
        id                       TEXT PRIMARY KEY,
        name                     TEXT NOT NULL,
        version                  TEXT NOT NULL UNIQUE,
        definition_hash          TEXT NOT NULL UNIQUE,
        features_json            TEXT NOT NULL CHECK (json_valid(features_json) AND json_type(features_json) = 'array'),
        quality_gates_json        TEXT NOT NULL CHECK (json_valid(quality_gates_json) AND json_type(quality_gates_json) = 'array'),
        safety_gates_json         TEXT NOT NULL CHECK (json_valid(safety_gates_json) AND json_type(safety_gates_json) = 'array'),
        missing_rules_json        TEXT NOT NULL CHECK (json_valid(missing_rules_json) AND json_type(missing_rules_json) = 'object'),
        thresholds_json           TEXT NOT NULL CHECK (json_valid(thresholds_json) AND json_type(thresholds_json) = 'object'),
        calibration_data_version TEXT,
        scope_json                TEXT NOT NULL CHECK (json_valid(scope_json) AND json_type(scope_json) = 'object'),
        evidence_refs_json        TEXT NOT NULL CHECK (json_valid(evidence_refs_json) AND json_type(evidence_refs_json) = 'array'),
        created_at                TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_scorecard_versions_created
        ON scorecard_versions(created_at DESC, id DESC);

      CREATE TABLE IF NOT EXISTS scorecard_status_events (
        sequence       INTEGER PRIMARY KEY AUTOINCREMENT,
        scorecard_id   TEXT NOT NULL REFERENCES scorecard_versions(id),
        from_status    TEXT CHECK (from_status IS NULL OR from_status IN ('draft', 'calibrating', 'active', 'retired')),
        to_status      TEXT NOT NULL CHECK (to_status IN ('draft', 'calibrating', 'active', 'retired')),
        evidence_refs_json TEXT NOT NULL CHECK (json_valid(evidence_refs_json) AND json_type(evidence_refs_json) = 'array'),
        created_at     TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_scorecard_status_events_current
        ON scorecard_status_events(scorecard_id, sequence DESC);

      CREATE TABLE IF NOT EXISTS scorecard_results (
        id                    TEXT PRIMARY KEY,
        task_id               TEXT NOT NULL,
        scorecard_version_id  TEXT NOT NULL REFERENCES scorecard_versions(id),
        raw_features_json     TEXT NOT NULL CHECK (json_valid(raw_features_json) AND json_type(raw_features_json) = 'object'),
        gate_results_json     TEXT NOT NULL CHECK (json_valid(gate_results_json) AND json_type(gate_results_json) = 'object'),
        coverage              REAL NOT NULL CHECK (coverage >= 0 AND coverage <= 1),
        uncertainty           REAL NOT NULL CHECK (uncertainty >= 0 AND uncertainty <= 1),
        index_value           REAL CHECK (index_value IS NULL OR (index_value >= 0 AND index_value <= 100)),
        unavailable_reason    TEXT CHECK (unavailable_reason IS NULL OR unavailable_reason IN (
          'scorecard-not-active', 'calibration-not-passed', 'quality-gate-failed',
          'safety-gate-failed', 'insufficient-coverage', 'missing-feature',
          'task-not-found', 'out-of-scope'
        )),
        evidence_refs_json    TEXT NOT NULL CHECK (json_valid(evidence_refs_json) AND json_type(evidence_refs_json) = 'array'),
        created_at            TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_scorecard_results_task
        ON scorecard_results(task_id, created_at DESC, id DESC);
      CREATE INDEX IF NOT EXISTS idx_scorecard_results_version
        ON scorecard_results(scorecard_version_id, created_at DESC, id DESC);

      CREATE TABLE IF NOT EXISTS observer_overhead_events (
        id                  TEXT PRIMARY KEY,
        subject_kind        TEXT NOT NULL DEFAULT 'observer' CHECK (subject_kind = 'observer'),
        category            TEXT NOT NULL CHECK (category IN ('import', 'llm', 'sidecar', 'advisory')),
        observer_run_id     TEXT NOT NULL,
        analyzed_task_id    TEXT,
        cpu_ms              REAL CHECK (cpu_ms IS NULL OR cpu_ms >= 0),
        wall_ms             REAL CHECK (wall_ms IS NULL OR wall_ms >= 0),
        db_bytes_delta      INTEGER CHECK (db_bytes_delta IS NULL OR db_bytes_delta >= 0),
        input_tokens        INTEGER CHECK (input_tokens IS NULL OR input_tokens >= 0),
        output_tokens       INTEGER CHECK (output_tokens IS NULL OR output_tokens >= 0),
        cost_usd            REAL CHECK (cost_usd IS NULL OR cost_usd >= 0),
        sidecar_ms          REAL CHECK (sidecar_ms IS NULL OR sidecar_ms >= 0),
        advisory_action     TEXT CHECK (advisory_action IS NULL OR advisory_action IN ('shown', 'adopted', 'ignored', 'dismissed')),
        evidence_refs_json  TEXT NOT NULL CHECK (json_valid(evidence_refs_json) AND json_type(evidence_refs_json) = 'array'),
        occurred_at         TEXT NOT NULL DEFAULT (datetime('now')),
        CHECK (
          (category = 'import' AND input_tokens IS NULL AND output_tokens IS NULL AND cost_usd IS NULL
            AND sidecar_ms IS NULL AND advisory_action IS NULL)
          OR (category = 'llm' AND cpu_ms IS NULL AND db_bytes_delta IS NULL
            AND sidecar_ms IS NULL AND advisory_action IS NULL)
          OR (category = 'sidecar' AND db_bytes_delta IS NULL AND input_tokens IS NULL
            AND output_tokens IS NULL AND cost_usd IS NULL AND advisory_action IS NULL)
          OR (category = 'advisory' AND cpu_ms IS NULL AND db_bytes_delta IS NULL
            AND input_tokens IS NULL AND output_tokens IS NULL AND cost_usd IS NULL
            AND sidecar_ms IS NULL AND advisory_action IS NOT NULL)
        )
      );
      CREATE INDEX IF NOT EXISTS idx_observer_overhead_time
        ON observer_overhead_events(occurred_at DESC, id DESC);
      CREATE INDEX IF NOT EXISTS idx_observer_overhead_category
        ON observer_overhead_events(category, occurred_at DESC);

      CREATE TABLE IF NOT EXISTS observer_overhead_diagnostics (
        id              TEXT PRIMARY KEY,
        category        TEXT NOT NULL CHECK (category IN ('import', 'llm', 'sidecar', 'advisory')),
        observer_run_id TEXT NOT NULL,
        code            TEXT NOT NULL CHECK (code IN ('observer-write-failed', 'observer-measurement-failed')),
        occurred_at     TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_observer_overhead_diagnostics_time
        ON observer_overhead_diagnostics(occurred_at DESC, id DESC);

      CREATE TRIGGER IF NOT EXISTS scorecard_versions_no_update
        BEFORE UPDATE ON scorecard_versions BEGIN SELECT RAISE(ABORT, 'scorecard versions are immutable'); END;
      CREATE TRIGGER IF NOT EXISTS scorecard_versions_no_delete
        BEFORE DELETE ON scorecard_versions BEGIN SELECT RAISE(ABORT, 'scorecard versions are immutable'); END;
      CREATE TRIGGER IF NOT EXISTS scorecard_status_events_no_update
        BEFORE UPDATE ON scorecard_status_events BEGIN SELECT RAISE(ABORT, 'scorecard status history is immutable'); END;
      CREATE TRIGGER IF NOT EXISTS scorecard_status_events_no_delete
        BEFORE DELETE ON scorecard_status_events BEGIN SELECT RAISE(ABORT, 'scorecard status history is immutable'); END;
      CREATE TRIGGER IF NOT EXISTS scorecard_results_no_update
        BEFORE UPDATE ON scorecard_results BEGIN SELECT RAISE(ABORT, 'scorecard results are immutable'); END;
      CREATE TRIGGER IF NOT EXISTS scorecard_results_no_delete
        BEFORE DELETE ON scorecard_results BEGIN SELECT RAISE(ABORT, 'scorecard results are immutable'); END;
      CREATE TRIGGER IF NOT EXISTS observer_overhead_events_no_update
        BEFORE UPDATE ON observer_overhead_events BEGIN SELECT RAISE(ABORT, 'observer overhead events are immutable'); END;
      CREATE TRIGGER IF NOT EXISTS observer_overhead_events_no_delete
        BEFORE DELETE ON observer_overhead_events BEGIN SELECT RAISE(ABORT, 'observer overhead events are immutable'); END;
      CREATE TRIGGER IF NOT EXISTS observer_overhead_diagnostics_no_update
        BEFORE UPDATE ON observer_overhead_diagnostics BEGIN SELECT RAISE(ABORT, 'observer overhead diagnostics are immutable'); END;
      CREATE TRIGGER IF NOT EXISTS observer_overhead_diagnostics_no_delete
        BEFORE DELETE ON observer_overhead_diagnostics BEGIN SELECT RAISE(ABORT, 'observer overhead diagnostics are immutable'); END;
    `);
    db.prepare('INSERT OR IGNORE INTO schema_version (version) VALUES (?)').run(20);
  })();
}

function applyV21(db: Database.Database): void {
  db.transaction(() => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS advisory_events (
        id                  TEXT PRIMARY KEY,
        intervention_id     TEXT NOT NULL,
        issue_key           TEXT NOT NULL,
        task_id             TEXT NOT NULL,
        action              TEXT NOT NULL CHECK (action IN ('shown', 'adopted', 'ignored', 'dismissed', 'outcome')),
        outcome             TEXT CHECK (outcome IS NULL OR outcome IN ('improved', 'not-improved', 'unknown')),
        observation_era_id  TEXT NOT NULL,
        coverage            REAL NOT NULL CHECK (coverage >= 0 AND coverage <= 1),
        evidence_refs_json  TEXT NOT NULL CHECK (json_valid(evidence_refs_json) AND json_type(evidence_refs_json) = 'array'),
        occurred_at         TEXT NOT NULL,
        CHECK ((action = 'outcome' AND outcome IS NOT NULL) OR (action != 'outcome' AND outcome IS NULL))
      );
      CREATE INDEX IF NOT EXISTS idx_advisory_events_task_issue
        ON advisory_events(task_id, issue_key, occurred_at DESC, id DESC);
      CREATE INDEX IF NOT EXISTS idx_advisory_events_intervention
        ON advisory_events(intervention_id, occurred_at ASC, id ASC);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_advisory_events_one_shown
        ON advisory_events(intervention_id) WHERE action = 'shown';
      CREATE UNIQUE INDEX IF NOT EXISTS idx_advisory_events_one_response
        ON advisory_events(intervention_id) WHERE action IN ('adopted', 'ignored', 'dismissed');
      CREATE UNIQUE INDEX IF NOT EXISTS idx_advisory_events_one_outcome
        ON advisory_events(intervention_id) WHERE action = 'outcome';
      CREATE INDEX IF NOT EXISTS idx_advisory_events_action
        ON advisory_events(action, occurred_at DESC, id DESC);

      CREATE TABLE IF NOT EXISTS advisory_mutes (
        scope_kind   TEXT NOT NULL CHECK (scope_kind IN ('issue', 'category')),
        scope_key    TEXT NOT NULL,
        muted_until  TEXT,
        updated_at   TEXT NOT NULL,
        PRIMARY KEY (scope_kind, scope_key)
      );

      CREATE TRIGGER IF NOT EXISTS advisory_events_no_update
        BEFORE UPDATE ON advisory_events BEGIN SELECT RAISE(ABORT, 'advisory events are immutable'); END;
      CREATE TRIGGER IF NOT EXISTS advisory_events_no_delete
        BEFORE DELETE ON advisory_events BEGIN SELECT RAISE(ABORT, 'advisory events are immutable'); END;
    `);
    db.prepare('INSERT OR IGNORE INTO schema_version (version) VALUES (?)').run(21);
  })();
}

function applyV22(db: Database.Database): void {
  db.transaction(() => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS product_migration_runs (
        id                    TEXT PRIMARY KEY,
        source_schema_version INTEGER NOT NULL,
        target_schema_version INTEGER NOT NULL,
        status                TEXT NOT NULL CHECK (status IN ('initialized', 'migrated')),
        backup_file           TEXT,
        report_json           TEXT NOT NULL CHECK (json_valid(report_json)),
        completed_at          TEXT NOT NULL
      );
      CREATE TRIGGER IF NOT EXISTS product_migration_runs_no_update
        BEFORE UPDATE ON product_migration_runs BEGIN
          SELECT RAISE(ABORT, 'product migration records are immutable');
        END;
      CREATE TRIGGER IF NOT EXISTS product_migration_runs_no_delete
        BEFORE DELETE ON product_migration_runs BEGIN
          SELECT RAISE(ABORT, 'product migration records are immutable');
        END;
    `);
    db.prepare('INSERT OR IGNORE INTO schema_version (version) VALUES (?)').run(22);
  })();
}

function applyV23(db: Database.Database): void {
  db.transaction(() => {
    const currentQueueColumns = db.prepare(`PRAGMA table_info(analysis_queue)`).all() as Array<{ name: string }>;
    if (currentQueueColumns.some((column) => column.name === 'source_tool')
        && currentQueueColumns.some((column) => column.name === 'latest_turn_id')) {
      createV23FrontierSupport(db);
      db.prepare('INSERT OR IGNORE INTO schema_version (version) VALUES (?)').run(23);
      return;
    }
    db.exec(`
      CREATE TABLE analysis_queue_v23 (
        source_tool        TEXT NOT NULL DEFAULT 'claude-code',
        session_id         TEXT NOT NULL,
        status             TEXT NOT NULL DEFAULT 'pending',
        runner_type        TEXT NOT NULL DEFAULT 'native',
        latest_turn_id     TEXT,
        generation         INTEGER NOT NULL DEFAULT 0,
        transcript_locator TEXT,
        source_basis       TEXT,
        not_before         TEXT,
        diagnostic         TEXT,
        enqueued_at        TEXT NOT NULL DEFAULT (datetime('now')),
        started_at         TEXT,
        completed_at       TEXT,
        error_message      TEXT,
        attempt_count      INTEGER NOT NULL DEFAULT 0,
        max_attempts       INTEGER NOT NULL DEFAULT 3,
        PRIMARY KEY (source_tool, session_id)
      );
    `);
    const legacyQueueExists = db.prepare(
      `SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = 'analysis_queue'`,
    ).get();
    if (legacyQueueExists) {
      db.exec(`
        INSERT INTO analysis_queue_v23 (
        source_tool, session_id, status, runner_type, enqueued_at, started_at,
        completed_at, error_message, attempt_count, max_attempts
        )
        SELECT
          'claude-code', session_id, status, runner_type, enqueued_at, started_at,
          completed_at, error_message, attempt_count, max_attempts
        FROM analysis_queue;
        DROP TABLE analysis_queue;
      `);
    }
    db.exec(`
      ALTER TABLE analysis_queue_v23 RENAME TO analysis_queue;
      CREATE INDEX IF NOT EXISTS idx_analysis_queue_status ON analysis_queue(status);
      CREATE INDEX IF NOT EXISTS idx_analysis_queue_enqueued_at ON analysis_queue(enqueued_at ASC);
      CREATE INDEX IF NOT EXISTS idx_analysis_queue_settle_due
        ON analysis_queue(status, not_before ASC);
    `);
    createV23FrontierSupport(db);
    db.prepare('INSERT OR IGNORE INTO schema_version (version) VALUES (?)').run(23);
  })();
}

function applyV24(db: Database.Database): void {
  db.transaction(() => {
    const columns = new Set(
      (db.prepare('PRAGMA table_info(observer_overhead_events)').all() as Array<{ name: string }>)
        .map((column) => column.name),
    );
    if (!columns.has('cached_input_tokens')) {
      db.exec(`ALTER TABLE observer_overhead_events ADD COLUMN cached_input_tokens
        INTEGER CHECK (cached_input_tokens IS NULL OR cached_input_tokens >= 0)`);
    }
    if (!columns.has('reasoning_tokens')) {
      db.exec(`ALTER TABLE observer_overhead_events ADD COLUMN reasoning_tokens
        INTEGER CHECK (reasoning_tokens IS NULL OR reasoning_tokens >= 0)`);
    }
    if (!columns.has('llm_provider')) {
      db.exec(`ALTER TABLE observer_overhead_events ADD COLUMN llm_provider TEXT`);
    }
    if (!columns.has('llm_model')) {
      db.exec(`ALTER TABLE observer_overhead_events ADD COLUMN llm_model TEXT`);
    }
    db.prepare('INSERT OR IGNORE INTO schema_version (version) VALUES (?)').run(24);
  })();
}

function applyV25(db: Database.Database): void {
  db.transaction(() => {
    const columns = new Set(
      (db.prepare('PRAGMA table_info(ingestion_runs)').all() as Array<{ name: string }>)
        .map((column) => column.name),
    );
    if (!columns.has('processed_source_count')) {
      db.exec(`ALTER TABLE ingestion_runs ADD COLUMN processed_source_count INTEGER NOT NULL DEFAULT 0`);
    }
    db.prepare('INSERT OR IGNORE INTO schema_version (version) VALUES (?)').run(25);
  })();
}

function applyV26(db: Database.Database): void {
  db.transaction(() => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS analysis_runs (
        id                 TEXT PRIMARY KEY,
        analysis_type      TEXT NOT NULL,
        session_id         TEXT REFERENCES sessions(id),
        status             TEXT NOT NULL CHECK (status IN ('completed', 'unavailable', 'failed', 'rejected')),
        unavailable_reason TEXT,
        provider           TEXT,
        model              TEXT,
        prompt_version     TEXT NOT NULL,
        system_prompt      TEXT,
        input_prompt       TEXT,
        input_summary_json TEXT NOT NULL CHECK (json_valid(input_summary_json)),
        output_json        TEXT,
        input_tokens       INTEGER CHECK (input_tokens IS NULL OR input_tokens >= 0),
        output_tokens      INTEGER CHECK (output_tokens IS NULL OR output_tokens >= 0),
        duration_ms        INTEGER CHECK (duration_ms IS NULL OR duration_ms >= 0),
        created_at         TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_analysis_runs_session
        ON analysis_runs(session_id, created_at DESC, id DESC);
      CREATE INDEX IF NOT EXISTS idx_analysis_runs_type
        ON analysis_runs(analysis_type, created_at DESC, id DESC);
      CREATE TRIGGER IF NOT EXISTS analysis_runs_no_update
        BEFORE UPDATE ON analysis_runs BEGIN
          SELECT RAISE(ABORT, 'analysis run records are immutable');
        END;
      CREATE TRIGGER IF NOT EXISTS analysis_runs_no_delete
        BEFORE DELETE ON analysis_runs BEGIN
          SELECT RAISE(ABORT, 'analysis run records are immutable');
        END;
    `);

    // Legacy prompt scores produced without any imported conversation are not
    // evidence. Preserve the row for local audit, but remove it from normal UI
    // queries and resume detection so a corrected import can be analyzed again.
    const tables = db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all() as Array<{ name: string }>;
    const tableNames = new Set(tables.map((row) => row.name));
    const sessionColumns = tableNames.has('sessions')
      ? new Set((db.prepare(`PRAGMA table_info(sessions)`).all() as Array<{ name: string }>).map((row) => row.name))
      : new Set<string>();
    const supportsEligibilityAudit = sessionColumns.has('user_message_count')
      && sessionColumns.has('assistant_message_count');
    if (tableNames.has('insights') && supportsEligibilityAudit) {
      db.exec(`
        UPDATE insights
        SET source = 'invalidated',
            metadata = json_set(COALESCE(metadata, '{}'),
              '$.analysis_state', 'unavailable',
              '$.unavailable_reason', 'legacy-insufficient-evidence')
        WHERE type = 'prompt_quality'
          AND session_id IN (
            SELECT id FROM sessions
            WHERE user_message_count < 2 OR assistant_message_count < 1
          );
      `);
    }
    if (tableNames.has('analysis_usage') && supportsEligibilityAudit) {
      db.exec(`
        DELETE FROM analysis_usage
        WHERE analysis_type = 'prompt_quality'
          AND session_id IN (
            SELECT id FROM sessions
            WHERE user_message_count < 2 OR assistant_message_count < 1
          );
      `);
    }
    db.prepare('INSERT OR IGNORE INTO schema_version (version) VALUES (?)').run(26);
  })();
}

function createV23FrontierSupport(db: Database.Database): void {
  db.exec(`
      CREATE TABLE IF NOT EXISTS analysis_frontier_events (
        source_tool  TEXT NOT NULL,
        session_id   TEXT NOT NULL,
        turn_id      TEXT NOT NULL,
        source_basis TEXT NOT NULL DEFAULT '',
        observed_at  TEXT NOT NULL,
        PRIMARY KEY (source_tool, session_id, turn_id, source_basis)
      );
      CREATE INDEX IF NOT EXISTS idx_analysis_frontier_events_session
        ON analysis_frontier_events(source_tool, session_id, observed_at DESC);
  `);
}

function applyV27(db: Database.Database): void {
  db.transaction(() => {
    // Early v23 builds could persist the version marker after expanding
    // analysis_queue without creating its companion frontier table. Re-run the
    // idempotent support DDL so Stop hooks never fail silently on those DBs.
    createV23FrontierSupport(db);
    db.prepare('INSERT OR IGNORE INTO schema_version (version) VALUES (?)').run(27);
  })();
}

function applyV28(db: Database.Database): void {
  db.transaction(() => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS token_usage_hourly (
        hour                  TEXT PRIMARY KEY,
        input_tokens          INTEGER NOT NULL DEFAULT 0,
        output_tokens         INTEGER NOT NULL DEFAULT 0,
        cache_creation_tokens INTEGER NOT NULL DEFAULT 0,
        cache_read_tokens     INTEGER NOT NULL DEFAULT 0,
        reasoning_tokens      INTEGER NOT NULL DEFAULT 0,
        event_count           INTEGER NOT NULL DEFAULT 0,
        updated_at            TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_source_artifacts_locator_latest
        ON source_artifacts(locator_hash, created_at, id);
    `);
    db.prepare(`UPDATE canonical_projection_state
      SET dirty = 1, updated_at = datetime('now') WHERE id = 1`).run();
    db.prepare('INSERT OR IGNORE INTO schema_version (version) VALUES (?)').run(28);
  })();
}

function applyV29(db: Database.Database): void {
  db.transaction(() => {
    // This product has not shipped with the old cross-session report format.
    // Remove only derived report caches so the new plan vocabulary and source
    // contract never mix with historical output. Raw sessions and events remain.
    db.exec(`
      DROP TRIGGER IF EXISTS analysis_runs_no_delete;
      DELETE FROM analysis_runs
        WHERE analysis_type IN ('behavior_report', 'behavior_research', 'behavior_coach');
      CREATE TRIGGER analysis_runs_no_delete
        BEFORE DELETE ON analysis_runs BEGIN
          SELECT RAISE(ABORT, 'analysis run records are immutable');
        END;

      CREATE TABLE IF NOT EXISTS knowledge_snapshots (
        id                    TEXT PRIMARY KEY,
        scope                 TEXT NOT NULL CHECK (scope IN ('weekly', 'topic')),
        topic                 TEXT,
        snapshot_version      TEXT NOT NULL,
        prompt_version        TEXT NOT NULL,
        status                TEXT NOT NULL CHECK (status IN ('completed', 'failed')),
        research_run_id       TEXT REFERENCES analysis_runs(id),
        source_count          INTEGER NOT NULL DEFAULT 0 CHECK (source_count >= 0),
        practice_count        INTEGER NOT NULL DEFAULT 0 CHECK (practice_count >= 0),
        query_summary_json    TEXT NOT NULL CHECK (json_valid(query_summary_json)),
        output_json           TEXT NOT NULL CHECK (json_valid(output_json)),
        created_at            TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_knowledge_snapshots_scope_created
        ON knowledge_snapshots(scope, created_at DESC, id DESC);

      CREATE TABLE IF NOT EXISTS knowledge_practices (
        id                    TEXT PRIMARY KEY,
        snapshot_id           TEXT NOT NULL REFERENCES knowledge_snapshots(id) ON DELETE CASCADE,
        title                 TEXT NOT NULL,
        summary               TEXT NOT NULL,
        applicability         TEXT NOT NULL,
        source_trust          TEXT NOT NULL CHECK (source_trust IN ('official', 'high', 'medium', 'limited')),
        discussion_breadth    TEXT NOT NULL CHECK (discussion_breadth IN ('high', 'medium', 'low', 'unknown')),
        recency               TEXT NOT NULL,
        local_relevance       TEXT NOT NULL CHECK (local_relevance IN ('high', 'medium', 'low', 'unknown')),
        local_effect_status   TEXT NOT NULL CHECK (local_effect_status IN ('supported', 'not-reviewed', 'insufficient', 'negative')),
        rationale             TEXT NOT NULL,
        tags_json             TEXT NOT NULL CHECK (json_valid(tags_json)),
        source_refs_json      TEXT NOT NULL CHECK (json_valid(source_refs_json)),
        conflicts_json        TEXT NOT NULL CHECK (json_valid(conflicts_json)),
        created_at            TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_knowledge_practices_snapshot
        ON knowledge_practices(snapshot_id, source_trust, title);

      CREATE TABLE IF NOT EXISTS improvement_plans (
        id                    TEXT PRIMARY KEY,
        source_practice_id    TEXT REFERENCES knowledge_practices(id),
        knowledge_snapshot_id TEXT REFERENCES knowledge_snapshots(id),
        report_run_id         TEXT REFERENCES analysis_runs(id),
        title                 TEXT NOT NULL,
        hypothesis            TEXT NOT NULL,
        applicability         TEXT NOT NULL,
        review_plan_json      TEXT NOT NULL CHECK (json_valid(review_plan_json)),
        status                TEXT NOT NULL CHECK (status IN (
          'queued', 'observing', 'review-ready', 'reviewed', 'paused', 'ended'
        )),
        sequence              INTEGER NOT NULL DEFAULT 1 CHECK (sequence BETWEEN 1 AND 3),
        matched_task_count    INTEGER NOT NULL DEFAULT 0 CHECK (matched_task_count >= 0),
        adoption_signal_count INTEGER NOT NULL DEFAULT 0 CHECK (adoption_signal_count >= 0),
        max_task_count        INTEGER NOT NULL DEFAULT 30 CHECK (max_task_count BETWEEN 1 AND 30),
        max_observation_days  INTEGER NOT NULL DEFAULT 45 CHECK (max_observation_days BETWEEN 1 AND 45),
        evidence_cutoff       TEXT,
        created_at            TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at            TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_improvement_plans_status
        ON improvement_plans(status, sequence, created_at DESC);

      CREATE TABLE IF NOT EXISTS improvement_observations (
        id                    TEXT PRIMARY KEY,
        plan_id               TEXT NOT NULL REFERENCES improvement_plans(id) ON DELETE CASCADE,
        task_id               TEXT NOT NULL,
        signal                TEXT NOT NULL CHECK (signal IN (
          'eligible', 'adoption-observed', 'adoption-not-observed',
          'counter-evidence', 'negative-impact'
        )),
        rationale             TEXT NOT NULL,
        evidence_refs_json    TEXT NOT NULL CHECK (json_valid(evidence_refs_json)),
        analysis_run_id       TEXT REFERENCES analysis_runs(id),
        created_at            TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(plan_id, task_id, signal)
      );
      CREATE INDEX IF NOT EXISTS idx_improvement_observations_plan
        ON improvement_observations(plan_id, created_at DESC);

      CREATE TABLE IF NOT EXISTS improvement_reviews (
        id                    TEXT PRIMARY KEY,
        plan_id               TEXT NOT NULL REFERENCES improvement_plans(id) ON DELETE CASCADE,
        outcome               TEXT NOT NULL CHECK (outcome IN (
          'improved', 'no-clear-improvement', 'insufficient-evidence', 'negative-impact'
        )),
        rationale             TEXT NOT NULL,
        supporting_refs_json  TEXT NOT NULL CHECK (json_valid(supporting_refs_json)),
        opposing_refs_json    TEXT NOT NULL CHECK (json_valid(opposing_refs_json)),
        limitations_json      TEXT NOT NULL CHECK (json_valid(limitations_json)),
        analysis_run_id       TEXT REFERENCES analysis_runs(id),
        created_at            TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_improvement_reviews_plan
        ON improvement_reviews(plan_id, created_at DESC);

      CREATE TABLE IF NOT EXISTS improvement_feedback (
        id                    TEXT PRIMARY KEY,
        plan_id               TEXT NOT NULL REFERENCES improvement_plans(id) ON DELETE CASCADE,
        kind                  TEXT NOT NULL CHECK (kind IN (
          'judgment-wrong', 'not-applicable', 'continue-observing', 'end-tracking'
        )),
        note                  TEXT,
        created_at            TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_improvement_feedback_plan
        ON improvement_feedback(plan_id, created_at DESC);
    `);
    db.prepare('INSERT OR IGNORE INTO schema_version (version) VALUES (?)').run(29);
  })();
}

function applyV30(db: Database.Database): void {
  db.transaction(() => {
    // V29 briefly tied review evidence to work_tasks, a projection that is
    // intentionally deleted and rebuilt after canonical imports. This product
    // has not shipped, so clear the derived tracking cache and recreate the
    // observation ledger with a stable opaque task reference. Raw events and
    // sessions are untouched.
    db.exec(`
      DELETE FROM improvement_reviews;
      DELETE FROM improvement_feedback;
      DELETE FROM improvement_observations;
      DELETE FROM improvement_plans;
      DROP TABLE improvement_observations;
      CREATE TABLE improvement_observations (
        id                    TEXT PRIMARY KEY,
        plan_id               TEXT NOT NULL REFERENCES improvement_plans(id) ON DELETE CASCADE,
        task_id               TEXT NOT NULL,
        signal                TEXT NOT NULL CHECK (signal IN (
          'eligible', 'adoption-observed', 'adoption-not-observed',
          'counter-evidence', 'negative-impact'
        )),
        rationale             TEXT NOT NULL,
        evidence_refs_json    TEXT NOT NULL CHECK (json_valid(evidence_refs_json)),
        analysis_run_id       TEXT REFERENCES analysis_runs(id),
        created_at            TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(plan_id, task_id, signal)
      );
      CREATE INDEX idx_improvement_observations_plan
        ON improvement_observations(plan_id, created_at DESC);
    `);
    db.prepare('INSERT OR IGNORE INTO schema_version (version) VALUES (?)').run(30);
  })();
}
