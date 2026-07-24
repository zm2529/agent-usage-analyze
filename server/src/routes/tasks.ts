import { Hono } from 'hono';
import { getDb } from 'agent-usage-analyze/db/client';
import { countWorkTasks, listWorkTasks, readWorkTaskDetail } from 'agent-usage-analyze/canonical/tasks';
import { readTaskDeliveries } from 'agent-usage-analyze/canonical/deliveries';
import { parseIntParam } from '../utils.js';

const app = new Hono();

function analysisState(db: ReturnType<typeof getDb>, threadId: string) {
  const sessionId = `codex:${threadId}`;
  const row = db.prepare(`
    SELECT analyzed_at AS analyzedAt
    FROM analysis_usage
    WHERE session_id = ? AND analysis_type = 'session'
    LIMIT 1
  `).get(sessionId) as { analyzedAt: string } | undefined;
  return {
    sessionId,
    analysisStatus: row ? 'analyzed' as const : 'not-analyzed' as const,
    analyzedAt: row?.analyzedAt ?? null,
  };
}

app.get('/', (c) => {
  const db = getDb();
  const limit = Math.min(parseIntParam(c.req.query('limit'), 50), 200);
  const offset = parseIntParam(c.req.query('offset'), 0);
  const tasks = listWorkTasks(db, { limit, offset }).map((task) => ({
    ...task,
    ...analysisState(db, task.threadId),
  }));
  return c.json({ tasks, total: countWorkTasks(db) });
});

app.get('/:id', (c) => {
  const db = getDb();
  const task = readWorkTaskDetail(db, c.req.param('id'));
  if (!task) return c.json({ error: 'Not found' }, 404);
  const rootThreadId = task.nodes.find((node) => node.id === task.id)?.threadId;
  const expectedSessionId = rootThreadId ? `codex:${rootThreadId}` : null;
  const session = expectedSessionId
    ? db.prepare(`SELECT id FROM sessions session WHERE id = ? AND deleted_at IS NULL
        AND EXISTS (SELECT 1 FROM messages message
          WHERE message.session_id = session.id AND message.type = 'user')
        AND EXISTS (SELECT 1 FROM messages message
          WHERE message.session_id = session.id AND message.type = 'assistant')`)
      .get(expectedSessionId) as { id: string } | undefined
    : undefined;
  const deliveries = readTaskDeliveries(db, task.id)
    .filter((candidate) => ['candidate', 'confirmed', 'pending'].includes(candidate.status));
  return c.json({ task: {
    ...task,
    sessionId: session?.id ?? null,
    analysisStatus: rootThreadId ? analysisState(db, rootThreadId).analysisStatus : 'not-analyzed',
    analyzedAt: rootThreadId ? analysisState(db, rootThreadId).analyzedAt : null,
    deliveries,
  } });
});

export default app;
