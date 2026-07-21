import { Hono } from 'hono';
import { getDb } from '@agent-analytics/cli/db/client';
import { readBuildermarkGateState } from '@agent-analytics/cli/canonical/buildermark-gate';

const app = new Hono();

app.get('/', (c) => c.json(readBuildermarkGateState(getDb())));

export default app;
