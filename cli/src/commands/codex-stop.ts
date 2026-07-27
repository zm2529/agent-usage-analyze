import type { Readable } from 'stream';
import { isAbsolute } from 'path';
import { createHash } from 'crypto';
import { readFileSync, renameSync, writeFileSync } from 'fs';
import { join } from 'path';
import { getDb } from '../db/client.js';
import { recordSettledFrontier, type SettledTurnEvent } from '../analysis/settled-frontier.js';
import { spawnSettledScheduler } from '../analysis/settled-scheduler.js';
import { CODEX_HOOK_MARKER } from '../utils/codex-hooks.js';
import { ensureConfigDir, getConfigDir, loadConfig } from '../utils/config.js';
import { recordIngestionLog } from '../analysis/ingestion-log.js';

export const MAX_CODEX_HOOK_INPUT_BYTES = 64 * 1024;
export const ACTIVE_TURN_SETTLE_SECONDS = 90;

export interface CodexStopOptions {
  quiet?: boolean;
  managedHook?: string;
}

export interface CodexStopResult {
  status: 'recorded' | 'ignored' | 'failed';
  reason: string;
}

interface PersistedHookStatus extends CodexStopResult {
  observedAt: string;
  recoveredFailureAt?: string;
  recoveredFailureReason?: string;
}

export interface CodexStopDependencies {
  isRecursive: boolean;
  automaticEnabled: boolean;
  idleSeconds: number;
  now: Date;
  record(event: SettledTurnEvent, now: Date, idleSeconds: number): unknown;
  spawnScheduler(): void;
}

interface CodexStopPayload {
  session_id?: unknown;
  turn_id?: unknown;
  transcript_path?: unknown;
  hook_event_name?: unknown;
  cwd?: unknown;
}

const HOOK_DB_ATTEMPTS = 3;
const HOOK_DB_RETRY_DELAY_MS = 150;

function boundedString(value: unknown, maxLength: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength && !/[\0\r\n]/.test(value);
}

function isDatabaseBusy(error: unknown): boolean {
  const code = (error as { code?: unknown }).code;
  const message = error instanceof Error ? error.message : String(error);
  return code === 'SQLITE_BUSY' || code === 'SQLITE_LOCKED'
    || /database is locked|SQLITE_BUSY|SQLITE_LOCKED/i.test(message);
}

function waitForDatabase(attempt: number): void {
  const signal = new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(signal, 0, 0, HOOK_DB_RETRY_DELAY_MS * attempt);
}

function recordWithBusyRetry(
  record: CodexStopDependencies['record'],
  event: SettledTurnEvent,
  now: Date,
  idleSeconds: number,
): unknown {
  for (let attempt = 1; attempt <= HOOK_DB_ATTEMPTS; attempt += 1) {
    try {
      return record(event, now, idleSeconds);
    } catch (error) {
      if (!isDatabaseBusy(error) || attempt === HOOK_DB_ATTEMPTS) throw error;
      waitForDatabase(attempt);
    }
  }
  throw new Error('unreachable Hook database retry state');
}

export function buildPersistedHookStatus(
  result: CodexStopResult,
  observedAt: string,
  previous: PersistedHookStatus | null,
): PersistedHookStatus {
  if (result.status !== 'recorded') return { ...result, observedAt };
  if (previous?.status === 'failed') return {
    ...result,
    observedAt,
    recoveredFailureAt: previous.observedAt,
    recoveredFailureReason: previous.reason,
  };
  return {
    ...result,
    observedAt,
    ...(previous?.recoveredFailureAt ? {
      recoveredFailureAt: previous.recoveredFailureAt,
      recoveredFailureReason: previous.recoveredFailureReason,
    } : {}),
  };
}

function defaultDependencies(): CodexStopDependencies {
  const configuredIdle = loadConfig()?.dashboard?.analysis?.idleSeconds;
  const idleSeconds = Number.isFinite(configuredIdle)
    ? Math.min(3_600, Math.max(5, Math.round(configuredIdle!)))
    : 10;
  return {
    isRecursive: Boolean(process.env.AGENT_ANALYTICS_HOOK_ACTIVE),
    automaticEnabled: loadConfig()?.dashboard?.capabilities?.hookCapture !== false,
    idleSeconds,
    now: new Date(),
    record: (event, now, idle) => recordSettledFrontier(getDb(), event, now, idle),
    spawnScheduler: spawnSettledScheduler,
  };
}

/** Pure, fail-open boundary used by both the CLI Hook and contract tests. */
export function handleCodexStopInput(
  input: string,
  options: CodexStopOptions,
  dependencies: CodexStopDependencies = defaultDependencies(),
): CodexStopResult {
  try {
    if (!dependencies.automaticEnabled || dependencies.isRecursive
      || options.managedHook !== CODEX_HOOK_MARKER) return { status: 'ignored', reason: 'inactive-boundary' };
    if (Buffer.byteLength(input, 'utf8') > MAX_CODEX_HOOK_INPUT_BYTES) return { status: 'ignored', reason: 'oversized-input' };

    const payload = JSON.parse(input) as CodexStopPayload;
    if (!payload || typeof payload !== 'object'
      || !['UserPromptSubmit', 'Stop'].includes(String(payload.hook_event_name))) {
      return { status: 'ignored', reason: 'unsupported-event' };
    }
    if (!boundedString(payload.session_id, 256) || !boundedString(payload.turn_id, 256)) return { status: 'ignored', reason: 'invalid-identity' };
    if (!boundedString(payload.cwd, 8_192) || !isAbsolute(payload.cwd)) return { status: 'ignored', reason: 'invalid-cwd' };
    if (payload.transcript_path !== undefined && payload.transcript_path !== null
      && !boundedString(payload.transcript_path, 8_192)) return { status: 'ignored', reason: 'invalid-transcript' };

    const eventName = String(payload.hook_event_name);
    const settleSeconds = eventName === 'UserPromptSubmit'
      ? Math.max(ACTIVE_TURN_SETTLE_SECONDS, dependencies.idleSeconds)
      : dependencies.idleSeconds;
    recordWithBusyRetry(dependencies.record, {
      source: 'codex-cli',
      sessionId: payload.session_id,
      turnId: payload.turn_id,
      ...(typeof payload.transcript_path === 'string' ? { locator: payload.transcript_path } : {}),
      basis: `hook-sha256:${createHash('sha256').update(input).digest('hex')}`,
    }, dependencies.now, settleSeconds);
    dependencies.spawnScheduler();
    return { status: 'recorded', reason: 'frontier-recorded' };
  } catch (error) {
    // Hook failures must never block or alter the Codex turn.
    return {
      status: 'failed',
      reason: isDatabaseBusy(error) ? 'database-busy' : 'hook-processing-failed',
    };
  }
}

function writeHookStatus(result: CodexStopResult): void {
  try {
    ensureConfigDir();
    const destination = join(getConfigDir(), 'codex-hook-status.json');
    const temporary = `${destination}.tmp`;
    let previous: PersistedHookStatus | null = null;
    try {
      previous = JSON.parse(readFileSync(destination, 'utf8')) as PersistedHookStatus;
    } catch {
      previous = null;
    }
    const status = buildPersistedHookStatus(result, new Date().toISOString(), previous);
    writeFileSync(temporary, `${JSON.stringify(status, null, 2)}\n`, { mode: 0o600 });
    renameSync(temporary, destination);
    recordIngestionLog({ stage: 'hook', outcome: result.status, diagnostic: result.reason });
  } catch {
    // Status telemetry is best-effort and must preserve the Hook fail-open contract.
  }
}

async function readBoundedStdin(stream: Readable = process.stdin): Promise<string | null> {
  if (stream === process.stdin && process.stdin.isTTY) return null;
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of stream) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    bytes += buffer.length;
    if (bytes > MAX_CODEX_HOOK_INPUT_BYTES) return null;
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString('utf8').trim();
}

export async function codexStopCommand(options: CodexStopOptions = {}): Promise<void> {
  try {
    const input = await readBoundedStdin();
    if (input !== null) writeHookStatus(handleCodexStopInput(input, options));
  } catch {
    // Explicit fail-open contract: exit 0 with no stdout/stderr.
  }
}
