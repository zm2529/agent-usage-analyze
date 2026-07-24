import { Hono } from 'hono';
import { getDb } from 'agent-usage-analyze/db/client';
import { readBuildermarkGateState } from 'agent-usage-analyze/canonical/buildermark-gate';

const app = new Hono();

app.get('/', (c) => c.json(readBuildermarkGateState(getDb())));

export default app;
