/**
 * GET /api/analysis/queue
 *
 * Returns current analysis_queue status for dashboard polling.
 * Dashboard polls while any actionable lifecycle state remains active.
 */

import { Hono } from 'hono';
import { getQueueStatus } from '@agent-analytics/cli/db/queue';

const app = new Hono();

// GET /api/analysis/queue
// Returns counts by status and details for active/pending/failed items.
// Returns 200 with empty items[] when queue is empty.
app.get('/', (c) => {
  const status = getQueueStatus();
  return c.json(status);
});

export default app;
