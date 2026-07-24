import { spawn } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type Database from 'better-sqlite3';
import { getDb } from '../db/client.js';
import { enqueue } from '../db/queue.js';
import { getConfigDir, loadConfig } from '../utils/config.js';
import { resolveAnalysisExecutionPolicy } from './execution-policy.js';

const CLI_ENTRY = resolve(fileURLToPath(import.meta.url), '../../index.js');

export interface HistoryBackfillResult {
  enabled: boolean;
  effectiveRunner: string;
  reason: string;
  queued: number;
  logPath: string | null;
}

export function enqueueRecentUnanalyzedSessions(
  db: Database.Database,
  input: { days?: number; limit?: number; sourceTool?: string; now?: Date } = {},
): number {
  const days = Math.min(365, Math.max(1, Math.round(input.days ?? 30)));
  const limit = Math.min(100, Math.max(1, Math.round(input.limit ?? 10)));
  const sourceTool = input.sourceTool ?? 'codex-cli';
  const now = input.now ?? new Date();
  const cutoff = new Date(now.getTime() - days * 86_400_000).toISOString();
  const settledBefore = new Date(now.getTime() - 15 * 60_000).toISOString();
  const rows = db.prepare(`
    SELECT s.id, s.source_tool AS sourceTool
    FROM sessions s
    LEFT JOIN analysis_usage usage
      ON usage.session_id = s.id AND usage.analysis_type = 'session'
    WHERE s.source_tool = ? AND s.started_at >= ? AND s.ended_at <= ? AND s.deleted_at IS NULL
      AND s.message_count > 2 AND usage.session_id IS NULL
    ORDER BY s.started_at DESC
    LIMIT ?
  `).all(sourceTool, cutoff, settledBefore, limit) as Array<{ id: string; sourceTool: string }>;
  db.transaction(() => {
    for (const row of rows) enqueue(row.id, 'automatic-history', row.sourceTool, db);
  }).immediate();
  return rows.length;
}

function spawnWorker(logPath: string): void {
  const logFd = openSync(logPath, 'a', 0o600);
  try {
    const child = spawn(process.execPath, [CLI_ENTRY, 'queue', 'process', '-q'], {
      detached: true,
      stdio: ['ignore', logFd, logFd],
      env: { ...process.env, AGENT_ANALYTICS_HOOK_ACTIVE: '1' },
    });
    child.on('error', () => { /* Queue rows remain retryable. */ });
    child.unref();
  } finally {
    closeSync(logFd);
  }
}

/** Queue a bounded initial Codex backfill and process it without delaying the dashboard. */
export function startAutomaticHistoryAnalysis(): HistoryBackfillResult {
  const state = resolveAnalysisExecutionPolicy(loadConfig());
  const enabled = ['provider', 'codex-native', 'claude-native'].includes(state.effectiveRunner);
  if (!enabled) {
    return {
      enabled: false, effectiveRunner: state.effectiveRunner,
      reason: state.reason, queued: 0, logPath: null,
    };
  }
  const queued = enqueueRecentUnanalyzedSessions(getDb());
  if (queued === 0) {
    return {
      enabled: true, effectiveRunner: state.effectiveRunner,
      reason: state.reason, queued, logPath: null,
    };
  }
  const configDir = getConfigDir();
  if (!existsSync(configDir)) mkdirSync(configDir, { recursive: true, mode: 0o700 });
  const logPath = join(configDir, 'llm-analysis.log');
  spawnWorker(logPath);
  return { enabled: true, effectiveRunner: state.effectiveRunner, reason: state.reason, queued, logPath };
}
