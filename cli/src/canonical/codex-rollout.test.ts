import Database from 'better-sqlite3';
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runMigrations } from '../db/migrate.js';
import { ingestSourceAdapter } from './ingestion.js';
import { CodexRolloutAdapter } from './codex-rollout.js';
import { readWorkTaskDetail } from './tasks.js';

const created: string[] = [];

function tempCodexHome(): string {
  const root = mkdtempSync(join(tmpdir(), 'agent-analytics-codex-'));
  created.push(root);
  mkdirSync(join(root, 'sessions', '2026', '07', '21'), { recursive: true });
  mkdirSync(join(root, 'archived_sessions'), { recursive: true });
  return root;
}

function line(type: string, payload: Record<string, unknown>, timestamp: string): string {
  return JSON.stringify({ type, timestamp, payload });
}

function rootRollout(): string[] {
  return [
    line('session_meta', {
      id: 'thread-root', session_id: 'external-task-root', cwd: '/repo/root',
      git: { branch: 'main' }, cli_version: '1.2.3', originator: 'codex-cli', source: 'cli',
    }, '2026-07-21T08:00:00.000Z'),
    line('turn_context', {
      turn_id: 'turn-1', model: 'gpt-test', effort: 'medium', cwd: '/repo/root',
      approval_policy: 'never', sandbox_policy: { type: 'workspace-write' },
    }, '2026-07-21T08:00:01.000Z'),
    line('response_item', {
      type: 'message', role: 'user', content: [{ type: 'input_text', text: 'PRIVATE_SENTINEL' }],
    }, '2026-07-21T08:00:02.000Z'),
    line('event_msg', {
      type: 'token_count', info: { total_token_usage: {
        input_tokens: 100, cached_input_tokens: 20, output_tokens: 10, reasoning_output_tokens: 5,
      } },
    }, '2026-07-21T08:00:03.000Z'),
    line('event_msg', {
      type: 'token_count', info: { total_token_usage: {
        input_tokens: 150, cached_input_tokens: 30, output_tokens: 25, reasoning_output_tokens: 9,
      } },
    }, '2026-07-21T08:00:04.000Z'),
    line('future_envelope', { type: 'future_private_shape', value: 'PRIVATE_SENTINEL' }, '2026-07-21T08:00:05.000Z'),
  ];
}

function childRollout(): string[] {
  return [
    line('session_meta', {
      id: 'thread-child', session_id: 'thread-root', parent_thread_id: 'thread-root',
      cwd: '/repo/root', git: { branch: 'main' }, agent_role: 'code-reviewer',
      source: { subagent: { thread_spawn: { parent_thread_id: 'thread-root', depth: 1 } } },
    }, '2026-07-21T08:01:00.000Z'),
    line('event_msg', { type: 'task_started', turn_id: 'turn-child' }, '2026-07-21T08:01:01.000Z'),
    line('event_msg', { type: 'task_complete', turn_id: 'turn-child' }, '2026-07-21T08:01:02.000Z'),
  ];
}

afterEach(() => {
  for (const root of created.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('CodexRolloutAdapter', () => {
  it('imports active and archived task trees with private content references and token deltas', async () => {
    const home = tempCodexHome();
    const rootPath = join(home, 'sessions', '2026', '07', '21', 'rollout-root.jsonl');
    writeFileSync(rootPath, `${rootRollout().join('\n')}\n`);
    writeFileSync(join(home, 'archived_sessions', 'rollout-child.jsonl'), `${childRollout().join('\n')}\n`);
    const db = new Database(':memory:');
    runMigrations(db);

    const result = await ingestSourceAdapter(new CodexRolloutAdapter(home), db);
    const task = readWorkTaskDetail(db, 'thread-root');

    expect(result).toMatchObject({ advancedSources: 2, status: 'completed' });
    expect(task?.nodes.map((node) => [node.id, node.parentTaskId, node.role])).toEqual([
      ['thread-root', null, 'root'],
      ['thread-child', 'thread-root', 'reviewer'],
    ]);
    expect(task?.events.map((event) => event.kind)).toEqual(expect.arrayContaining([
      'session-meta', 'turn-context', 'user-message', 'token-snapshot', 'unknown',
      'task-started', 'task-completed',
    ]));
    expect(task?.tokenDeltas).toEqual(expect.arrayContaining([
      expect.objectContaining({ status: 'unknown-baseline', inputTokens: null }),
      expect.objectContaining({ status: 'known', inputTokens: 50, cachedInputTokens: 10, outputTokens: 15, reasoningTokens: 4 }),
    ]));
    expect(JSON.stringify(task)).not.toContain('PRIVATE_SENTINEL');
    expect(task?.events.find((event) => event.kind === 'user-message')?.payloadRef).toMatch(/^source:/);
    expect(task?.coverage.unknown).toBe(1);
    db.close();
  });

  it('imports only appended bytes, preserves a truncated tail, and rebuilds a rewritten source', async () => {
    const home = tempCodexHome();
    const rootPath = join(home, 'sessions', '2026', '07', '21', 'rollout-root.jsonl');
    writeFileSync(rootPath, `${rootRollout().slice(0, 5).join('\n')}\n`);
    const db = new Database(':memory:');
    runMigrations(db);
    const adapter = new CodexRolloutAdapter(home);
    await ingestSourceAdapter(adapter, db);

    appendFileSync(rootPath, `${line('event_msg', {
      type: 'token_count', info: { total_token_usage: {
        input_tokens: 170, cached_input_tokens: 35, output_tokens: 30, reasoning_output_tokens: 10,
      } },
    }, '2026-07-21T08:00:06.000Z')}\n{"type":"event_msg"`);
    const appended = await ingestSourceAdapter(adapter, db);
    expect(appended.insertedEvents).toBe(1);
    expect(readWorkTaskDetail(db, 'thread-root')?.tokenDeltas).toEqual(expect.arrayContaining([
      expect.objectContaining({ status: 'known', inputTokens: 20, outputTokens: 5 }),
    ]));
    expect(db.prepare(`SELECT code FROM ingestion_diagnostics ORDER BY id DESC LIMIT 1`).get())
      .toEqual({ code: 'truncated-tail' });

    writeFileSync(rootPath, `${rootRollout().slice(0, 2).join('\n')}\n`);
    await ingestSourceAdapter(adapter, db);
    const rebuilt = readWorkTaskDetail(db, 'thread-root');
    expect(rebuilt?.events.map((event) => event.kind)).toEqual(['session-meta', 'turn-context']);
    expect(rebuilt?.tokenDeltas).toEqual([]);
    db.close();
  });

  it('segments reset, out-of-order, and missing cumulative token snapshots as unknown', async () => {
    const home = tempCodexHome();
    const rootPath = join(home, 'sessions', '2026', '07', '21', 'rollout-root.jsonl');
    const rows = rootRollout().slice(0, 4);
    rows.push(
      line('event_msg', { type: 'token_count', info: { total_token_usage: {
        input_tokens: 90, cached_input_tokens: 10, output_tokens: 5, reasoning_output_tokens: 2,
      } } }, '2026-07-21T08:00:02.500Z'),
      line('event_msg', { type: 'token_count', info: { total_token_usage: {
        input_tokens: 80, cached_input_tokens: 9, output_tokens: 4, reasoning_output_tokens: 1,
      } } }, '2026-07-21T08:00:05.000Z'),
      line('event_msg', { type: 'token_count', info: { total_token_usage: {
        input_tokens: 120,
      } } }, '2026-07-21T08:00:06.000Z'),
    );
    writeFileSync(rootPath, `${rows.join('\n')}\n`);
    const db = new Database(':memory:');
    runMigrations(db);
    await ingestSourceAdapter(new CodexRolloutAdapter(home), db);

    expect(readWorkTaskDetail(db, 'thread-root')?.tokenDeltas.map((delta) => delta.status)).toEqual([
      'unknown-baseline', 'unknown-out-of-order', 'unknown-reset', 'unknown-missing',
    ]);
    db.close();
  });

  it('normalizes the frozen Code Insights, Buildermark, and Entire structural oracles', async () => {
    const home = tempCodexHome();
    const path = join(home, 'sessions', '2026', '07', '21', 'rollout-oracles.jsonl');
    const buildermarkLegacy = [
      JSON.stringify({ type: 'input', thread_id: 'legacy-thread', working_dir: '/repo/legacy', timestamp: 1000, role: 'user', content: 'PRIVATE_SENTINEL' }),
      JSON.stringify({ type: 'item.completed', thread_id: 'legacy-thread', working_dir: '/repo/legacy', timestamp: 2000, item: { type: 'agent_message', role: 'assistant', content: [{ type: 'text', text: 'PRIVATE_SENTINEL' }] } }),
    ];
    const entireCompaction = line('compacted', {
      replacement_history: [{ type: 'message', role: 'user', content: 'PRIVATE_SENTINEL' }],
    }, '2026-07-21T08:00:03.000Z');
    writeFileSync(path, `${[...buildermarkLegacy, entireCompaction].join('\n')}\n`);
    const db = new Database(':memory:');
    runMigrations(db);
    await ingestSourceAdapter(new CodexRolloutAdapter(home), db);
    const detail = readWorkTaskDetail(db, 'legacy-thread');

    expect(detail?.events.map((event) => event.kind)).toEqual([
      'session-meta', 'user-message', 'assistant-message', 'compaction',
    ]);
    expect(JSON.stringify(detail)).not.toContain('PRIVATE_SENTINEL');
    db.close();
  });
});
