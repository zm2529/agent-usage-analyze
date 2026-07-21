import { Hono } from 'hono';
import { getDb } from '@agent-analytics/cli/db/client';
import { readIngestionHealth } from '@agent-analytics/cli/canonical/ingestion';

const app = new Hono();

app.get('/health', (c) => c.json(readIngestionHealth(getDb())));

export default app;
