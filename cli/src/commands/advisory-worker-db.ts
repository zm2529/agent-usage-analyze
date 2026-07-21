import Database from 'better-sqlite3';
import { existsSync, statSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export function resolveReadonlyAdvisoryFilename(dbPath: string): {
  filename: string;
  snapshotMode: 'immutable';
} {
  const walPath = `${dbPath}-wal`;
  const walActive = existsSync(walPath) && statSync(walPath).size > 0;
  if (walActive) {
    throw new Error('An immutable advisory snapshot is unavailable while WAL is active');
  }
  return {
    filename: `${pathToFileURL(dbPath).href}?immutable=1&mode=ro`,
    snapshotMode: 'immutable',
  };
}

export function openReadonlyAdvisoryDatabase(dbPath: string): Database.Database {
  const { filename } = resolveReadonlyAdvisoryFilename(dbPath);
  const db = new Database(filename, { readonly: true, fileMustExist: true });
  db.pragma('query_only = ON');
  db.pragma('busy_timeout = 0');
  return db;
}
