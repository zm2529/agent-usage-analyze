import { Hono } from 'hono';
import { getDb } from 'agent-usage-analyze/db/client';
import { comparePatternWindows, summarizeTaskPatterns } from 'agent-usage-analyze/canonical/patterns';

const app = new Hono();

app.get('/overview', (c) => c.json(summarizeTaskPatterns(getDb())));

app.get('/trends', (c) => {
  const currentStart = c.req.query('currentStart');
  const currentEnd = c.req.query('currentEnd');
  if (!currentStart || !currentEnd) {
    return c.json({ error: 'currentStart and currentEnd are required' }, 400);
  }
  if (!Number.isFinite(Date.parse(currentStart)) || !Number.isFinite(Date.parse(currentEnd))
      || Date.parse(currentEnd) <= Date.parse(currentStart)) {
    return c.json({ error: 'Trend window must have valid increasing ISO boundaries' }, 400);
  }
  return c.json({ comparison: comparePatternWindows(getDb(), { currentStart, currentEnd }) });
});

export default app;
