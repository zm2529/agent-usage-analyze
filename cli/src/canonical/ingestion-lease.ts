import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';

export interface IngestionLease {
  release(): void;
}

interface IngestionLeaseOptions {
  timeoutMs?: number;
  pollMs?: number;
}

const noOpLease: IngestionLease = {
  release() {},
};

function tryAcquireIngestionLease(databasePath: string): IngestionLease | null {
  const root = `${databasePath}.ingestion`;
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const lockDb = new Database(join(root, 'lock.db'));
  try {
    lockDb.pragma('busy_timeout = 0');
    lockDb.pragma('journal_mode = DELETE');
    lockDb.exec('CREATE TABLE IF NOT EXISTS ingestion_lock (id INTEGER PRIMARY KEY CHECK (id = 1));');
    lockDb.prepare('INSERT OR IGNORE INTO ingestion_lock (id) VALUES (1)').run();
    lockDb.exec('BEGIN EXCLUSIVE');
    lockDb.prepare('UPDATE ingestion_lock SET id = 1 WHERE id = 1').run();
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
  } catch (error) {
    lockDb.close();
    if ((error as { code?: unknown }).code === 'SQLITE_BUSY') return null;
    throw error;
  }
}

/**
 * Serialize canonical ingestion across dashboard, hook, and CLI processes.
 * SQLite permits only one writer, and projection rebuilds can outlive the
 * normal busy timeout. Waiting on a sidecar lease prevents two import runs
 * from repeatedly interrupting each other on the product database.
 */
export async function acquireIngestionLease(
  databasePath: string,
  options: IngestionLeaseOptions = {},
): Promise<IngestionLease> {
  if (!databasePath || databasePath === ':memory:') return noOpLease;
  const timeoutMs = Math.max(1, options.timeoutMs ?? 15 * 60_000);
  const pollMs = Math.max(1, options.pollMs ?? 250);
  const deadline = Date.now() + timeoutMs;
  while (true) {
    const lease = tryAcquireIngestionLease(databasePath);
    if (lease) return lease;
    if (Date.now() >= deadline) {
      throw Object.assign(
        new Error('Another history import is still running'),
        { code: 'SQLITE_BUSY' },
      );
    }
    await new Promise<void>((resolvePromise) => setTimeout(resolvePromise, pollMs));
  }
}
