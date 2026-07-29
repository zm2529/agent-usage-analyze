import { spawn } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Hono } from 'hono';
import { getDb } from 'agent-usage-analyze/db/client';
import { readIngestionHealth } from 'agent-usage-analyze/canonical/ingestion';
import { importCodexHistory } from 'agent-usage-analyze/commands/import-codex';
import { runSync } from 'agent-usage-analyze/commands/sync';
import { discoverRecordedTaskDeliveries } from 'agent-usage-analyze/canonical/deliveries';
import { repairInjectedSessionTitles } from 'agent-usage-analyze/canonical/session-titles';
import { startAutomaticHistoryAnalysis } from 'agent-usage-analyze/analysis/history-backfill';
import { spawnAutomaticBehaviorReport } from 'agent-usage-analyze/analysis/behavior-report-scheduler';
import { getConfigDir } from 'agent-usage-analyze/utils/config';

const app = new Hono();
let historySyncRunning = false;
const HISTORY_SYNC_WORKER = fileURLToPath(new URL('../history-sync-worker.js', import.meta.url));

export function reconcileHistoryProjection() {
  const db = getDb();
  const staleBefore = db.prepare(`SELECT COUNT(*) AS count FROM sessions session
    WHERE session.source_tool = 'codex-cli' AND session.message_count > 0
      AND NOT EXISTS (SELECT 1 FROM messages message WHERE message.session_id = session.id)`)
    .get() as { count: number };

  let repairedTitles = 0;
  db.transaction(() => {
    db.exec(`UPDATE sessions SET
      message_count = (SELECT COUNT(*) FROM messages WHERE messages.session_id = sessions.id
        AND messages.type IN ('user', 'assistant')),
      user_message_count = (SELECT COUNT(*) FROM messages WHERE messages.session_id = sessions.id
        AND messages.type = 'user'),
      assistant_message_count = (SELECT COUNT(*) FROM messages WHERE messages.session_id = sessions.id
        AND messages.type = 'assistant')
      WHERE source_tool = 'codex-cli'`);
    db.exec(`UPDATE insights SET source = 'invalidated',
      metadata = json_set(CASE WHEN json_valid(metadata) THEN metadata ELSE '{}' END,
        '$.analysis_state', 'unavailable',
        '$.unavailable_reason', 'missing-conversation-evidence')
      WHERE source = 'llm' AND (
        lower(trim(title)) IN ('no coding activity captured', 'no coding session activity was captured')
        OR session_id IN (
          SELECT session.id FROM sessions session
          WHERE NOT EXISTS (SELECT 1 FROM messages message
            WHERE message.session_id = session.id AND message.type = 'user')
            OR NOT EXISTS (SELECT 1 FROM messages message
              WHERE message.session_id = session.id AND message.type = 'assistant')
        )
      )`);
    repairedTitles = repairInjectedSessionTitles(db);
    db.exec(`UPDATE sessions SET generated_title = NULL, title_source = NULL
      WHERE lower(trim(COALESCE(generated_title, ''))) IN
        ('no coding activity captured', 'no coding session activity was captured')`);
  }).immediate();

  const state = db.prepare(`SELECT
      COUNT(*) AS sessions,
      SUM(CASE WHEN EXISTS (SELECT 1 FROM messages message
        WHERE message.session_id = session.id AND message.type = 'user')
        AND EXISTS (SELECT 1 FROM messages message
          WHERE message.session_id = session.id AND message.type = 'assistant') THEN 1 ELSE 0 END) AS usable,
      SUM(CASE WHEN NOT EXISTS (SELECT 1 FROM messages message
        WHERE message.session_id = session.id) THEN 1 ELSE 0 END) AS empty
    FROM sessions session WHERE session.source_tool = 'codex-cli' AND session.deleted_at IS NULL`)
    .get() as { sessions: number; usable: number | null; empty: number | null };
  const invalidated = db.prepare(`SELECT COUNT(*) AS count FROM insights
    WHERE source = 'invalidated' AND json_extract(metadata, '$.unavailable_reason') = 'missing-conversation-evidence'`)
    .get() as { count: number };
  return {
    staleBefore: staleBefore.count,
    sessions: state.sessions,
    usableSessions: state.usable ?? 0,
    emptySessions: state.empty ?? 0,
    invalidatedInsights: invalidated.count,
    repairedTitles,
  };
}

app.get('/health', (c) => c.json(readIngestionHealth(getDb())));

export async function runHistorySync(forceRequested = false) {
  const startedAt = new Date().toISOString();
  const before = reconcileHistoryProjection();
  const force = forceRequested || before.staleBefore > 0;
  // Manual history sync is the product-level refresh action, so it covers all
  // locally supported Agent sources. The optional force flag reparses every
  // source file and repairs projections created by older parser versions.
  const sessions = await runSync({ quiet: true, force });
  const canonical = await importCodexHistory();
  const deliveries = discoverRecordedTaskDeliveries(getDb());
  const after = reconcileHistoryProjection();
  const analysis = startAutomaticHistoryAnalysis();
  spawnAutomaticBehaviorReport();
  return {
    status: 'completed' as const,
    startedAt,
    completedAt: new Date().toISOString(),
    forceRepair: force,
    sessions,
    canonical,
    deliveries,
    projection: after,
    analysis: { enabled: analysis.enabled, queued: analysis.queued },
  };
}

function startHistorySyncWorker(force: boolean): { pid: number | undefined; logPath: string } {
  const configDir = getConfigDir();
  if (!existsSync(configDir)) mkdirSync(configDir, { recursive: true, mode: 0o700 });
  const logPath = join(configDir, 'history-sync.log');
  const logFd = openSync(logPath, 'a', 0o600);
  try {
    const child = spawn(
      process.execPath,
      [HISTORY_SYNC_WORKER, ...(force ? ['--force'] : [])],
      { detached: true, stdio: ['ignore', logFd, logFd] },
    );
    let finished = false;
    const release = () => {
      if (finished) return;
      finished = true;
      historySyncRunning = false;
    };
    child.once('exit', release);
    child.once('error', release);
    child.unref();
    return { pid: child.pid, logPath };
  } finally {
    closeSync(logFd);
  }
}

app.post('/sync-history', async (c) => {
  if (historySyncRunning) return c.json({ error: 'History sync is already running' }, 409);
  let body: { force?: boolean } = {};
  try { body = await c.req.json<{ force?: boolean }>(); } catch { /* body is optional */ }
  historySyncRunning = true;
  const startedAt = new Date().toISOString();
  try {
    const worker = startHistorySyncWorker(body.force === true);
    return c.json({
      status: 'started' as const,
      startedAt,
      pid: worker.pid,
      logPath: worker.logPath,
    }, 202);
  } catch (error) {
    historySyncRunning = false;
    return c.json({
      status: 'failed' as const,
      startedAt,
      completedAt: new Date().toISOString(),
      error: error instanceof Error ? error.message : 'History sync failed to start',
    }, 500);
  }
});

export default app;
