import type { Readable } from 'stream';
import { isAbsolute } from 'path';
import { createHash } from 'crypto';
import { getDb } from '../db/client.js';
import { recordSettledFrontier, type SettledTurnEvent } from '../analysis/settled-frontier.js';
import { spawnSettledScheduler } from '../analysis/settled-scheduler.js';
import { CODEX_HOOK_MARKER } from '../utils/codex-hooks.js';
import { loadConfig } from '../utils/config.js';

export const MAX_CODEX_HOOK_INPUT_BYTES = 64 * 1024;

export interface CodexStopOptions {
  quiet?: boolean;
  managedHook?: string;
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

function boundedString(value: unknown, maxLength: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength && !/[\0\r\n]/.test(value);
}

function defaultDependencies(): CodexStopDependencies {
  const configuredIdle = loadConfig()?.dashboard?.analysis?.idleSeconds;
  const idleSeconds = Number.isFinite(configuredIdle)
    ? Math.min(3_600, Math.max(5, Math.round(configuredIdle!)))
    : 90;
  return {
    isRecursive: Boolean(process.env.AGENT_ANALYTICS_HOOK_ACTIVE),
    automaticEnabled: loadConfig()?.dashboard?.analysis?.mode !== 'off',
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
): void {
  try {
    if (!dependencies.automaticEnabled || dependencies.isRecursive
      || options.managedHook !== CODEX_HOOK_MARKER) return;
    if (Buffer.byteLength(input, 'utf8') > MAX_CODEX_HOOK_INPUT_BYTES) return;

    const payload = JSON.parse(input) as CodexStopPayload;
    if (!payload || typeof payload !== 'object' || payload.hook_event_name !== 'Stop') return;
    if (!boundedString(payload.session_id, 256) || !boundedString(payload.turn_id, 256)) return;
    if (!boundedString(payload.cwd, 8_192) || !isAbsolute(payload.cwd)) return;
    if (payload.transcript_path !== undefined && payload.transcript_path !== null
      && !boundedString(payload.transcript_path, 8_192)) return;

    dependencies.record({
      source: 'codex-cli',
      sessionId: payload.session_id,
      turnId: payload.turn_id,
      ...(typeof payload.transcript_path === 'string' ? { locator: payload.transcript_path } : {}),
      basis: `hook-sha256:${createHash('sha256').update(input).digest('hex')}`,
    }, dependencies.now, dependencies.idleSeconds);
    dependencies.spawnScheduler();
  } catch {
    // Hook failures must never block or alter the Codex turn.
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
    if (input !== null) handleCodexStopInput(input, options);
  } catch {
    // Explicit fail-open contract: exit 0 with no stdout/stderr.
  }
}
