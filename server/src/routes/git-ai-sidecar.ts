import { Hono } from 'hono';
import { getDb } from '@agent-analytics/cli/db/client';
import { readGitAiSidecarState } from '@agent-analytics/cli/canonical/git-ai-gate';

const app = new Hono();

app.get('/', (c) => c.json(readGitAiSidecarState(getDb())));

export default app;
