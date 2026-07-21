import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import {
  appendFileSync, closeSync, mkdirSync, mkdtempSync, openSync, readFileSync, renameSync, rmSync,
  writeFileSync, writeSync,
} from 'node:fs';
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
      turn_id: 'turn-1', generation: 1, attempt: 1, model: 'gpt-test', effort: 'medium', cwd: '/repo/root',
      approval_policy: 'never', sandbox_policy: { type: 'workspace-write' },
    }, '2026-07-21T08:00:01.000Z'),
    line('response_item', {
      type: 'message', role: 'user', content: [{ type: 'input_text', text: 'PRIVATE_SENTINEL' }],
    }, '2026-07-21T08:00:02.000Z'),
    line('event_msg', {
      type: 'token_count', info: { total_token_usage: {
        input_tokens: 100, cached_input_tokens: 20, cache_creation_tokens: 0,
        output_tokens: 10, reasoning_output_tokens: 5, compaction_tokens: 0,
      } },
    }, '2026-07-21T08:00:03.000Z'),
    line('event_msg', {
      type: 'token_count', info: { total_token_usage: {
        input_tokens: 150, cached_input_tokens: 30, cache_creation_tokens: 2,
        output_tokens: 25, reasoning_output_tokens: 9, compaction_tokens: 1,
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
  it('resolves an opaque payload reference only from the matching local rollout', async () => {
    const home = tempCodexHome();
    const rootPath = join(home, 'sessions', '2026', '07', '21', 'rollout-root.jsonl');
    writeFileSync(rootPath, `${rootRollout().join('\n')}\n`);
    const db = new Database(':memory:');
    runMigrations(db);
    const adapter = new CodexRolloutAdapter(home);
    await ingestSourceAdapter(adapter, db);
    const payloadRef = readWorkTaskDetail(db, 'thread-root')?.events
      .find((event) => event.kind === 'user-message')?.payloadRef;

    expect(payloadRef).toMatch(/^source:codex:/);
    expect(await adapter.resolvePayloadText(payloadRef!)).toBe('PRIVATE_SENTINEL');
    expect(await adapter.resolvePayloadText('source:codex:invalid#offset=0')).toBeNull();
    const rewritten = rootRollout();
    rewritten[2] = line('response_item', {
      type: 'message', role: 'user', content: [{ type: 'input_text', text: 'REWRITTEN_PRIVATE' }],
    }, '2026-07-21T08:00:02.000Z');
    writeFileSync(rootPath, `${rewritten.join('\n')}\n`);
    expect(await adapter.resolvePayloadText(payloadRef!)).toBeNull();
    rmSync(rootPath);
    expect(await adapter.resolvePayloadText(payloadRef!)).toBeNull();
    db.close();
  });

  it('resolves one bounded line by offset without loading a large sparse rollout', async () => {
    const home = tempCodexHome();
    const path = join(home, 'sessions', '2026', '07', '21', 'rollout-sparse.jsonl');
    writeFileSync(path, `${rootRollout()[0]}\n`);
    const offset = 64 * 1024 * 1024;
    const message = `${rootRollout()[2]}\n`;
    const descriptor = openSync(path, 'r+');
    try {
      writeSync(descriptor, message, offset, 'utf8');
    } finally {
      closeSync(descriptor);
    }
    const adapter = new CodexRolloutAdapter(home);
    const [artifact] = await adapter.discover();

    const digest = createHash('sha256').update(message.trim()).digest('hex');
    expect(await adapter.resolvePayloadText(`source:${artifact!.id}#offset=${offset}&sha256=${digest}`))
      .toBe('PRIVATE_SENTINEL');
  });

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
      expect.objectContaining({
        status: 'known', inputTokens: 50, cachedInputTokens: 10, cacheCreationTokens: 2,
        outputTokens: 15, reasoningTokens: 4, compactionTokens: 1,
      }),
    ]));
    expect(JSON.stringify(task)).not.toContain('PRIVATE_SENTINEL');
    expect(task?.events.find((event) => event.kind === 'user-message')?.payloadRef).toMatch(/^source:/);
    expect(task?.coverage.unknown).toBe(1);
    expect(task?.events.find((event) => event.kind === 'unknown')?.sensitivity).toBe('sensitive-content');
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
        input_tokens: 170, cached_input_tokens: 35, cache_creation_tokens: 3,
        output_tokens: 30, reasoning_output_tokens: 10, compaction_tokens: 1,
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
        input_tokens: 90, cached_input_tokens: 10, cache_creation_tokens: 0,
        output_tokens: 5, reasoning_output_tokens: 2, compaction_tokens: 0,
      } } }, '2026-07-21T08:00:02.500Z'),
      line('event_msg', { type: 'token_count', info: { total_token_usage: {
        input_tokens: 80, cached_input_tokens: 9, cache_creation_tokens: 0,
        output_tokens: 4, reasoning_output_tokens: 1, compaction_tokens: 0,
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

  it('does not merge token snapshots when generation or attempt identity is absent', async () => {
    const home = tempCodexHome();
    const path = join(home, 'sessions', '2026', '07', '21', 'rollout-missing-lane.jsonl');
    const rows = rootRollout();
    const context = JSON.parse(rows[1]!) as { payload: Record<string, unknown> };
    delete context.payload.generation;
    delete context.payload.attempt;
    rows[1] = JSON.stringify(context);
    writeFileSync(path, `${rows.slice(0, 5).join('\n')}\n`);
    const db = new Database(':memory:');
    runMigrations(db);
    await ingestSourceAdapter(new CodexRolloutAdapter(home), db);
    expect(readWorkTaskDetail(db, 'thread-root')?.tokenDeltas.map((delta) => delta.status)).toEqual([
      'unknown-missing', 'unknown-missing',
    ]);
    db.close();
  });

  it('keeps one source identity when a rollout moves from active to archive', async () => {
    const home = tempCodexHome();
    const active = join(home, 'sessions', '2026', '07', '21', 'rollout-moved.jsonl');
    const archived = join(home, 'archived_sessions', 'rollout-renamed-after-archive.jsonl');
    writeFileSync(active, `${rootRollout().slice(0, 5).join('\n')}\n`);
    const db = new Database(':memory:');
    runMigrations(db);
    const adapter = new CodexRolloutAdapter(home);
    await ingestSourceAdapter(adapter, db);
    renameSync(active, archived);
    const moved = await ingestSourceAdapter(adapter, db);
    expect(moved.insertedEvents).toBe(0);
    expect(db.prepare('SELECT COUNT(*) AS count FROM source_artifacts').get()).toEqual({ count: 1 });
    expect(db.prepare('SELECT COUNT(*) AS count FROM canonical_events').get()).toEqual({ count: 5 });
    db.close();
  });

  it('defers an incomplete source until its native session identity is readable', async () => {
    const home = tempCodexHome();
    const path = join(home, 'sessions', '2026', '07', '21', 'rollout-growing.jsonl');
    writeFileSync(path, '{"type":"session_meta"');
    const db = new Database(':memory:');
    runMigrations(db);
    const adapter = new CodexRolloutAdapter(home);
    expect((await adapter.discover())).toEqual([]);
    writeFileSync(path, `${rootRollout().slice(0, 2).join('\n')}\n`);
    await ingestSourceAdapter(adapter, db);
    expect(db.prepare('SELECT COUNT(*) AS count FROM source_artifacts').get()).toEqual({ count: 1 });
    expect(db.prepare('SELECT COUNT(*) AS count FROM canonical_events').get()).toEqual({ count: 2 });
    db.close();
  });

  it('keeps safe tool-call metadata without retaining a reference to raw arguments', async () => {
    const home = tempCodexHome();
    const path = join(home, 'sessions', '2026', '07', '21', 'rollout-tool-call.jsonl');
    writeFileSync(path, `${rootRollout()[0]}\n${line('response_item', {
      type: 'function_call', name: 'shell', call_id: 'call-1',
      arguments: '{"cmd":"pnpm test","secret":"PRIVATE_SENTINEL"}',
    }, '2026-07-21T08:00:01.000Z')}\n${line('response_item', {
      type: 'function_call_output', call_id: 'call-1', output: 'PRIVATE_SENTINEL',
    }, '2026-07-21T08:00:02.000Z')}\n`);
    const db = new Database(':memory:');
    runMigrations(db);
    await ingestSourceAdapter(new CodexRolloutAdapter(home), db);
    const toolCall = readWorkTaskDetail(db, 'thread-root')?.events.find((event) => event.kind === 'tool-call');
    const toolResult = readWorkTaskDetail(db, 'thread-root')?.events.find((event) => event.kind === 'tool-result');
    expect(toolCall).toMatchObject({ sensitivity: 'metadata', payloadRef: null });
    expect(toolResult).toMatchObject({ sensitivity: 'sensitive-content', payloadRef: expect.stringMatching(/^source:/) });
    expect(db.prepare(`SELECT payload_json AS payloadJson FROM canonical_events WHERE kind = 'tool-call'`).get())
      .toEqual({ payloadJson: '{"toolName":"shell","callId":"call-1","validationKind":"test"}' });
    expect(JSON.stringify({ toolCall, toolResult })).not.toContain('PRIVATE_SENTINEL');
    db.close();
  });

  it('does not infer validation from patch or search arguments that merely mention tests', async () => {
    const home = tempCodexHome();
    const path = join(home, 'sessions', '2026', '07', '21', 'rollout-non-validation.jsonl');
    writeFileSync(path, `${rootRollout()[0]}\n${line('response_item', {
      type: 'function_call', name: 'apply_patch', call_id: 'call-patch',
      arguments: '{"patch":"Add docs saying pnpm test"}',
    }, '2026-07-21T08:00:01.000Z')}\n`);
    appendFileSync(path, `${line('response_item', {
      type: 'function_call', name: 'shell', call_id: 'call-search',
      arguments: '{"cmd":"pnpm exec rg test src"}',
    }, '2026-07-21T08:00:02.000Z')}\n${line('response_item', {
      type: 'function_call', name: 'shell', call_id: 'call-view',
      arguments: '{"cmd":"npm view test"}',
    }, '2026-07-21T08:00:03.000Z')}\n`);
    const db = new Database(':memory:');
    runMigrations(db);
    await ingestSourceAdapter(new CodexRolloutAdapter(home), db);
    expect(db.prepare(`SELECT payload_json AS payloadJson FROM canonical_events
      WHERE kind = 'tool-call' ORDER BY sequence`).all()).toEqual([
      { payloadJson: '{"toolName":"apply_patch","callId":"call-patch"}' },
      { payloadJson: '{"toolName":"shell","callId":"call-search"}' },
      { payloadJson: '{"toolName":"shell","callId":"call-view"}' },
    ]);
    db.close();
  });

  it('does not promote reassurance messages into late-constraint evidence', async () => {
    const home = tempCodexHome();
    const path = join(home, 'sessions', '2026', '07', '21', 'rollout-reassurance.jsonl');
    writeFileSync(path, `${rootRollout()[0]}\n${line('response_item', {
      type: 'message', role: 'user', content: [{ type: 'input_text', text: "don't worry, continue" }],
    }, '2026-07-21T08:00:01.000Z')}\n${line('response_item', {
      type: 'message', role: 'user', content: [{ type: 'input_text', text: '请不要着急，继续执行' }],
    }, '2026-07-21T08:00:02.000Z')}\n`);
    const db = new Database(':memory:');
    runMigrations(db);
    await ingestSourceAdapter(new CodexRolloutAdapter(home), db);
    expect(db.prepare(`SELECT payload_json AS payloadJson FROM canonical_events
      WHERE kind = 'user-message' ORDER BY sequence`).all()).toEqual([
      { payloadJson: '{}' }, { payloadJson: '{}' },
    ]);
    db.close();
  });

  it('rebuilds a prior parser source into a new observation era without mixing semantics', async () => {
    const home = tempCodexHome();
    const path = join(home, 'sessions', '2026', '07', '21', 'rollout-upgrade.jsonl');
    writeFileSync(path, `${rootRollout().join('\n')}\n`);
    const db = new Database(':memory:');
    runMigrations(db);
    const adapter = new CodexRolloutAdapter(home);
    await ingestSourceAdapter(adapter, db);
    db.prepare(`INSERT INTO observation_eras
      (id, name, mode, parser_version, capabilities_json, starts_at)
      VALUES ('era:codex-historical-v2', 'old', 'historical-backfill', 'codex-rollout-v2',
        '["active-rollout","archived-rollout","task-tree","token-snapshot"]', '2026-07-21T08:00:00.000Z')`).run();
    db.prepare(`UPDATE source_artifacts SET parser_version = 'codex-rollout-v2', era_id = 'era:codex-historical-v2'`).run();
    db.prepare(`UPDATE canonical_events SET parser_version = 'codex-rollout-v2', era_id = 'era:codex-historical-v2'`).run();
    db.prepare(`UPDATE work_tasks SET era_id = 'era:codex-historical-v2'`).run();
    db.prepare(`DELETE FROM observation_eras WHERE id = 'era:codex-historical-v3'`).run();

    const upgraded = await ingestSourceAdapter(adapter, db);
    expect(upgraded.insertedEvents).toBe(rootRollout().length);
    expect(db.prepare(`SELECT parser_version AS parserVersion, era_id AS eraId FROM source_artifacts`).get())
      .toEqual({ parserVersion: 'codex-rollout-v3', eraId: 'era:codex-historical-v3' });
    expect(db.prepare('SELECT COUNT(*) AS count FROM canonical_events').get()).toEqual({ count: rootRollout().length });
    expect(readWorkTaskDetail(db, 'thread-root')?.diagnostics).toEqual(expect.arrayContaining([
      { severity: 'info', code: 'parser-upgrade-rebuild', count: 1 },
    ]));
    const upgradedPayloadRef = readWorkTaskDetail(db, 'thread-root')?.events
      .find((event) => event.kind === 'user-message')?.payloadRef;
    expect(await adapter.resolvePayloadText(upgradedPayloadRef!)).toBe('PRIVATE_SENTINEL');
    expect(db.prepare(`SELECT ends_at AS endsAt FROM observation_eras WHERE id = 'era:codex-historical-v2'`).get())
      .toEqual({ endsAt: '2026-07-21T08:00:00.000Z' });
    db.close();
  });

  it('keeps an opaque locator and diagnostic for a complete malformed record', async () => {
    const home = tempCodexHome();
    const path = join(home, 'sessions', '2026', '07', '21', 'rollout-malformed.jsonl');
    writeFileSync(path, `${rootRollout()[0]}\nnot-json\n${rootRollout()[2]}\n`);
    const db = new Database(':memory:');
    runMigrations(db);
    const result = await ingestSourceAdapter(new CodexRolloutAdapter(home), db);
    const detail = readWorkTaskDetail(db, 'thread-root');
    expect(result.status).toBe('completed-with-errors');
    expect(detail?.diagnostics).toEqual(expect.arrayContaining([
      { severity: 'error', code: 'malformed-record', count: 1 },
    ]));
    expect(detail?.events.find((event) => event.kind === 'unknown')).toMatchObject({
      sensitivity: 'sensitive-content', payloadRef: expect.stringMatching(/^source:/),
    });
    const repeated = await ingestSourceAdapter(new CodexRolloutAdapter(home), db);
    expect(repeated.insertedEvents).toBe(0);
    expect(readWorkTaskDetail(db, 'thread-root')?.diagnostics).toEqual(expect.arrayContaining([
      { severity: 'error', code: 'malformed-record', count: 1 },
    ]));
    db.close();
  });

  it('normalizes the frozen Code Insights, Buildermark, and Entire structural oracles', async () => {
    const home = tempCodexHome();
    const fixtureRoot = join(import.meta.dirname, '..', '__fixtures__', 'codex-oracles');
    const reconciliation = JSON.parse(readFileSync(join(fixtureRoot, 'reconciliation.json'), 'utf8')) as {
      sources: Array<{
        fixture: string; taskId: string; sourceId: string;
        coverage: { discovered: number; parsed: number; skipped: number; failed: number; unknown: number };
        diagnostics: unknown[];
        events: Array<{ id: string; nativeEventId: string; sequence: number; kind: string; sensitivity: string }>;
      }>;
    };
    for (const source of reconciliation.sources) {
      writeFileSync(
        join(home, 'sessions', '2026', '07', '21', source.fixture),
        readFileSync(join(fixtureRoot, source.fixture)),
      );
    }
    const db = new Database(':memory:');
    runMigrations(db);
    await ingestSourceAdapter(new CodexRolloutAdapter(home), db);
    for (const source of reconciliation.sources) {
      const detail = readWorkTaskDetail(db, source.taskId);
      expect(db.prepare(`SELECT id, native_event_id AS nativeEventId, sequence, kind, sensitivity
        FROM canonical_events WHERE source_artifact_id = ? ORDER BY sequence`).all(source.sourceId))
        .toEqual(source.events);
      expect(detail?.coverage).toEqual(source.coverage);
      expect(detail?.diagnostics).toEqual(source.diagnostics);
      expect(JSON.stringify(detail)).not.toContain('PRIVATE_SENTINEL');
      if (source.taskId === 'entire-thread') {
        expect(detail?.events.find((event) => event.kind === 'compaction')?.sensitivity)
          .toBe('sensitive-content');
      }
    }
    db.close();
  });
});
