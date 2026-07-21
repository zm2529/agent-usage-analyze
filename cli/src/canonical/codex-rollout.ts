import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import type {
  CanonicalBatch,
  CanonicalEvent,
  IdentityEdge,
  IngestionDiagnostic,
  SourceAdapter,
  SourceArtifact,
  SourceCursor,
} from './ingestion.js';

const PARSER_VERSION = 'codex-rollout-v1';

function hash(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function integer(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

function walkRollouts(directory: string, files: string[], depth = 0): void {
  if (depth > 10 || !existsSync(directory)) return;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) walkRollouts(path, files, depth + 1);
    else if (entry.isFile() && entry.name.startsWith('rollout-') && entry.name.endsWith('.jsonl')) files.push(path);
  }
}

function normalizeRole(value: unknown, parentThreadId?: string): 'root' | 'subagent' | 'reviewer' | 'worker' | 'unknown' {
  if (!parentThreadId) return 'root';
  const role = String(value ?? '').toLowerCase();
  if (role.includes('review')) return 'reviewer';
  if (role.includes('worker') || role.includes('executor')) return 'worker';
  if (role) return 'subagent';
  return 'unknown';
}

function normalizeStatus(value: unknown): 'completed' | 'failed' | 'cancelled' | 'unknown' {
  const status = String(value ?? '').toLowerCase();
  if (status.includes('fail') || status.includes('error')) return 'failed';
  if (status.includes('cancel') || status.includes('abort')) return 'cancelled';
  if (status.includes('complete') || status === 'ok' || status === 'success') return 'completed';
  return 'unknown';
}

function safeName(value: unknown): string | undefined {
  const name = text(value);
  if (!name) return undefined;
  return name.replace(/[^A-Za-z0-9_.:-]/g, '-').slice(0, 128);
}

function defined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, child]) => child !== undefined)) as T;
}

function gitRoot(cwd?: string): string | undefined {
  if (!cwd) return undefined;
  try {
    return execFileSync('git', ['-C', cwd, 'rev-parse', '--show-toplevel'], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 1000,
    }).trim() || cwd;
  } catch {
    return cwd;
  }
}

interface ParseState {
  threadId?: string;
  taskId?: string;
  parentThreadId?: string;
  turnId?: string;
  attempt?: number;
  generation?: number;
  cwd?: string;
  repoRoot?: string;
  branch?: string;
  role: 'root' | 'subagent' | 'reviewer' | 'worker' | 'unknown';
  callEvents: Map<string, string>;
}

function eventTimestamp(value: unknown, fallback: string): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) {
    const milliseconds = value < 10_000_000_000 ? value * 1000 : value;
    return new Date(milliseconds).toISOString();
  }
  return fallback;
}

function recoverLegacyIdentity(raw: Record<string, unknown>, state: ParseState): void {
  if (state.threadId) return;
  const threadId = text(raw.thread_id);
  if (!threadId) return;
  state.threadId = threadId;
  state.taskId = threadId;
  state.cwd = text(raw.working_dir);
  state.repoRoot = gitRoot(state.cwd);
  state.role = 'root';
}

function sourceRef(artifactId: string, offset: number): string {
  return `source:${artifactId}#offset=${offset}`;
}

function baseEvent(
  artifact: SourceArtifact,
  state: ParseState,
  offset: number,
  sequence: number,
  timestamp: string,
  nativeId?: string,
): Pick<CanonicalEvent, 'id' | 'nativeEventId' | 'sequence' | 'occurredAt' | 'taskId' | 'threadId' | 'turnId' | 'attempt' | 'generation' | 'repository'> {
  const stableNativeId = `${nativeId ?? 'event'}@${offset}`;
  return {
    id: `event:${hash(`${artifact.id}:${stableNativeId}:${offset}`)}`,
    nativeEventId: stableNativeId,
    sequence,
    occurredAt: timestamp,
    taskId: state.taskId,
    threadId: state.threadId,
    turnId: state.turnId,
    attempt: state.attempt,
    generation: state.generation,
    repository: { root: state.repoRoot, worktree: state.cwd, branch: state.branch },
  };
}

function mapEnvelope(
  raw: Record<string, unknown>,
  artifact: SourceArtifact,
  state: ParseState,
  offset: number,
  sequence: number,
): { event: CanonicalEvent; edges: IdentityEdge[]; unknown: boolean } {
  const envelope = text(raw.type) ?? 'unknown';
  const body = envelope === 'item.completed' ? asRecord(raw.item)
    : envelope === 'input' ? raw
    : asRecord(raw.payload);
  const inner = envelope === 'input' ? 'user_message' : text(body.type) ?? envelope;
  const timestamp = eventTimestamp(raw.timestamp, artifact.observedAt);
  const edges: IdentityEdge[] = [];

  if (envelope === 'session_meta') {
    state.threadId = text(body.id) ?? text(body.session_id) ?? `thread:${artifact.id}`;
    state.taskId = state.threadId;
    const spawn = asRecord(asRecord(asRecord(body.source).subagent).thread_spawn);
    state.parentThreadId = text(body.parent_thread_id) ?? text(spawn.parent_thread_id);
    state.cwd = text(body.cwd);
    state.repoRoot = gitRoot(state.cwd);
    state.branch = text(asRecord(body.git).branch);
    state.role = normalizeRole(body.agent_role ?? spawn.agent_role, state.parentThreadId);
    edges.push({ kind: 'task-thread', fromId: state.taskId, toId: state.threadId });
    if (state.parentThreadId) edges.push({ kind: 'root-child', fromId: state.parentThreadId, toId: state.taskId });
    return {
      event: {
        ...baseEvent(artifact, state, offset, sequence, timestamp, text(body.id)),
        kind: 'session-meta', actor: 'system', sensitivity: 'metadata',
        payload: defined({
          originator: 'codex',
          source: typeof body.source === 'string' ? 'cli' : state.parentThreadId ? 'subagent' : 'unknown',
          cliVersion: safeName(body.cli_version),
          taskRole: state.role,
        }),
      },
      edges,
      unknown: false,
    };
  }

  if (envelope === 'turn_context') {
    state.turnId = text(body.turn_id) ?? state.turnId;
    state.attempt = integer(body.attempt) ?? state.attempt ?? 0;
    state.generation = integer(body.generation) ?? state.generation ?? 0;
    state.cwd = text(body.cwd) ?? state.cwd;
    state.repoRoot = gitRoot(state.cwd);
    if (state.turnId && state.threadId) edges.push({ kind: 'turn-attempt', fromId: state.turnId, toId: `${state.threadId}:${state.attempt}` });
    return {
      event: {
        ...baseEvent(artifact, state, offset, sequence, timestamp, state.turnId),
        kind: 'turn-context', actor: 'system', sensitivity: 'metadata',
        payload: defined({
          model: safeName(body.model),
          effort: safeName(body.effort),
          sandbox: safeName(asRecord(body.sandbox_policy).type ?? body.sandbox_policy),
          approvalPolicy: safeName(body.approval_policy),
        }),
      }, edges, unknown: false,
    };
  }

  const common = baseEvent(
    artifact, state, offset, sequence, timestamp,
    text(body.id) ?? text(body.call_id) ?? text(body.turn_id),
  );
  const payloadRef = sourceRef(artifact.id, offset);
  const role = text(body.role);
  if (inner === 'message' || inner === 'user_message' || inner === 'agent_message') {
    const actor = role === 'user' || inner === 'user_message' ? 'user'
      : role === 'developer' || role === 'system' ? 'system' : 'assistant';
    const kind = actor === 'user' ? 'user-message' : actor === 'system' ? 'system-message' : 'assistant-message';
    return { event: { ...common, kind, actor, sensitivity: 'sensitive-content', payload: {}, payloadRef } as CanonicalEvent, edges, unknown: false };
  }
  if (['reasoning', 'agent_reasoning'].includes(inner)) {
    return { event: { ...common, kind: 'thinking', actor: 'assistant', sensitivity: 'sensitive-content', payload: {}, payloadRef }, edges, unknown: false };
  }
  if (['function_call', 'custom_tool_call', 'tool_search_call', 'mcp_tool_call_begin'].includes(inner)) {
    const callId = safeName(body.call_id ?? body.id);
    const event: CanonicalEvent = {
      ...common, kind: 'tool-call', actor: 'assistant', sensitivity: 'metadata',
      payload: defined({ toolName: safeName(body.name ?? body.namespace ?? inner), callId }), payloadRef,
    };
    if (callId) state.callEvents.set(callId, event.id);
    return { event, edges, unknown: false };
  }
  if (['function_call_output', 'custom_tool_call_output', 'tool_search_output', 'mcp_tool_call_end'].includes(inner)) {
    const callId = safeName(body.call_id ?? body.id);
    return {
      event: {
        ...common, parentEventId: callId ? state.callEvents.get(callId) : undefined,
        kind: 'tool-result', actor: 'tool', sensitivity: 'sensitive-content', payload: {}, payloadRef,
      }, edges, unknown: false,
    };
  }
  if (inner === 'token_count') {
    const total = asRecord(asRecord(body.info).total_token_usage);
    return {
      event: {
        ...common, kind: 'token-snapshot', actor: 'system', sensitivity: 'structural',
        payload: defined({
          inputTokens: integer(total.input_tokens),
          cachedInputTokens: integer(total.cached_input_tokens),
          outputTokens: integer(total.output_tokens),
          reasoningTokens: integer(total.reasoning_output_tokens),
        }),
      }, edges, unknown: false,
    };
  }
  if (inner === 'task_started') {
    return { event: { ...common, kind: 'task-started', actor: state.role === 'root' ? 'system' : 'subagent', sensitivity: 'structural', payload: { status: 'started' } }, edges, unknown: false };
  }
  if (inner === 'task_complete') {
    return { event: { ...common, kind: 'task-completed', actor: state.role === 'root' ? 'system' : 'subagent', sensitivity: 'structural', payload: { status: 'completed', reason: 'normal' } }, edges, unknown: false };
  }
  if (inner === 'turn_aborted') {
    return { event: { ...common, kind: 'task-status', actor: 'system', sensitivity: 'structural', payload: { status: 'aborted', reason: 'turn-aborted' } }, edges, unknown: false };
  }
  if (envelope === 'compacted' || inner === 'context_compacted') {
    return { event: { ...common, kind: 'compaction', actor: 'system', sensitivity: 'metadata', payload: { trigger: 'unknown' }, payloadRef }, edges, unknown: false };
  }
  if (inner === 'patch_apply_end') {
    return { event: { ...common, kind: 'file-change', actor: 'tool', sensitivity: 'metadata', payload: { changeType: normalizeStatus(body.status) === 'completed' ? 'modified' : 'unknown' }, payloadRef }, edges, unknown: false };
  }
  return {
    event: { ...common, kind: 'unknown', actor: 'unknown', sensitivity: 'metadata', payload: { envelopeType: 'unknown' }, payloadRef },
    edges,
    unknown: true,
  };
}

export class CodexRolloutAdapter implements SourceAdapter {
  readonly name = 'codex-rollout-v1';
  private readonly paths = new Map<string, string>();

  constructor(private readonly codexHome = process.env.AGENT_ANALYTICS_CODEX_HOME ?? process.env.CODEX_HOME ?? join(homedir(), '.codex')) {}

  async discover(): Promise<SourceArtifact[]> {
    const files: string[] = [];
    walkRollouts(join(this.codexHome, 'sessions'), files);
    walkRollouts(join(this.codexHome, 'archived_sessions'), files);
    return files.sort().map((path) => {
      const absolute = resolve(path);
      const id = `codex:${hash(absolute)}`;
      this.paths.set(id, absolute);
      return {
        id,
        sourceKind: 'codex-rollout',
        parserVersion: PARSER_VERSION,
        locatorHash: `sha256:${hash(absolute)}`,
        observedAt: statSync(absolute).mtime.toISOString(),
      };
    });
  }

  async parse(artifact: SourceArtifact, context: { currentCursor: SourceCursor | null }): Promise<CanonicalBatch> {
    const path = this.paths.get(artifact.id);
    if (!path) throw new Error('Discovered Codex source is unavailable');
    const buffer = readFileSync(path);
    let operation: 'append' | 'rebuild' = 'append';
    let start = context.currentCursor?.position ?? 0;
    const diagnostics: IngestionDiagnostic[] = [];
    if (context.currentCursor && (
      start > buffer.length
      || context.currentCursor.token !== `sha256:${hash(buffer.subarray(0, start))}`
    )) {
      operation = 'rebuild';
      start = 0;
      diagnostics.push({ severity: 'warning', code: 'rewritten-source', count: 1 });
    }

    const state: ParseState = { role: 'unknown', callEvents: new Map() };
    // Recover identity and turn lane from the immutable prefix without re-emitting it.
    if (start > 0) {
      let prefixOffset = 0;
      let sequence = 0;
      while (prefixOffset < start) {
        const newline = buffer.indexOf(0x0a, prefixOffset);
        const end = newline >= 0 && newline < start ? newline : start;
        const value = buffer.subarray(prefixOffset, end).toString('utf8').trim();
        if (value) {
          try {
            const raw = asRecord(JSON.parse(value));
            recoverLegacyIdentity(raw, state);
            mapEnvelope(raw, artifact, state, prefixOffset, sequence * 2 + 1);
          } catch { /* valid prefix was previously imported */ }
        }
        prefixOffset = end + (newline >= 0 && newline < start ? 1 : 0);
        sequence += 1;
      }
    }

    const events: CanonicalEvent[] = [];
    const identityEdges: IdentityEdge[] = [];
    let offset = start;
    let nextPosition = start;
    let sequence = buffer.subarray(0, start).toString('utf8').split('\n').length - 1;
    let skipped = 0;
    let failed = 0;
    let unknown = 0;
    while (offset < buffer.length) {
      const newline = buffer.indexOf(0x0a, offset);
      const hasNewline = newline >= 0;
      const end = hasNewline ? newline : buffer.length;
      const value = buffer.subarray(offset, end).toString('utf8').trim();
      const after = end + (hasNewline ? 1 : 0);
      if (!value) {
        skipped += 1;
        nextPosition = after;
        offset = after;
        sequence += 1;
        continue;
      }
      let raw: Record<string, unknown>;
      try {
        raw = asRecord(JSON.parse(value));
      } catch {
        if (!hasNewline) {
          diagnostics.push({ severity: 'warning', code: 'truncated-tail', count: 1 });
          break;
        }
        failed += 1;
        nextPosition = after;
        offset = after;
        sequence += 1;
        continue;
      }
      const hadThread = Boolean(state.threadId);
      recoverLegacyIdentity(raw, state);
      if (!hadThread && state.threadId && text(raw.type) !== 'session_meta') {
        events.push({
          ...baseEvent(artifact, state, offset, sequence * 2, eventTimestamp(raw.timestamp, artifact.observedAt), 'legacy-session-meta'),
          kind: 'session-meta', actor: 'system', sensitivity: 'metadata',
          payload: { originator: 'codex', source: 'cli', taskRole: 'root' },
        });
        identityEdges.push({ kind: 'task-thread', fromId: state.taskId!, toId: state.threadId });
      }
      const mapped = mapEnvelope(raw, artifact, state, offset, sequence * 2 + 1);
      events.push(mapped.event);
      identityEdges.push(...mapped.edges);
      if (mapped.unknown) unknown += 1;
      nextPosition = after;
      offset = after;
      sequence += 1;
    }
    if (unknown > 0) diagnostics.push({ severity: 'warning', code: 'unknown-envelope', count: unknown });

    return {
      artifact,
      era: {
        id: 'era:codex-historical-v1',
        name: 'Codex historical rollout import',
        mode: 'historical-backfill',
        parserVersion: PARSER_VERSION,
        capabilities: ['active-rollout', 'archived-rollout', 'task-tree', 'token-snapshot'],
        startsAt: '1970-01-01T00:00:00.000Z',
      },
      events,
      identityEdges,
      diagnostics,
      coverage: { discovered: 1, parsed: events.length, skipped, failed, unknown },
      previousCursor: context.currentCursor,
      nextCursor: { token: `sha256:${hash(buffer.subarray(0, nextPosition))}`, position: nextPosition },
      operation,
    };
  }
}
