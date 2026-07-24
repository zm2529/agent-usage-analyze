import { Hono } from 'hono';
import { getDb } from 'agent-usage-analyze/db/client';
import { readObserverOverhead, tryRecordObserverOverhead } from 'agent-usage-analyze/canonical/observer-overhead';

const app = new Hono();

app.get('/', (c) => c.json(readObserverOverhead(getDb())));

app.post('/advisory', async (c) => {
  const body = await c.req.json<unknown>();
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return c.json({ error: 'Invalid advisory overhead body' }, 400);
  }
  const value = body as Record<string, unknown>;
  const expected = ['claimId', 'action'];
  if (Object.keys(value).length !== expected.length || expected.some((key) => !(key in value))
      || typeof value.claimId !== 'string' || value.claimId.length < 1 || value.claimId.length > 256
      || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value.claimId)
      || !['shown', 'adopted', 'ignored', 'dismissed'].includes(value.action as string)) {
    return c.json({ error: 'Invalid advisory overhead body' }, 400);
  }
  const db = getDb();
  const claim = db.prepare(`SELECT run.task_id AS taskId
    FROM semantic_claim_details detail
    JOIN semantic_analysis_runs run ON run.id = detail.run_id
    JOIN analysis_claims claim ON claim.id = detail.claim_id
    WHERE detail.claim_id = ? AND detail.claim_type = 'improvement-advice'
      AND run.status = 'accepted' AND claim.source_category = 'llm-semantic'`)
    .get(value.claimId) as { taskId: string } | undefined;
  if (!claim) return c.json({ error: 'Improvement advice claim not found' }, 404);
  const recorded = tryRecordObserverOverhead(db, {
    category: 'advisory', observerRunId: `advice:${value.claimId}`,
    analyzedTaskId: claim.taskId, advisoryAction: value.action as 'shown' | 'adopted' | 'ignored' | 'dismissed',
    evidenceRefs: [value.claimId],
  });
  return c.json({ recorded, degraded: !recorded }, 202);
});

export default app;
