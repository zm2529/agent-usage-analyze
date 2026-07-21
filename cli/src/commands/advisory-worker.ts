import { parentPort, workerData } from 'node:worker_threads';
import { queryAdvisories, type AdvisoryQueryResult } from '../canonical/advisory.js';
import { openReadonlyAdvisoryDatabase } from './advisory-worker-db.js';

const input = workerData as { dbPath: string; identifier: string; now: string };
let db: ReturnType<typeof openReadonlyAdvisoryDatabase> | null = null;
try {
  db = openReadonlyAdvisoryDatabase(input.dbPath);
  const task = db.prepare(`SELECT root_task_id AS rootTaskId FROM work_tasks
    WHERE id = ? OR thread_id = ?
    ORDER BY CASE WHEN id = ? THEN 0 ELSE 1 END, started_at DESC LIMIT 1`)
    .get(input.identifier, input.identifier, input.identifier) as { rootTaskId: string } | undefined;
  const result: AdvisoryQueryResult = task
    ? queryAdvisories(db, { taskId: task.rootTaskId, now: input.now, limit: 1 })
    : { status: 'ok', taskId: input.identifier, suggestions: [], diagnostics: ['task-not-found'] };
  parentPort?.postMessage(result);
} finally {
  db?.close();
}
