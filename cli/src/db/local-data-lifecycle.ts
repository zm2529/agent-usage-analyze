import { chmodSync, existsSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import Database from 'better-sqlite3';
import { acquireDatabaseExclusive } from './lifecycle-lock.js';

export interface LocalDataArchiveResult {
  status: 'archived' | 'nothing-to-archive';
  databaseBackupPath: string | null;
  syncStateBackupPath: string | null;
  rebuildCommand: 'agent-usage-analyze import-codex';
  recovery: string;
}

interface LocalDataArchiveOptions {
  dbPath: string;
  syncStatePath: string;
  now?: string;
}

function moveIfPresent(source: string, destination: string): boolean {
  if (!existsSync(source)) return false;
  renameSync(source, destination);
  chmodSync(destination, 0o600);
  return true;
}

export function archiveLocalAnalysisData(options: LocalDataArchiveOptions): LocalDataArchiveResult {
  const now = new Date(options.now ?? Date.now());
  if (!Number.isFinite(now.getTime())) throw new Error('Archive time is invalid');
  const exclusive = acquireDatabaseExclusive(options.dbPath);
  try {
    const hasDatabase = existsSync(options.dbPath);
    const hasSyncState = existsSync(options.syncStatePath);
    if (!hasDatabase && !hasSyncState) {
      return {
        status: 'nothing-to-archive',
        databaseBackupPath: null,
        syncStateBackupPath: null,
        rebuildCommand: 'agent-usage-analyze import-codex',
        recovery: 'No local analysis data existed; run the rebuild command to create it.',
      };
    }

    const stamp = now.toISOString().replace(/[-:.]/g, '');
    const backupDir = join(dirname(options.dbPath), 'backups', `local-data-${stamp}`);
    mkdirSync(backupDir, { recursive: true, mode: 0o700 });
    const databaseBackupPath = hasDatabase ? join(backupDir, `${basename(options.dbPath)}.backup`) : null;
    const syncStateBackupPath = hasSyncState
      ? join(backupDir, basename(options.syncStatePath))
      : null;
    const moved: Array<{ source: string; destination: string }> = [];

    try {
      if (hasDatabase) {
        const db = new Database(options.dbPath);
        try {
          db.pragma('busy_timeout = 250');
          const [checkpoint] = db.pragma('wal_checkpoint(TRUNCATE)') as Array<{
            busy: number; log: number; checkpointed: number;
          }>;
          if (checkpoint?.busy) {
            throw new Error('Local analysis database is active; close other readers before archiving');
          }
        } finally {
          db.close();
        }
        renameSync(options.dbPath, databaseBackupPath!);
        chmodSync(databaseBackupPath!, 0o600);
        moved.push({ source: options.dbPath, destination: databaseBackupPath! });
        for (const suffix of ['-wal', '-shm']) {
          const source = `${options.dbPath}${suffix}`;
          const destination = `${databaseBackupPath}${suffix}`;
          if (moveIfPresent(source, destination)) moved.push({ source, destination });
        }
      }
      if (hasSyncState) {
        renameSync(options.syncStatePath, syncStateBackupPath!);
        chmodSync(syncStateBackupPath!, 0o600);
        moved.push({ source: options.syncStatePath, destination: syncStateBackupPath! });
      }
    } catch (error) {
      for (const item of moved.reverse()) {
        if (existsSync(item.destination) && !existsSync(item.source)) {
          renameSync(item.destination, item.source);
        }
      }
      rmSync(backupDir, { recursive: true, force: true });
      throw error;
    }

    return {
      status: 'archived',
      databaseBackupPath,
      syncStateBackupPath,
      rebuildCommand: 'agent-usage-analyze import-codex',
      recovery: `Restore ${backupDir} to its original paths, or run the rebuild command. Source history and Git repositories were not changed.`,
    };
  } finally {
    exclusive.release();
  }
}
