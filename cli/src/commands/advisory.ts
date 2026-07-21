import type { AdvisoryQueryResult, AdvisorySuggestion } from '../canonical/advisory.js';
import { existsSync } from 'node:fs';
import { Worker } from 'node:worker_threads';
import { getDbPath } from '../db/client.js';

export interface AdvisoryHookOutput {
  status: 'ok';
  suggestions: AdvisorySuggestion[];
  diagnostics: Array<'invalid-input' | 'task-not-found' | 'timeout' | 'unavailable'>;
}

interface AdvisoryHookInput {
  taskId?: string;
  sessionId?: string;
}

interface AdvisoryHookDependencies {
  timeoutMs: number;
  resolveTaskId(input: AdvisoryHookInput): Promise<string | null> | string | null;
  query(taskId: string, signal: AbortSignal): Promise<AdvisoryQueryResult> | AdvisoryQueryResult;
}

const empty = (diagnostic: AdvisoryHookOutput['diagnostics'][number]): AdvisoryHookOutput => ({
  status: 'ok', suggestions: [], diagnostics: [diagnostic],
});

function parseInput(rawInput: string): AdvisoryHookInput | null {
  let parsed: unknown;
  try { parsed = JSON.parse(rawInput); } catch { return null; }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const value = parsed as Record<string, unknown>;
  const taskId = value.task_id ?? value.taskId;
  const sessionId = value.session_id ?? value.sessionId;
  if (taskId !== undefined && (typeof taskId !== 'string' || taskId.length < 1 || taskId.length > 256)) return null;
  if (sessionId !== undefined && (typeof sessionId !== 'string' || sessionId.length < 1 || sessionId.length > 256)) return null;
  return { taskId: taskId as string | undefined, sessionId: sessionId as string | undefined };
}

export async function renderAdvisoryHook(
  rawInput: string,
  dependencies: AdvisoryHookDependencies,
): Promise<AdvisoryHookOutput> {
  const input = parseInput(rawInput);
  if (!input) return empty('invalid-input');
  const timeoutMs = Math.max(1, Math.min(1_000, Math.trunc(dependencies.timeoutMs)));
  const timeout = Symbol('advisory-timeout');
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const work = Promise.resolve(dependencies.resolveTaskId(input)).then(async (taskId) => {
      if (!taskId) return empty('task-not-found');
      const result = await dependencies.query(taskId, controller.signal);
      const diagnostics: AdvisoryHookOutput['diagnostics'] = result.diagnostics.length === 0 ? []
        : result.diagnostics.includes('task-not-found') ? ['task-not-found'] : ['unavailable'];
      return { status: 'ok', suggestions: result.suggestions, diagnostics } satisfies AdvisoryHookOutput;
    });
    const result = await Promise.race([
      work,
      new Promise<typeof timeout>((resolve) => {
        timer = setTimeout(() => { resolve(timeout); controller.abort(); }, timeoutMs);
      }),
    ]);
    return result === timeout ? empty('timeout') : result;
  } catch {
    return empty('unavailable');
  } finally {
    if (timer) clearTimeout(timer);
  }
}

type AdvisoryWorker = Pick<Worker, 'once' | 'terminate'>;

export function queryInReadonlyWorker(
  identifier: string,
  signal: AbortSignal,
  createWorker: (url: URL, options: ConstructorParameters<typeof Worker>[1]) => AdvisoryWorker =
    (url, options) => new Worker(url, options),
): Promise<AdvisoryQueryResult> {
  return new Promise((resolve, reject) => {
    if (!existsSync(getDbPath())) {
      reject(new Error('Advisory database unavailable'));
      return;
    }
    process.env.SQLITE_USE_URI = '1';
    const worker = createWorker(new URL('./advisory-worker.js', import.meta.url), {
      workerData: { dbPath: getDbPath(), identifier, now: new Date().toISOString() },
      env: { ...process.env, SQLITE_USE_URI: '1' },
    });
    let settled = false;
    const cleanup = () => signal.removeEventListener('abort', abort);
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback();
    };
    const abort = () => {
      void worker.terminate();
      finish(() => reject(new Error('Advisory worker aborted')));
    };
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) { abort(); return; }
    worker.once('message', (message: AdvisoryQueryResult) => finish(() => resolve(message)));
    worker.once('error', () => finish(() => reject(new Error('Advisory worker unavailable'))));
    worker.once('exit', (code) => {
      if (code !== 0) finish(() => reject(new Error('Advisory worker stopped')));
    });
  });
}

function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    if (process.stdin.isTTY) { resolve('{}'); return; }
    let data = '';
    process.stdin.setEncoding('utf-8');
    process.stdin.on('data', (chunk: string) => {
      data += chunk;
      if (Buffer.byteLength(data) > 1_048_576) reject(new Error('Advisory input is too large'));
    });
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', reject);
  });
}

export async function advisoryCommand(
  taskId: string | undefined,
  options: { hook?: boolean; timeoutMs?: string } = {},
): Promise<void> {
  let rawInput: string;
  try {
    rawInput = options.hook ? await readStdin() : JSON.stringify({ task_id: taskId });
  } catch {
    console.log(JSON.stringify(empty('unavailable')));
    return;
  }
  const requestedTimeout = Number(options.timeoutMs ?? 75);
  const timeoutMs = Number.isFinite(requestedTimeout) ? requestedTimeout : 75;
  const output = await renderAdvisoryHook(rawInput, {
    timeoutMs,
    resolveTaskId: ({ taskId: explicitTaskId, sessionId }) => explicitTaskId ?? sessionId ?? null,
    query: queryInReadonlyWorker,
  });
  console.log(JSON.stringify(output));
}
