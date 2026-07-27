import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { CodexProvider } from './codex.js';

// ---------------------------------------------------------------------------
// Helpers to build JSONL fixture content
// ---------------------------------------------------------------------------

function sessionMeta(id = 'test-session-1', cwd = '/home/user/myproject'): string {
  return JSON.stringify({
    type: 'session_meta',
    payload: { id, timestamp: '2026-01-01T10:00:00Z', cwd, model: 'o4-mini', cli_version: '0.104.0' },
  });
}

function userMessageLine(message: string, id = 'msg-u1'): string {
  return JSON.stringify({
    type: 'event_msg',
    timestamp: '2026-01-01T10:01:00Z',
    payload: { type: 'user_message', id, message },
  });
}

function assistantLine(text: string): string {
  return JSON.stringify({
    type: 'response_item',
    timestamp: '2026-01-01T10:02:00Z',
    payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] },
  });
}

function responseItemUserLine(message: string, id = 'msg-response-u1'): string {
  return JSON.stringify({
    type: 'response_item',
    timestamp: '2026-01-01T10:01:00Z',
    payload: { type: 'message', role: 'user', id, content: [{ type: 'input_text', text: message }] },
  });
}

function agentMessageLine(message: string): string {
  return JSON.stringify({
    type: 'event_msg',
    timestamp: '2026-01-01T10:02:00Z',
    payload: { type: 'agent_message', message },
  });
}

function taskCompleteLine(): string {
  return JSON.stringify({
    type: 'event_msg',
    timestamp: '2026-01-01T10:03:00Z',
    payload: { type: 'task_complete', usage: { input_tokens: 100, output_tokens: 50 } },
  });
}

function tokenCountLine(input: number, cached: number, output: number): string {
  return JSON.stringify({
    type: 'event_msg',
    timestamp: '2026-01-01T10:02:30Z',
    payload: {
      type: 'token_count',
      info: {
        total_token_usage: {
          input_tokens: input,
          cached_input_tokens: cached,
          cache_write_input_tokens: 7,
          output_tokens: output,
          total_tokens: input + output,
        },
        last_token_usage: {
          input_tokens: 60,
          cached_input_tokens: 40,
          cache_write_input_tokens: 0,
          output_tokens: 10,
          total_tokens: 70,
        },
      },
    },
  });
}

function buildJSONL(lines: string[]): string {
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CodexProvider — Format A system context filtering', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-test-'));
  });

  afterEach(() => {
    delete process.env.AGENT_ANALYTICS_CODEX_HOME;
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('parses a minimal valid session with one user + one assistant message', async () => {
    const content = buildJSONL([
      sessionMeta(),
      userMessageLine('What is 2 + 2?'),
      assistantLine('The answer is 4.'),
      taskCompleteLine(),
    ]);

    const filePath = path.join(tempDir, 'rollout-test.jsonl');
    fs.writeFileSync(filePath, content);

    const provider = new CodexProvider();
    const session = await provider.parse(filePath);

    expect(session).not.toBeNull();
    expect(session!.userMessageCount).toBe(1);
    expect(session!.assistantMessageCount).toBe(1);
  });

  it('scopes generated message ids to the session so different rollouts cannot collide', async () => {
    const firstPath = path.join(tempDir, 'rollout-first.jsonl');
    const secondPath = path.join(tempDir, 'rollout-second.jsonl');
    fs.writeFileSync(firstPath, buildJSONL([
      sessionMeta('first-session'),
      userMessageLine('First question', ''),
      assistantLine('First answer'),
      taskCompleteLine(),
    ]));
    fs.writeFileSync(secondPath, buildJSONL([
      sessionMeta('second-session'),
      userMessageLine('Second question', ''),
      assistantLine('Second answer'),
      taskCompleteLine(),
    ]));

    const provider = new CodexProvider();
    const first = await provider.parse(firstPath);
    const second = await provider.parse(secondPath);
    const firstIds = new Set(first?.messages.map((message) => message.id));
    const secondIds = second?.messages.map((message) => message.id) ?? [];

    expect(firstIds.size).toBe(2);
    expect(secondIds.every((id) => !firstIds.has(id))).toBe(true);
    expect(first?.messages.find((message) => message.type === 'assistant')?.id)
      .toContain('codex:first-session:assistant:');
  });

  it('keeps response_item-only user and agent messages from Desktop rollouts', async () => {
    const content = buildJSONL([
      sessionMeta(),
      responseItemUserLine('Please inspect this workspace.'),
      agentMessageLine('I found the relevant package.'),
      taskCompleteLine(),
    ]);
    const filePath = path.join(tempDir, 'rollout-response-items-only.jsonl');
    fs.writeFileSync(filePath, content);

    const session = await new CodexProvider().parse(filePath);

    expect(session).not.toBeNull();
    expect(session?.userMessageCount).toBe(1);
    expect(session?.assistantMessageCount).toBe(1);
    expect(session?.messages.map((message) => message.content)).toEqual([
      'Please inspect this workspace.',
      'I found the relevant package.',
    ]);
  });

  it('deduplicates the response_item and event_msg copies of one user turn', async () => {
    const content = buildJSONL([
      sessionMeta(),
      responseItemUserLine('Run the focused tests.'),
      userMessageLine('Run the focused tests.'),
      assistantLine('The focused tests pass.'),
      taskCompleteLine(),
    ]);
    const filePath = path.join(tempDir, 'rollout-duplicated-user-envelope.jsonl');
    fs.writeFileSync(filePath, content);

    const session = await new CodexProvider().parse(filePath);

    expect(session?.userMessageCount).toBe(1);
    expect(session?.assistantMessageCount).toBe(1);
  });

  it('deduplicates mirrored assistant and reasoning envelopes without dropping fallback events', async () => {
    const reasoningText = 'Planning the smallest relevant check';
    const responseReasoningLine = JSON.stringify({
      type: 'response_item',
      timestamp: '2026-01-01T10:01:30Z',
      payload: { type: 'reasoning', summary: [{ type: 'summary_text', text: reasoningText }] },
    });
    const eventReasoningLine = JSON.stringify({
      type: 'event_msg',
      timestamp: '2026-01-01T10:01:29Z',
      payload: { type: 'agent_reasoning', text: reasoningText },
    });
    const content = buildJSONL([
      sessionMeta(),
      userMessageLine('Inspect this project.'),
      agentMessageLine('I will inspect the project first.'),
      assistantLine('I will inspect the project first.'),
      eventReasoningLine,
      responseReasoningLine,
      agentMessageLine('The project is ready.'),
      assistantLine('The project is ready.'),
      taskCompleteLine(),
    ]);
    const filePath = path.join(tempDir, 'rollout-mirrored-assistant-envelope.jsonl');
    fs.writeFileSync(filePath, content);

    const session = await new CodexProvider().parse(filePath);
    const assistant = session?.messages.find((message) => message.type === 'assistant');

    expect(assistant?.content).toBe('I will inspect the project first.\nThe project is ready.');
    expect(assistant?.thinking?.trim()).toBe(reasoningText);
  });

  it('uses per-turn usage instead of account-wide cumulative token snapshots', async () => {
    const content = buildJSONL([
      sessionMeta(),
      userMessageLine('Measure this session'),
      assistantLine('Measured.'),
      tokenCountLine(1_000, 700, 120),
      tokenCountLine(1_500, 1_100, 180),
      JSON.stringify({
        type: 'event_msg', timestamp: '2026-01-01T10:03:00Z',
        payload: { type: 'task_complete' },
      }),
    ]);
    const filePath = path.join(tempDir, 'rollout-token-snapshot.jsonl');
    fs.writeFileSync(filePath, content);

    const session = await new CodexProvider().parse(filePath);

    expect(session?.usage).toMatchObject({
      totalInputTokens: 20,
      cacheReadTokens: 40,
      cacheCreationTokens: 0,
      totalOutputTokens: 10,
      usageSource: 'jsonl',
    });
    expect(session?.messages.find((message) => message.type === 'assistant')?.usage).toMatchObject({
      inputTokens: 20, cacheReadTokens: 40, outputTokens: 10,
    });
  });

  it('filters out <permissions> system context messages', async () => {
    const content = buildJSONL([
      sessionMeta(),
      userMessageLine('<permissions>read_only</permissions>'),
      userMessageLine('What is 2 + 2?'),
      assistantLine('The answer is 4.'),
      taskCompleteLine(),
    ]);

    const filePath = path.join(tempDir, 'rollout-permissions.jsonl');
    fs.writeFileSync(filePath, content);

    const provider = new CodexProvider();
    const session = await provider.parse(filePath);

    expect(session).not.toBeNull();
    // Only the genuine user message should be counted
    expect(session!.userMessageCount).toBe(1);
  });

  it('filters out <environment_context> system context messages', async () => {
    const content = buildJSONL([
      sessionMeta(),
      userMessageLine('<environment_context>OS: Linux, shell: bash</environment_context>'),
      userMessageLine('Hello, please help me refactor this code.'),
      assistantLine('Sure! What would you like to change?'),
      taskCompleteLine(),
    ]);

    const filePath = path.join(tempDir, 'rollout-env-context.jsonl');
    fs.writeFileSync(filePath, content);

    const provider = new CodexProvider();
    const session = await provider.parse(filePath);

    expect(session).not.toBeNull();
    expect(session!.userMessageCount).toBe(1);
  });

  it('filters out # AGENTS.md system context messages', async () => {
    const content = buildJSONL([
      sessionMeta(),
      userMessageLine('# AGENTS.md\n\nThis is the agents configuration file...'),
      userMessageLine('Add a new feature to the codebase.'),
      assistantLine('I will help you add that feature.'),
      taskCompleteLine(),
    ]);

    const filePath = path.join(tempDir, 'rollout-agents-md.jsonl');
    fs.writeFileSync(filePath, content);

    const provider = new CodexProvider();
    const session = await provider.parse(filePath);

    expect(session).not.toBeNull();
    expect(session!.userMessageCount).toBe(1);
  });

  it('filters out multiple consecutive system context messages before first real prompt', async () => {
    const content = buildJSONL([
      sessionMeta(),
      userMessageLine('<permissions>read_write</permissions>'),
      userMessageLine('<environment_context>cwd: /home/user/project</environment_context>'),
      userMessageLine('## Shell\nbash 5.1'),
      userMessageLine('Now fix the bug in src/main.ts'),
      assistantLine("I'll fix that bug right away."),
      taskCompleteLine(),
    ]);

    const filePath = path.join(tempDir, 'rollout-multi-system.jsonl');
    fs.writeFileSync(filePath, content);

    const provider = new CodexProvider();
    const session = await provider.parse(filePath);

    expect(session).not.toBeNull();
    // 3 system context messages filtered + 1 real user message
    expect(session!.userMessageCount).toBe(1);
  });

  it('filters the Codex Desktop plugin and AGENTS context packet before the real prompt', async () => {
    const content = buildJSONL([
      sessionMeta(),
      userMessageLine(`<recommended_plugins>\nHere is a list of plugins.\n</recommended_plugins>\n# AGENTS.md instructions\n<INSTRUCTIONS>Injected rules</INSTRUCTIONS>\n<environment_context>cwd: /tmp</environment_context>`),
      userMessageLine('检查现在 audiokit 相关接口和使用情况', 'msg-u2'),
      assistantLine('我会检查接口和调用路径。'),
      taskCompleteLine(),
    ]);
    const filePath = path.join(tempDir, 'rollout-plugin-context.jsonl');
    fs.writeFileSync(filePath, content);

    const session = await new CodexProvider().parse(filePath);

    expect(session?.userMessageCount).toBe(1);
    expect(session?.messages.filter((message) => message.type === 'user').map((message) => message.content))
      .toEqual(['检查现在 audiokit 相关接口和使用情况']);
    expect(session?.generatedTitle).toBe('检查现在 audiokit 相关接口和使用情况');
  });

  it('keeps only the user-provided payload from Codex goal and delegation wrappers', async () => {
    const content = buildJSONL([
      sessionMeta(),
      userMessageLine('<codex_internal_context source="goal"><objective>完成跨会话分析报告</objective></codex_internal_context>', 'goal'),
      assistantLine('继续执行目标。'),
      userMessageLine('<codex_delegation><input>修复任务标题</input></codex_delegation>', 'delegation'),
      assistantLine('我会修复标题。'),
      taskCompleteLine(),
    ]);
    const filePath = path.join(tempDir, 'rollout-wrapped-user-payload.jsonl');
    fs.writeFileSync(filePath, content);

    const session = await new CodexProvider().parse(filePath);

    expect(session?.messages.filter((message) => message.type === 'user').map((message) => message.content))
      .toEqual(['完成跨会话分析报告', '修复任务标题']);
    expect(session?.generatedTitle).toBe('完成跨会话分析报告');
  });

  it('filters injected skill definitions while preserving the explicit skill invocation', async () => {
    const content = buildJSONL([
      sessionMeta(),
      userMessageLine('[$oh-my-codex:ai-slop-cleaner](/tmp/SKILL.md)', 'invoke'),
      userMessageLine('<skill><name>oh-my-codex:ai-slop-cleaner</name><path>/tmp/SKILL.md</path>Injected instructions</skill>', 'definition'),
      assistantLine('我会按该技能检查。'),
      taskCompleteLine(),
    ]);
    const filePath = path.join(tempDir, 'rollout-skill-context.jsonl');
    fs.writeFileSync(filePath, content);

    const session = await new CodexProvider().parse(filePath);

    expect(session?.userMessageCount).toBe(1);
    expect(session?.generatedTitle).toBe('Use skill oh-my-codex:ai-slop-cleaner');
  });

  it('preserves normal user messages that happen to contain XML-like text', async () => {
    const content = buildJSONL([
      sessionMeta(),
      userMessageLine('Can you explain the <permissions> model in OAuth 2.0?'),
      assistantLine('OAuth 2.0 uses scopes to define permissions...'),
      taskCompleteLine(),
    ]);

    const filePath = path.join(tempDir, 'rollout-xml-in-user-msg.jsonl');
    fs.writeFileSync(filePath, content);

    const provider = new CodexProvider();
    const session = await provider.parse(filePath);

    expect(session).not.toBeNull();
    // Message asks ABOUT permissions (not a system context injection — doesn't START with the tag)
    expect(session!.userMessageCount).toBe(1);
  });

  it('returns null when session has no real messages after system context filtering', async () => {
    const content = buildJSONL([
      sessionMeta(),
      userMessageLine('<permissions>read_only</permissions>'),
      userMessageLine('<environment_context>cwd: /tmp</environment_context>'),
      // No actual user message or assistant response follows
    ]);

    const filePath = path.join(tempDir, 'rollout-only-system.jsonl');
    fs.writeFileSync(filePath, content);

    const provider = new CodexProvider();
    const session = await provider.parse(filePath);

    // buildSession returns null when messages.length === 0
    expect(session).toBeNull();
  });

  it('counts messageCount as userMessageCount + assistantMessageCount', async () => {
    const content = buildJSONL([
      sessionMeta(),
      userMessageLine('<environment_context>cwd: /tmp</environment_context>'),
      userMessageLine('First real question'),
      assistantLine('First answer'),
      taskCompleteLine(),
      userMessageLine('Second question'),
      assistantLine('Second answer'),
      taskCompleteLine(),
    ]);

    const filePath = path.join(tempDir, 'rollout-message-count.jsonl');
    fs.writeFileSync(filePath, content);

    const provider = new CodexProvider();
    const session = await provider.parse(filePath);

    expect(session).not.toBeNull();
    expect(session!.userMessageCount).toBe(2);
    expect(session!.assistantMessageCount).toBe(2);
    expect(session!.messageCount).toBe(session!.userMessageCount + session!.assistantMessageCount);
  });

  it('includes compactCount, autoCompactCount, and slashCommands with zero/empty defaults', async () => {
    const content = buildJSONL([
      sessionMeta(),
      userMessageLine('Run the tests please'),
      assistantLine('Running tests now...'),
      taskCompleteLine(),
    ]);

    const filePath = path.join(tempDir, 'rollout-v6-fields.jsonl');
    fs.writeFileSync(filePath, content);

    const provider = new CodexProvider();
    const session = await provider.parse(filePath);

    expect(session).not.toBeNull();
    expect(session!.compactCount).toBe(0);
    expect(session!.autoCompactCount).toBe(0);
    expect(session!.slashCommands).toEqual([]);
  });

  it('counts Codex compacted envelopes as automatic context compactions', async () => {
    const content = buildJSONL([
      sessionMeta(),
      userMessageLine('Continue the implementation'),
      JSON.stringify({
        type: 'compacted',
        timestamp: '2026-01-01T10:01:30Z',
        payload: { message: '', replacement_history: [], window_number: 1 },
      }),
      assistantLine('Continuing after compaction.'),
      taskCompleteLine(),
    ]);

    const filePath = path.join(tempDir, 'rollout-compacted.jsonl');
    fs.writeFileSync(filePath, content);
    const session = await new CodexProvider().parse(filePath);

    expect(session).not.toBeNull();
    expect(session!.compactCount).toBe(0);
    expect(session!.autoCompactCount).toBe(1);
  });

  it('discovers sessions from AGENT_ANALYTICS_CODEX_HOME without using HOME', async () => {
    const explicitHome = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-analytics-codex-home-'));
    const sessionDir = path.join(explicitHome, 'sessions', '2026', '07', '21');
    fs.mkdirSync(sessionDir, { recursive: true });

    const filePath = path.join(sessionDir, 'rollout-test.jsonl');
    fs.writeFileSync(filePath, buildJSONL([
      sessionMeta('test-session-discover', '/tmp/project'),
      userMessageLine('Hello from explicit home'),
      assistantLine('Hi there.'),
      taskCompleteLine(),
    ]));

    process.env.AGENT_ANALYTICS_CODEX_HOME = explicitHome;

    const provider = new CodexProvider();
    const discovered = await provider.discover();

    expect(discovered).toContain(filePath);
  });
});
