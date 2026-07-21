import { Hono } from 'hono';
import { getDb } from '@agent-analytics/cli/db/client';
import { listWorkTasks, readWorkTaskDetail } from '@agent-analytics/cli/canonical/tasks';

const app = new Hono();

app.get('/', (c) => c.json({ tasks: listWorkTasks(getDb()) }));

app.get('/:id', (c) => {
  const task = readWorkTaskDetail(getDb(), c.req.param('id'));
  return task ? c.json({ task }) : c.json({ error: 'Not found' }, 404);
});

export default app;
