/**
 * GET /api/analysis/queue
 *
 * Returns current analysis_queue status for dashboard polling.
 * Dashboard polls while any actionable lifecycle state remains active.
 */

import { Hono } from 'hono';
import { getDb } from 'agent-usage-analyze/db/client';
import { getQueueStatus } from 'agent-usage-analyze/db/queue';
import { spawnSettledAnalysisWorker } from 'agent-usage-analyze/analysis/settled-scheduler';

const app = new Hono();

// GET /api/analysis/queue
// Returns counts by status and details for active/pending/failed items.
// Returns 200 with empty items[] when queue is empty.
app.get('/', (c) => {
  const status = getQueueStatus();
  return c.json(status);
});

app.post('/retry', (c) => {
  const retrying = (getDb().prepare(`SELECT COUNT(*) AS count
    FROM analysis_queue q
    WHERE q.status = 'awaiting-capability'
      AND q.runner_type = 'auto'
      AND q.source_tool = 'codex-cli'
      AND EXISTS (
        SELECT 1 FROM messages m
        WHERE m.session_id = 'codex:' || q.session_id
      )
      AND (
        (SELECT MAX(completed_at) FROM analysis_queue
          WHERE status = 'completed' AND completed_at IS NOT NULL) IS NULL
        OR datetime(enqueued_at) > datetime((
          SELECT MAX(completed_at) FROM analysis_queue
          WHERE status = 'completed' AND completed_at IS NOT NULL
        ))
      )`).get() as { count: number }).count;
  if (retrying > 0) spawnSettledAnalysisWorker();
  return c.json({
    accepted: retrying > 0,
    retrying,
  }, 202);
});

export default app;
