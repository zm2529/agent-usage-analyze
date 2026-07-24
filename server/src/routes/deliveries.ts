import { Hono } from 'hono';
import type Database from 'better-sqlite3';
import { getDb } from 'agent-usage-analyze/db/client';
import {
  appendCandidateCorrection,
  discoverRecordedTaskDeliveries,
  listDeliveries,
  readDeliveryDetail,
  recordTaskLocalArtifactDelivery,
} from 'agent-usage-analyze/canonical/deliveries';

const app = new Hono();

function readTaskRefs(
  db: Database.Database,
  deliveryIds: Set<string>,
): Map<string, Array<{ id: string; title: string | null }>> {
  const taskRows = db.prepare(`SELECT candidate.delivery_id AS deliveryId,
      candidate.task_id AS taskId,
      COALESCE(NULLIF(session.custom_title, ''), NULLIF(session.generated_title, ''),
        NULLIF(session.summary, '')) AS title
    FROM task_delivery_candidates candidate
    JOIN work_tasks task ON task.id = candidate.task_id
    LEFT JOIN sessions session ON session.id = 'codex:' || task.thread_id
    WHERE candidate.machine_status = 'candidate'
      OR COALESCE((SELECT correction.decision FROM task_delivery_corrections correction
        WHERE correction.candidate_id = candidate.id
        ORDER BY correction.sequence DESC LIMIT 1), '') IN ('confirmed', 'pending')
    ORDER BY candidate.delivery_id, candidate.task_id`).all() as Array<{
      deliveryId: string; taskId: string; title: string | null;
    }>;
  const refs = new Map<string, Array<{ id: string; title: string | null }>>();
  for (const row of taskRows) {
    if (!deliveryIds.has(row.deliveryId)) continue;
    const entries = refs.get(row.deliveryId) ?? [];
    if (!entries.some((entry) => entry.id === row.taskId)) {
      entries.push({ id: row.taskId, title: row.title });
      refs.set(row.deliveryId, entries);
    }
  }
  return refs;
}

app.get('/', (c) => {
  const db = getDb();
  const deliveries = listDeliveries(db, { linkedOnly: true });
  const visibleIds = new Set(deliveries.map((delivery) => delivery.id));
  const refs = readTaskRefs(db, visibleIds);
  return c.json({ deliveries: deliveries.map((delivery) => ({
    ...delivery, taskRefs: refs.get(delivery.id) ?? [],
  })) });
});

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
  const db = getDb();
  const delivery = readDeliveryDetail(db, c.req.param('id'));
  if (!delivery) return c.json({ error: 'Not found' }, 404);
  const candidates = delivery.candidates.filter((candidate) => ['candidate', 'confirmed', 'pending'].includes(candidate.status));
  const taskRefs = readTaskRefs(db, new Set([delivery.id])).get(delivery.id) ?? [];
  return candidates.length > 0
    ? c.json({ delivery: { ...delivery, candidates, taskRefs } })
    : c.json({ error: 'No task-linked delivery evidence' }, 404);
});

export default app;
