import { Hono } from 'hono';
import { listAnalysisRuns } from 'agent-usage-analyze/analysis/analysis-run-db';
import { parseIntParam } from '../utils.js';

const app = new Hono();

app.get('/', (c) => {
  const sessionId = c.req.query('sessionId');
  const analysisType = c.req.query('analysisType');
  const limit = parseIntParam(c.req.query('limit'), 20);
  return c.json({
    runs: listAnalysisRuns({
      ...(sessionId ? { sessionId } : {}),
      ...(analysisType ? { analysisType } : {}),
      limit: Math.min(limit, 100),
    }),
  });
});

export default app;
