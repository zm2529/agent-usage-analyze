import { Hono } from 'hono';
import { getDb } from '@agent-analytics/cli/db/client';
import { listWorkTasks, readWorkTaskDetail } from '@agent-analytics/cli/canonical/tasks';
import { readTaskDeliveries } from '@agent-analytics/cli/canonical/deliveries';

const app = new Hono();

app.get('/', (c) => c.json({ tasks: listWorkTasks(getDb()) }));

app.get('/:id', (c) => {
  const db = getDb();
  const task = readWorkTaskDetail(db, c.req.param('id'));
  return task ? c.json({ task: { ...task, deliveries: readTaskDeliveries(db, task.id) } }) : c.json({ error: 'Not found' }, 404);
});

export default app;
