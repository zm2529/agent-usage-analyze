import { createHash, randomUUID } from 'node:crypto';
import {
  closeSync,
  copyFileSync,
  chmodSync,
  constants,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join } from 'node:path';
import Database from 'better-sqlite3';
import { runMigrations } from './migrate.js';
import { CURRENT_SCHEMA_VERSION } from './schema.js';
import { acquireDatabaseExclusive } from './lifecycle-lock.js';

export interface ProductMigrationResult {
  status: 'initialized' | 'migrated' | 'current';
  migrationId: string;
  sourceSchemaVersion: number;
  targetSchemaVersion: number;
  backupPath: string | null;
  reportPath: string;
  reconciliation: {
    legacySessions: number;
    canonicalTasks: number;
    legacyMessages: number;
    canonicalEvents: number;
  };
}

interface ProductMigrationOptions {
  dbPath: string;
  now?: string;
  failAfterBackfill?: boolean;
  failAfterReport?: boolean;
  injectBackfillConflict?: boolean;
  failSidecarQuarantine?: boolean;
  failSidecarCleanup?: boolean;
  failRestoreBeforeSwap?: boolean;
}

interface LegacySession {
  id: string;
  startedAt: string;
  endedAt: string;
  sourceTool: string | null;
}

interface LegacyMessage {
  id: string;
  sessionId: string;
  type: string;
  timestamp: string;
  parentId: string | null;
}

function tableExists(db: Database.Database, name: string): boolean {
  return Boolean(db.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`).get(name));
}

function currentVersion(db: Database.Database): number {
  if (!tableExists(db, 'schema_version')) return 0;
  return (db.prepare('SELECT COALESCE(MAX(version), 0) AS version FROM schema_version').get() as {
    version: number;
  }).version;
}

export function assertCanonicalAutoMigrationAllowed(db: Database.Database): void {
  const version = currentVersion(db);
  if (version > 0 && version < 10) {
    throw new Error(
      `Legacy schema V${version} requires backup-first migration; run agent-analytics migrate-product`,
    );
  }
}

function opaqueHash(namespace: string, value: string): string {
  return `${namespace}:sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function removeIfPresent(path: string): void {
  if (existsSync(path)) unlinkSync(path);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function quarantineSidecars(
  dbPath: string,
  migrationId: string,
  injectFailure = false,
  injectCleanupFailure = false,
): { warnings: string[]; residualSidecars: string[] } {
  const failureDir = join(dirname(dbPath), 'migration-failures');
  const warnings: string[] = [];
  const residualSidecars: string[] = [];
  for (const suffix of ['-wal', '-shm']) {
    const source = `${dbPath}${suffix}`;
    if (!existsSync(source)) continue;
    try {
      if (injectFailure) throw new Error('Injected sidecar quarantine failure');
      mkdirSync(failureDir, { recursive: true, mode: 0o700 });
      const destination = join(failureDir, `${migrationId.replace(/:/g, '-')}${suffix}`);
      renameSync(source, destination);
      chmodSync(destination, 0o600);
    } catch (error) {
      warnings.push(`${suffix} quarantine failed: ${errorMessage(error)}`);
      try {
        if (injectCleanupFailure) throw new Error('Injected sidecar cleanup failure');
        rmSync(source, { force: true });
      } catch (cleanupError) {
        warnings.push(`${suffix} cleanup failed: ${errorMessage(cleanupError)}`);
      }
      if (existsSync(source)) residualSidecars.push(source);
    }
  }
  return { warnings, residualSidecars };
}

interface RestoreOutcome {
  restored: boolean;
  recoveryCandidate: string | null;
  error: string | null;
}

function sha256File(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function syncPath(path: string): void {
  const descriptor = openSync(path, 'r');
  try {
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

function restoreBackupAtomically(
  backupPath: string,
  dbPath: string,
  migrationId: string,
  blockSwapReason: string | null,
): RestoreOutcome {
  const token = migrationId.replace(/:/g, '-');
  const candidate = join(dirname(dbPath), `.${basename(dbPath)}.${token}.restore.tmp`);
  const recoveryCandidate = join(dirname(dbPath), `${basename(dbPath)}.${token}.recovered`);
  let validated = false;
  try {
    copyFileSync(backupPath, candidate, constants.COPYFILE_EXCL);
    chmodSync(candidate, 0o600);
    if (sha256File(candidate) !== sha256File(backupPath)) {
      throw new Error('Restored database candidate checksum does not match backup');
    }
    const validationDb = new Database(candidate, { readonly: true, fileMustExist: true });
    try {
      const result = validationDb.pragma('quick_check') as Array<{ quick_check: string }>;
      if (result[0]?.quick_check !== 'ok') throw new Error('Restored database candidate failed quick_check');
    } finally {
      validationDb.close();
    }
    syncPath(candidate);
    validated = true;
    if (blockSwapReason) throw new Error(blockSwapReason);
    renameSync(candidate, dbPath);
    syncPath(dirname(dbPath));
    return { restored: true, recoveryCandidate: null, error: null };
  } catch (error) {
    let preserved: string | null = null;
    if (existsSync(candidate)) {
      if (validated) {
        try {
          renameSync(candidate, recoveryCandidate);
          preserved = recoveryCandidate;
        } catch {
          preserved = candidate;
        }
      } else {
        rmSync(candidate, { force: true });
      }
    }
    return { restored: false, recoveryCandidate: preserved, error: errorMessage(error) };
  }
}

function writeRecoveryStatus(
  dbPath: string,
  migrationId: string,
  status: Record<string, unknown>,
): string {
  const failureDir = join(dirname(dbPath), 'migration-failures');
  mkdirSync(failureDir, { recursive: true, mode: 0o700 });
  const path = join(failureDir, `${migrationId.replace(/:/g, '-')}-recovery.json`);
  writeFileSync(path, `${JSON.stringify(status, null, 2)}\n`, { mode: 0o600 });
  return path;
}

function loadCompleted(db: Database.Database, dbPath: string): ProductMigrationResult | null {
  if (!tableExists(db, 'product_migration_runs')) return null;
  const row = db.prepare(`SELECT id, report_json AS reportJson
    FROM product_migration_runs ORDER BY completed_at DESC, id DESC LIMIT 1`).get() as {
      id: string; reportJson: string;
    } | undefined;
  if (!row) return null;
  const stored = JSON.parse(row.reportJson) as Omit<ProductMigrationResult, 'status' | 'backupPath' | 'reportPath'> & {
    backupFile: string | null; reportFile: string;
  };
  const root = dirname(dbPath);
  return {
    status: 'current',
    migrationId: row.id,
    sourceSchemaVersion: stored.sourceSchemaVersion,
    targetSchemaVersion: stored.targetSchemaVersion,
    backupPath: stored.backupFile ? join(root, 'backups', stored.backupFile) : null,
    reportPath: join(root, 'migration-reports', stored.reportFile),
    reconciliation: stored.reconciliation,
  };
}

function backfillLegacy(db: Database.Database, migrationId: string): ProductMigrationResult['reconciliation'] {
  const sessions = tableExists(db, 'sessions')
    ? db.prepare(`SELECT id, started_at AS startedAt, ended_at AS endedAt,
        source_tool AS sourceTool FROM sessions ORDER BY started_at, id`).all() as LegacySession[]
    : [];
  const messages = tableExists(db, 'messages')
    ? db.prepare(`SELECT id, session_id AS sessionId, type, timestamp,
        parent_id AS parentId FROM messages ORDER BY session_id, timestamp, id`).all() as LegacyMessage[]
    : [];
  if (sessions.length === 0) {
    return { legacySessions: 0, canonicalTasks: 0, legacyMessages: messages.length, canonicalEvents: 0 };
  }

  const eraId = opaqueHash('era', `${migrationId}:legacy`);
  const expectedTaskIds = sessions.map((session) => opaqueHash('task', `legacy-session:${session.id}`)).sort();
  const expectedEventIds = messages.map((message) => opaqueHash('event', `legacy-message:${message.id}`)).sort();
  const startsAt = sessions[0]!.startedAt;
  const endsAt = sessions.reduce((latest, session) =>
    session.endedAt > latest ? session.endedAt : latest, sessions[0]!.endedAt);
  db.prepare(`INSERT OR IGNORE INTO observation_eras
    (id, name, mode, parser_version, capabilities_json, starts_at, ends_at)
    VALUES (?, 'Legacy Code Insights import', 'historical-backfill',
      'legacy-code-insights-v1', ?, ?, ?)`).run(
    eraId, JSON.stringify(['legacy-session-structure', 'legacy-message-metadata']), startsAt, endsAt,
  );

  const messagesBySession = new Map<string, LegacyMessage[]>();
  for (const message of messages) {
    const rows = messagesBySession.get(message.sessionId) ?? [];
    rows.push(message);
    messagesBySession.set(message.sessionId, rows);
  }
  for (const session of sessions) {
    const taskId = opaqueHash('task', `legacy-session:${session.id}`);
    const threadId = opaqueHash('thread', `legacy-session:${session.id}`);
    const artifactId = opaqueHash('source', `legacy-session:${session.id}`);
    db.prepare(`INSERT OR IGNORE INTO source_artifacts
      (id, source_kind, parser_version, locator_hash, observed_at, content_hash,
       cursor, cursor_position, era_id)
      VALUES (?, 'legacy-code-insights', 'legacy-code-insights-v1', ?, ?, NULL, ?, ?, ?)`)
      .run(artifactId, opaqueHash('locator', session.id), session.endedAt,
        `legacy-message-count:${messagesBySession.get(session.id)?.length ?? 0}`,
        messagesBySession.get(session.id)?.length ?? 0, eraId);
    db.prepare(`INSERT OR IGNORE INTO work_tasks
      (id, root_task_id, thread_id, role, status, started_at, ended_at, era_id)
      VALUES (?, ?, ?, 'root', 'completed', ?, ?, ?)`)
      .run(taskId, taskId, threadId, session.startedAt, session.endedAt, eraId);

    const sessionMessages = messagesBySession.get(session.id) ?? [];
    const eventByMessage = new Map(sessionMessages.map((message) => [
      message.id, opaqueHash('event', `legacy-message:${message.id}`),
    ]));
    for (const [sequence, message] of sessionMessages.entries()) {
      const normalizedType = ['user', 'assistant', 'system', 'tool'].includes(message.type)
        ? message.type : 'unknown';
      const actor = normalizedType === 'user' ? 'user'
        : normalizedType === 'assistant' ? 'assistant'
          : normalizedType === 'tool' ? 'tool' : 'system';
      const kind = normalizedType === 'user' ? 'user-message'
        : normalizedType === 'assistant' ? 'assistant-message'
          : normalizedType === 'tool' ? 'tool-result' : 'system-message';
      db.prepare(`INSERT OR IGNORE INTO canonical_events
        (id, source_artifact_id, era_id, native_event_id, sequence, occurred_at,
         kind, actor, sensitivity, payload_json, parent_event_id, task_id, thread_id,
         parser_version, payload_ref)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'structural', ?, ?, ?, ?,
          'legacy-code-insights-v1', ?)`)
        .run(
          eventByMessage.get(message.id), artifactId, eraId,
          opaqueHash('native', message.id), sequence, message.timestamp, kind, actor,
          JSON.stringify({ legacyMessageType: normalizedType }),
          message.parentId ? eventByMessage.get(message.parentId) ?? null : null,
          taskId, threadId, opaqueHash('legacy-payload', message.id),
        );
    }
    db.prepare(`INSERT OR REPLACE INTO source_ingestion_stats
      (source_artifact_id, discovered_count, parsed_count, skipped_count,
       failed_count, unknown_count, diagnostics_json, updated_at)
      VALUES (?, ?, ?, 0, 0, 0, '[]', datetime('now'))`)
      .run(artifactId, sessionMessages.length, sessionMessages.length);
  }
  db.prepare(`UPDATE canonical_projection_state SET dirty = 0, updated_at = datetime('now')
    WHERE id = 1`).run();
  const actualTaskIds = (db.prepare(`SELECT id FROM work_tasks WHERE era_id = ? ORDER BY id`)
    .all(eraId) as Array<{ id: string }>).map((row) => row.id);
  const actualEventIds = (db.prepare(`SELECT id FROM canonical_events WHERE era_id = ? ORDER BY id`)
    .all(eraId) as Array<{ id: string }>).map((row) => row.id);
  if (JSON.stringify(actualTaskIds) !== JSON.stringify(expectedTaskIds)
      || JSON.stringify(actualEventIds) !== JSON.stringify(expectedEventIds)) {
    throw new Error('Legacy-to-canonical identity reconciliation failed');
  }
  return {
    legacySessions: sessions.length,
    canonicalTasks: actualTaskIds.length,
    legacyMessages: messages.length,
    canonicalEvents: actualEventIds.length,
  };
}

function protectLegacyTables(db: Database.Database): void {
  const legacyTables = [
    'projects', 'sessions', 'messages', 'insights', 'session_facets', 'reflect_snapshots',
    'analysis_usage', 'usage_stats',
  ];
  for (const table of legacyTables) {
    if (!tableExists(db, table)) continue;
    for (const operation of ['INSERT', 'UPDATE', 'DELETE'] as const) {
      const suffix = operation.toLowerCase();
      db.exec(`CREATE TRIGGER IF NOT EXISTS legacy_readonly_${table}_${suffix}
        BEFORE ${operation} ON ${table} BEGIN
          SELECT RAISE(ABORT, 'legacy tables are read-only after canonical migration');
        END;`);
    }
  }
}

export function expandProjectContract(options: ProductMigrationOptions): ProductMigrationResult {
  const exclusive = acquireDatabaseExclusive(options.dbPath);
  try {
    return expandProjectContractLocked(options);
  } finally {
    exclusive.release();
  }
}

function expandProjectContractLocked(options: ProductMigrationOptions): ProductMigrationResult {
  const now = new Date(options.now ?? Date.now());
  if (!Number.isFinite(now.getTime())) throw new Error('Migration time is invalid');
  const completedAt = now.toISOString();
  const dbPath = options.dbPath;
  const root = dirname(dbPath);
  const backupsDir = join(root, 'backups');
  const reportsDir = join(root, 'migration-reports');
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const existed = existsSync(dbPath);
  let db: Database.Database | null = new Database(dbPath);
  const sourceSchemaVersion = currentVersion(db);
  const completed = loadCompleted(db, dbPath);
  if (completed) {
    db.close();
    return completed;
  }
  if (sourceSchemaVersion > 0 && sourceSchemaVersion < 9) {
    db.close();
    throw new Error(`Unsupported legacy schema version ${sourceSchemaVersion}; upgrade to V9 first`);
  }
  if (sourceSchemaVersion > CURRENT_SCHEMA_VERSION) {
    db.close();
    throw new Error(`Database schema ${sourceSchemaVersion} is newer than this product`);
  }

  const migrationId = `product-migration:${randomUUID()}`;
  const legacy = sourceSchemaVersion > 0 && sourceSchemaVersion < 10;
  let backupPath: string | null = null;
  let reportPath = '';
  try {
    if (legacy) {
      mkdirSync(backupsDir, { recursive: true, mode: 0o700 });
      const stamp = completedAt.replace(/[-:.]/g, '');
      backupPath = join(backupsDir, `data.pre-canonical-v${sourceSchemaVersion}.${stamp}.backup`);
      db.prepare('VACUUM INTO ?').run(backupPath);
      chmodSync(backupPath, 0o600);
    }

    runMigrations(db);
    if (legacy && options.injectBackfillConflict) {
      const conflictEra = opaqueHash('era', 'injected-conflict');
      const conflictTask = opaqueHash('task', 'legacy-session:session:private');
      db.prepare(`INSERT INTO observation_eras
        (id, name, mode, parser_version, capabilities_json, starts_at)
        VALUES (?, 'Injected conflict', 'historical-backfill', 'fixture-conflict', '[]', ?)`)
        .run(conflictEra, completedAt);
      db.prepare(`INSERT INTO work_tasks
        (id, root_task_id, thread_id, role, status, started_at, ended_at, era_id)
        VALUES (?, ?, 'thread:conflict', 'root', 'completed', ?, ?, ?)`)
        .run(conflictTask, conflictTask, completedAt, completedAt, conflictEra);
    }
    const reconciliation = legacy
      ? db.transaction(() => {
        const counts = backfillLegacy(db!, migrationId);
        protectLegacyTables(db!);
        return counts;
      })()
      : { legacySessions: 0, canonicalTasks: 0, legacyMessages: 0, canonicalEvents: 0 };
    if (options.failAfterBackfill) throw new Error('Injected migration failure');
    if (reconciliation.legacySessions !== reconciliation.canonicalTasks
        || reconciliation.legacyMessages !== reconciliation.canonicalEvents) {
      throw new Error('Legacy-to-canonical reconciliation failed');
    }

    mkdirSync(reportsDir, { recursive: true, mode: 0o700 });
    const reportFile = `${migrationId.replace(/:/g, '-')}.json`;
    reportPath = join(reportsDir, reportFile);
    const stored = {
      migrationId,
      sourceSchemaVersion,
      targetSchemaVersion: CURRENT_SCHEMA_VERSION,
      backupFile: backupPath ? basename(backupPath) : null,
      reportFile,
      reconciliation,
      coverage: {
        sessions: reconciliation.legacySessions === 0 ? 1
          : reconciliation.canonicalTasks / reconciliation.legacySessions,
        messages: reconciliation.legacyMessages === 0 ? 1
          : reconciliation.canonicalEvents / reconciliation.legacyMessages,
      },
      completedAt,
    };
    const resultStatus = legacy ? 'migrated' : 'initialized';
    const temporaryReport = `${reportPath}.tmp`;
    writeFileSync(temporaryReport, `${JSON.stringify(stored, null, 2)}\n`, { mode: 0o600 });
    renameSync(temporaryReport, reportPath);
    if (options.failAfterReport) throw new Error('Injected post-report migration failure');
    db.prepare(`INSERT INTO product_migration_runs
      (id, source_schema_version, target_schema_version, status, backup_file,
       report_json, completed_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(migrationId, sourceSchemaVersion, CURRENT_SCHEMA_VERSION, resultStatus,
        stored.backupFile, JSON.stringify(stored), completedAt);
    db.close();
    db = null;
    return {
      status: resultStatus,
      migrationId,
      sourceSchemaVersion,
      targetSchemaVersion: CURRENT_SCHEMA_VERSION,
      backupPath,
      reportPath,
      reconciliation,
    };
  } catch (error) {
    db?.close();
    db = null;
    if (options.failSidecarQuarantine && !existsSync(`${dbPath}-wal`)) {
      writeFileSync(`${dbPath}-wal`, 'injected migration sidecar');
    }
    const sidecars = quarantineSidecars(
      dbPath,
      migrationId,
      options.failSidecarQuarantine,
      options.failSidecarCleanup,
    );
    const sidecarWarnings = sidecars.warnings;
    let restore: RestoreOutcome | null = null;
    if (backupPath && existsSync(backupPath)) {
      const blockSwapReason = sidecars.residualSidecars.length > 0
        ? 'Residual SQLite sidecars prevent safe atomic restore'
        : options.failRestoreBeforeSwap
          ? 'Injected atomic restore interruption before swap'
          : null;
      restore = restoreBackupAtomically(
        backupPath,
        dbPath,
        migrationId,
        blockSwapReason,
      );
    }
    else if (!existed) removeIfPresent(dbPath);
    if (reportPath) {
      for (const path of [reportPath, `${reportPath}.tmp`]) {
        try {
          removeIfPresent(path);
        } catch (cleanupError) {
          sidecarWarnings.push(`report cleanup failed: ${errorMessage(cleanupError)}`);
        }
      }
    }
    if (sidecarWarnings.length > 0 || restore?.restored === false) {
      try {
        writeRecoveryStatus(dbPath, migrationId, {
          originalError: errorMessage(error),
          backupFile: backupPath ? basename(backupPath) : null,
          restored: restore?.restored ?? null,
          recoveryCandidate: restore?.recoveryCandidate ? basename(restore.recoveryCandidate) : null,
          recoveryError: restore?.error ?? null,
          sidecarWarnings,
          residualSidecars: sidecars.residualSidecars.map((path) => basename(path)),
        });
      } catch { /* recovery evidence is best-effort; the original backup remains authoritative */ }
    }
    if (restore?.restored === false) {
      throw new Error(
        `${errorMessage(error)}; automatic restore incomplete: ${restore.error}; `
        + `backup preserved at ${backupPath}`
        + (restore.recoveryCandidate ? `; validated candidate at ${restore.recoveryCandidate}` : ''),
        { cause: error },
      );
    }
    throw error;
  }
}
