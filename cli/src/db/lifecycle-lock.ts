import { mkdirSync } from 'node:fs';
import Database from 'better-sqlite3';

export interface DatabaseLifecycleLease {
  release(): void;
}

function openLockDatabase(dbPath: string): Database.Database {
  const root = `${dbPath}.lifecycle`;
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const lockDb = new Database(`${root}/lock.db`);
  try {
    lockDb.pragma('busy_timeout = 0');
    lockDb.pragma('journal_mode = DELETE');
    const initialized = lockDb.prepare(`SELECT 1 FROM sqlite_schema
      WHERE type = 'table' AND name = 'lifecycle_lock'`).get();
    if (!initialized) {
      lockDb.exec(`CREATE TABLE lifecycle_lock (
        id INTEGER PRIMARY KEY CHECK (id = 1)
      ); INSERT INTO lifecycle_lock (id) VALUES (1);`);
    }
    return lockDb;
  } catch (error) {
    lockDb.close();
    throw error;
  }
}

function lease(lockDb: Database.Database): DatabaseLifecycleLease {
  let released = false;
  return {
    release() {
      if (released) return;
      released = true;
      try {
        if (lockDb.inTransaction) lockDb.exec('ROLLBACK');
      } finally {
        lockDb.close();
      }
    },
  };
}

function lifecycleBusy(error: unknown): boolean {
  return (error as { code?: unknown }).code === 'SQLITE_BUSY';
}

/**
 * Hold a shared OS-backed SQLite read lock for the lifetime of a product DB
 * connection. The kernel releases it automatically if the process exits.
 */
export function acquireDatabaseOwner(dbPath: string): DatabaseLifecycleLease {
  let lockDb: Database.Database | null = null;
  try {
    lockDb = openLockDatabase(dbPath);
    lockDb.exec('BEGIN');
    lockDb.prepare('SELECT id FROM lifecycle_lock LIMIT 1').get();
    return lease(lockDb);
  } catch (error) {
    lockDb?.close();
    if (lifecycleBusy(error)) {
      throw new Error('Local analysis database lifecycle operation is in progress');
    }
    throw error;
  }
}

/**
 * Hold an exclusive OS-backed SQLite lock while migration/archive owns the DB.
 * Existing owners block acquisition; crashes cannot leave a stale PID lease.
 */
export function acquireDatabaseExclusive(dbPath: string): DatabaseLifecycleLease {
  let lockDb: Database.Database | null = null;
  try {
    lockDb = openLockDatabase(dbPath);
    lockDb.exec('BEGIN EXCLUSIVE');
    lockDb.prepare('UPDATE lifecycle_lock SET id = 1 WHERE id = 1').run();
    return lease(lockDb);
  } catch (error) {
    lockDb?.close();
    if (lifecycleBusy(error)) {
      throw new Error('Local analysis database is active or another lifecycle operation is in progress');
    }
    throw error;
  }
}
