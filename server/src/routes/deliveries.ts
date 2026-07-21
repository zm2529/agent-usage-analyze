import { Hono } from 'hono';
import { getDb } from '@agent-analytics/cli/db/client';
import {
  appendCandidateCorrection,
  discoverRecordedTaskDeliveries,
  listDeliveries,
  readDeliveryDetail,
  recordTaskLocalArtifactDelivery,
} from '@agent-analytics/cli/canonical/deliveries';

const app = new Hono();

app.get('/', (c) => c.json({ deliveries: listDeliveries(getDb()) }));

app.post('/discover', (c) => c.json(discoverRecordedTaskDeliveries(getDb())));

app.post('/artifacts', async (c) => {
  const body = await c.req.json<unknown>();
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return c.json({ error: 'Artifact body must be an object' }, 400);
  }
  const { taskId, relativePath } = body as Record<string, unknown>;
  if (typeof taskId !== 'string' || !taskId || typeof relativePath !== 'string' || !relativePath) {
    return c.json({ error: 'taskId and relativePath are required' }, 400);
  }
  try {
    return c.json(recordTaskLocalArtifactDelivery(getDb(), { taskId, relativePath }), 201);
  } catch (error) {
    if (error instanceof Error && error.message === 'Artifact task does not exist') {
      return c.json({ error: 'Task not found' }, 404);
    }
    if (error instanceof Error && [
      'Artifact task has no repository', 'Artifact must be inside the repository',
    ].includes(error.message)) {
      return c.json({ error: error.message }, 400);
    }
    throw error;
  }
});

app.post('/:deliveryId/candidates/:candidateId/corrections', async (c) => {
  const body = await c.req.json<unknown>();
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return c.json({ error: 'Correction body must be an object' }, 400);
  }
  const decision = (body as Record<string, unknown>).decision;
  if (!['confirmed', 'rejected', 'pending'].includes(String(decision))) {
    return c.json({ error: 'decision must be confirmed, rejected, or pending' }, 400);
  }
  const detail = readDeliveryDetail(getDb(), c.req.param('deliveryId'));
  if (!detail) return c.json({ error: 'Not found' }, 404);
  const candidate = detail.candidates.find((item) => item.id === c.req.param('candidateId'));
  if (!candidate) return c.json({ error: 'Not found' }, 404);
  appendCandidateCorrection(getDb(), {
    candidateId: candidate.id,
    decision: decision as 'confirmed' | 'rejected' | 'pending',
  });
  const updated = readDeliveryDetail(getDb(), detail.id)!.candidates.find((item) => item.id === candidate.id)!;
  return c.json({ candidate: updated }, 201);
});

app.get('/:id', (c) => {
  const delivery = readDeliveryDetail(getDb(), c.req.param('id'));
  return delivery ? c.json({ delivery }) : c.json({ error: 'Not found' }, 404);
});

export default app;
