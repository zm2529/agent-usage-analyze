import Database from 'better-sqlite3';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runMigrations } from '../db/schema.js';
import { CODEX_HOOK_MARKER } from '../utils/codex-hooks.js';

let testDb: Database.Database;
vi.mock('../db/client.js', () => ({ getDb: () => testDb, getDbPath: () => ':memory:' }));

const { handleCodexStopInput } = await import('../commands/codex-stop.js');
const { recordSettledFrontier } = await import('./settled-frontier.js');
const { processDueFrontiers } = await import('./settled-scheduler.js');
const { runInsightsCommand } = await import('../commands/insights.js');

const sessionResponse = JSON.stringify({
  facets: {
    outcome_satisfaction: 'high', workflow_pattern: 'direct-execution',
    had_course_correction: false, course_correction_reason: null, iteration_count: 0,
    friction_points: [], effective_patterns: [],
  },
  summary: { title: 'Settled task', content: 'The settled task completed.', bullets: ['Completed'] },
  decisions: [{ title: 'Use SQLite', reasoning: 'The user requested it.', evidence: ['User#0'] }],
  learnings: [],
});
const promptQualityResponse = JSON.stringify({
  efficiency_score: 90, message_overhead: 0, assessment: 'Direct request.',
  takeaways: [], findings: [],
  dimension_scores: {
    context_provision: 90, request_specificity: 90, scope_management: 90,
    information_timing: 90, correction_quality: 90,
  },
});

afterEach(() => testDb?.close());

describe('Codex zero-config automatic analysis loop', () => {
  it('debounces ten Stops into one settled analysis job with visible results and overhead', async () => {
    testDb = new Database(':memory:');
    runMigrations(testDb);
    const spawnScheduler = vi.fn();
    for (let index = 0; index < 10; index += 1) {
      const now = new Date(Date.parse('2026-07-22T00:00:00Z') + index * 1_000);
      handleCodexStopInput(JSON.stringify({
        session_id: 'native-session', turn_id: `turn-${index}`,
        transcript_path: '/tmp/native-session.jsonl', cwd: '/tmp/project', hook_event_name: 'Stop',
      }), { managedHook: CODEX_HOOK_MARKER }, {
        isRecursive: false, automaticEnabled: true, idleSeconds: 90, now,
        record: (event, observedAt, idle) => recordSettledFrontier(testDb, event, observedAt, idle),
        spawnScheduler,
      });
    }
    expect(spawnScheduler).toHaveBeenCalledTimes(10);
    expect(testDb.prepare('SELECT COUNT(*) AS count FROM analysis_queue').get()).toEqual({ count: 1 });
    expect(testDb.prepare('SELECT generation, latest_turn_id FROM analysis_queue').get())
      .toEqual({ generation: 10, latest_turn_id: 'turn-9' });

    const runAnalysis = vi.fn()
      .mockResolvedValueOnce({
        rawJson: sessionResponse, durationMs: 12, inputTokens: 100, cacheReadTokens: 20,
        outputTokens: 30, reasoningTokens: 5, model: 'codex-default', provider: 'codex-native',
      })
      .mockResolvedValueOnce({
        rawJson: promptQualityResponse, durationMs: 8, inputTokens: 50, cacheReadTokens: 10,
        outputTokens: 15, reasoningTokens: 2, model: 'codex-default', provider: 'codex-native',
      });
    const analyzeJob = vi.fn(async (
      sessionId: string, runner: { name: string; runAnalysis: typeof runAnalysis },
      guard: () => boolean, finalize: () => boolean,
    ) => runInsightsCommand({
      sessionId, native: false, force: true, quiet: true, _runner: runner,
      _automaticPrivacy: true, _commitGuard: guard, _finalize: finalize,
    }));
    const prepareProjection = async () => ({
      complete: true, diagnostic: null,
      commit: () => {
        testDb.prepare(`INSERT INTO projects (id, name, path, last_activity)
          VALUES ('project', 'project', '/tmp/project', '2026-07-22T00:00:00Z')`).run();
        testDb.prepare(`INSERT INTO sessions (
          id, project_id, project_name, project_path, started_at, ended_at, message_count,
          user_message_count, assistant_message_count, source_tool
        ) VALUES (
          'codex:native-session', 'project', 'project', '/tmp/project',
          '2026-07-22T00:00:00Z', '2026-07-22T00:00:10Z', 2, 1, 1, 'codex-cli'
        )`).run();
        testDb.prepare(`INSERT INTO messages
          (id, session_id, type, content, thinking, tool_calls, tool_results, timestamp)
          VALUES (?, 'codex:native-session', ?, ?, NULL, '[]', '[]', ?)`).run(
          'user', 'user', 'Use SQLite', '2026-07-22T00:00:01Z',
        );
        testDb.prepare(`INSERT INTO messages
          (id, session_id, type, content, thinking, tool_calls, tool_results, timestamp)
          VALUES (?, 'codex:native-session', ?, ?, NULL, '[]', '[]', ?)`).run(
          'assistant', 'assistant', 'SQLite selected', '2026-07-22T00:00:02Z',
        );
      },
    });

    await expect(processDueFrontiers(
      testDb, new Date('2026-07-22T00:02:00Z'),
      () => ({
        now: () => new Date('2026-07-22T00:02:00Z'), idleSeconds: 90,
        locate: () => ({ path: '/tmp/native-session.jsonl', locatorAccepted: true, diagnostic: null }),
        contentBasis: () => 'rollout-sha256:stable', ingest: async () => ({ complete: true, diagnostic: null }),
        prepareProjection, invalidateProjection: vi.fn(),
        execution: { effectiveRunner: 'codex-native', reason: 'codex-chatgpt-auth' },
      }),
      () => ({
        now: () => new Date('2026-07-22T00:02:01Z'),
        buildRunner: () => ({ name: 'codex-native', runAnalysis }), analyze: analyzeJob,
      }),
    )).resolves.toBe(1);

    expect(analyzeJob).toHaveBeenCalledOnce();
    // A one-prompt task has enough evidence for a session summary, but not for
    // a prompt-quality score. The second LLM call must be skipped.
    expect(runAnalysis).toHaveBeenCalledTimes(1);
    expect(testDb.prepare('SELECT status FROM analysis_queue').get()).toEqual({ status: 'completed' });
    expect(testDb.prepare('SELECT COUNT(*) AS count FROM insights').get()).toEqual({ count: 2 });
    expect(testDb.prepare(`SELECT COUNT(*) AS count FROM observer_overhead_events
      WHERE llm_provider = 'codex-native'`).get()).toEqual({ count: 1 });
  });
});
