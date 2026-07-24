import { Hono } from 'hono';
import { getDb } from 'agent-usage-analyze/db/client';
import { readGitAiSidecarState } from 'agent-usage-analyze/canonical/git-ai-gate';

const app = new Hono();

app.get('/', (c) => c.json(readGitAiSidecarState(getDb())));

export default app;
