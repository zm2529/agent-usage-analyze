import { Hono } from 'hono';
import { getDb } from 'agent-usage-analyze/db/client';
import { listScorecardResults, listScorecardVersions } from 'agent-usage-analyze/canonical/scorecards';
import type Database from 'better-sqlite3';

function resolveEvidenceLinks(
  db: Database.Database,
  result: ReturnType<typeof listScorecardResults>[number],
  rootTaskId: string,
): Array<{ ref: string; eventId: string; rootTaskId: string }> {
  const candidates: Array<{ ref: string; eventId: string }> = [];
  for (const ref of result.evidenceRefs) {
    candidates.push({ ref, eventId: ref });
    const row = db.prepare('SELECT fact_refs_json AS factsJson FROM evidence_records WHERE id = ?')
      .get(ref) as { factsJson: string } | undefined;
    if (!row) continue;
    try {
      const facts = JSON.parse(row.factsJson) as Array<{ eventId?: unknown }>;
      for (const fact of facts) {
        if (typeof fact.eventId === 'string') candidates.push({ ref, eventId: fact.eventId });
      }
    } catch { /* malformed historical evidence is not linkable */ }
  }
  const links = candidates.filter((candidate) => db.prepare(`SELECT 1 FROM canonical_events event
    JOIN work_tasks task ON task.id = event.task_id
    WHERE event.id = ? AND task.root_task_id = ?`).get(candidate.eventId, rootTaskId))
    .map((candidate) => ({ ...candidate, rootTaskId }));
  return [...new Map(links.map((link) => [`${link.ref}:${link.eventId}:${link.rootTaskId}`, link])).values()];
}

const app = new Hono();

app.get('/', (c) => {
  const taskId = c.req.query('taskId');
  if (taskId !== undefined && (taskId.length === 0 || taskId.length > 256)) {
    return c.json({ error: 'taskId is invalid' }, 400);
  }
  const db = getDb();
  const results = listScorecardResults(db, taskId).map((result) => {
    const task = db.prepare('SELECT root_task_id AS rootTaskId FROM work_tasks WHERE id = ?')
      .get(result.taskId) as { rootTaskId: string } | undefined;
    const rootTaskId = task?.rootTaskId ?? result.taskId;
    return { ...result, rootTaskId, evidenceLinks: resolveEvidenceLinks(db, result, rootTaskId) };
  });
  return c.json({ versions: listScorecardVersions(db), results });
});

export default app;
