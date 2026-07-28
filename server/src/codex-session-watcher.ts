import {
  closeSync,
  existsSync,
  openSync,
  readFileSync,
  readSync,
  statSync,
  watch,
  type FSWatcher,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { basename, isAbsolute, join, resolve } from 'node:path';
import type Database from 'better-sqlite3';
import { getDb } from 'agent-usage-analyze/db/client';
import { recordSettledFrontier } from 'agent-usage-analyze/analysis/settled-frontier';
import { spawnSettledScheduler } from 'agent-usage-analyze/analysis/settled-scheduler';
import { readCodexRolloutIdentity } from 'agent-usage-analyze/analysis/codex-source-locator';
import { recordIngestionLog } from 'agent-usage-analyze/analysis/ingestion-log';
import { getConfigDir, loadConfig } from 'agent-usage-analyze/utils/config';
import { inspectCodexHook } from 'agent-usage-analyze/utils/codex-hooks';

const DEBOUNCE_MS = 1_200;
// File notifications arrive throughout an active response. A longer fallback
// window prevents repeatedly reparsing a rollout that is still growing.
const SETTLE_SECONDS = 90;
const SESSION_META_PREFIX_BYTES = 64 * 1024;

interface RolloutSessionMeta {
  id: string;
  cwd: string;
  timestamp: string;
}

interface PersistedHookStatus {
  status?: unknown;
}

export function isTrustedHookState(
  inspected: { installed: boolean; stale: boolean; parseError?: unknown },
  status: PersistedHookStatus | null,
): boolean {
  return inspected.installed
    && !inspected.stale
    && !inspected.parseError
    && status?.status === 'recorded';
}

function hasTrustedCodexHook(): boolean {
  const inspected = inspectCodexHook();
  if (!inspected.installed || inspected.stale || inspected.parseError) return false;
  try {
    const status = JSON.parse(
      readFileSync(join(getConfigDir(), 'codex-hook-status.json'), 'utf8'),
    ) as PersistedHookStatus;
    return isTrustedHookState(inspected, status);
  } catch {
    return false;
  }
}

function withNonBlockingWrite<T>(db: Database.Database, action: () => T): T {
  const previousTimeout = db.pragma('busy_timeout', { simple: true }) as number;
  db.pragma('busy_timeout = 0');
  try {
    return action();
  } finally {
    db.pragma(`busy_timeout = ${previousTimeout}`);
  }
}

function readSessionMeta(sourcePath: string): RolloutSessionMeta | null {
  const fd = openSync(sourcePath, 'r');
  try {
    const buffer = Buffer.alloc(SESSION_META_PREFIX_BYTES);
    const bytes = readSync(fd, buffer, 0, buffer.length, 0);
    const firstLine = buffer.subarray(0, bytes).toString('utf8').split('\n', 1)[0];
    const record = JSON.parse(firstLine) as {
      type?: unknown;
      payload?: { id?: unknown; cwd?: unknown; timestamp?: unknown };
    };
    if (record.type !== 'session_meta'
      || typeof record.payload?.id !== 'string'
      || typeof record.payload.cwd !== 'string'
      || typeof record.payload.timestamp !== 'string') return null;
    return {
      id: record.payload.id,
      cwd: record.payload.cwd,
      timestamp: record.payload.timestamp,
    };
  } finally {
    closeSync(fd);
  }
}

/** Make a newly observed session visible before the heavier evidence projection finishes. */
function upsertPendingSession(
  db: Database.Database,
  sourcePath: string,
  fallbackSessionId: string,
): void {
  const meta = readSessionMeta(sourcePath);
  if (!meta) return;
  const projectPath = meta.cwd;
  const projectName = basename(projectPath) || projectPath;
  const projectId = createHash('sha256').update(projectPath).digest('hex').slice(0, 16);
  const endedAt = statSync(sourcePath).mtime.toISOString();
  db.transaction(() => {
    db.prepare(`INSERT INTO projects (
        id, name, path, project_id_source, session_count, last_activity
      ) VALUES (?, ?, ?, 'path-hash', 0, ?)
      ON CONFLICT(id) DO UPDATE SET last_activity = MAX(last_activity, excluded.last_activity)`)
      .run(projectId, projectName, projectPath, endedAt);
    const inserted = db.prepare(`INSERT OR IGNORE INTO sessions (
        id, project_id, project_name, project_path, started_at, ended_at,
        source_tool, synced_at, usage_source
      ) VALUES (?, ?, ?, ?, ?, ?, 'codex-cli', datetime('now'), 'pending-import')`)
      .run(`codex:${meta.id || fallbackSessionId}`, projectId, projectName, projectPath, meta.timestamp, endedAt);
    if (inserted.changes > 0) {
      db.prepare('UPDATE projects SET session_count = session_count + 1 WHERE id = ?').run(projectId);
    } else {
      db.prepare(`UPDATE sessions SET ended_at = MAX(ended_at, ?), synced_at = datetime('now')
        WHERE id = ?`).run(endedAt, `codex:${meta.id || fallbackSessionId}`);
    }
  }).immediate();
}

/**
 * Event-driven fallback for workspaces where Codex has not trusted the global Hook yet.
 * fs.watch uses the operating-system file notification stream; it does not poll.
 */
export function startCodexSessionWatcher(): FSWatcher | null {
  if (process.env.NODE_ENV === 'test') return null;
  if (loadConfig()?.dashboard?.capabilities?.hookCapture === false) {
    recordIngestionLog({ stage: 'watcher', outcome: 'disabled-by-config' });
    return null;
  }
  if (hasTrustedCodexHook()) {
    recordIngestionLog({ stage: 'watcher', outcome: 'skipped-trusted-hook' });
    return null;
  }
  const codexHome = process.env.AGENT_ANALYTICS_CODEX_HOME
    ?? process.env.CODEX_HOME
    ?? join(homedir(), '.codex');
  const sessionsRoot = resolve(codexHome, 'sessions');
  if (!existsSync(sessionsRoot)) {
    recordIngestionLog({ stage: 'watcher', outcome: 'sessions-root-missing', sourcePath: sessionsRoot });
    return null;
  }
  recordIngestionLog({ stage: 'watcher', outcome: 'started', sourcePath: sessionsRoot });

  const pending = new Map<string, ReturnType<typeof setTimeout>>();
  const schedule = (sourcePath: string, delayMs = DEBOUNCE_MS, attempt = 0): void => {
    const existing = pending.get(sourcePath);
    if (existing) clearTimeout(existing);
    pending.set(sourcePath, setTimeout(() => {
      pending.delete(sourcePath);
      try {
        const identity = readCodexRolloutIdentity(sourcePath);
        if (!identity) {
          recordIngestionLog({ stage: 'watcher', outcome: 'identity-unavailable', sourcePath });
          return;
        }
        const stat = statSync(sourcePath);
        const db = getDb();
        const frontier = withNonBlockingWrite(db, () => {
          const recorded = recordSettledFrontier(db, {
            source: 'codex-cli',
            sessionId: identity,
            turnId: `watch-${Math.trunc(stat.mtimeMs)}-${stat.size}`,
            locator: sourcePath,
            basis: `watch-stat:${Math.trunc(stat.mtimeMs)}:${stat.size}`,
          }, new Date(), SETTLE_SECONDS);
          upsertPendingSession(db, sourcePath, identity);
          return recorded;
        });
        recordIngestionLog({
          stage: 'watcher', outcome: 'frontier-recorded', sessionId: identity,
          sourcePath, generation: frontier.generation, sizeBytes: stat.size,
        });
        spawnSettledScheduler();
      } catch (error) {
        const diagnostic = error instanceof Error ? error.message : String(error);
        const retryable = /database is locked|SQLITE_BUSY/i.test(diagnostic);
        if (retryable && attempt < 6) {
          const retryDelayMs = Math.min(30_000, 1_500 * (2 ** attempt));
          recordIngestionLog({
            stage: 'watcher', outcome: 'frontier-retry-scheduled', sourcePath,
            diagnostic, retryAttempt: attempt + 1, retryDelayMs,
          });
          schedule(sourcePath, retryDelayMs, attempt + 1);
          return;
        }
        recordIngestionLog({
          stage: 'watcher', outcome: 'frontier-failed', sourcePath, diagnostic,
        });
      }
    }, delayMs));
  };
  const watcher = watch(sessionsRoot, { recursive: true }, (_eventType, filename) => {
    if (!filename || !filename.endsWith('.jsonl')) return;
    const sourcePath = isAbsolute(filename) ? filename : join(sessionsRoot, filename);
    schedule(sourcePath);
  });
  watcher.on('close', () => {
    recordIngestionLog({ stage: 'watcher', outcome: 'closed', sourcePath: sessionsRoot });
    for (const timer of pending.values()) clearTimeout(timer);
    pending.clear();
  });
  return watcher;
}
