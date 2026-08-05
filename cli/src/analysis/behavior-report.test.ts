import Database from 'better-sqlite3';
import { describe, expect, it, vi } from 'vitest';
import { runMigrations } from '../db/migrate.js';
import { behaviorReportUnavailableReason, buildBehaviorReportDataset, generateBehaviorReport } from './behavior-report.js';
import { getAutomaticBehaviorReportState } from './behavior-report-scheduler.js';
import { recordAnalysisRun } from './analysis-run-db.js';
import type { AnalysisRunner } from './runner-types.js';

function fixtureDb(): Database.Database {
  const db = new Database(':memory:');
  runMigrations(db);
  db.exec(`
    INSERT INTO projects (id, name, path, last_activity)
      VALUES ('project', 'project', '/private/repo', '2026-07-22T00:00:00.000Z');
    INSERT INTO observation_eras (id, name, mode, parser_version, capabilities_json, starts_at)
      VALUES ('era', 'fixture', 'historical-backfill', 'fixture-v1', '[]', '2026-07-01T00:00:00.000Z');
  `);
  const session = db.prepare(`INSERT INTO sessions
    (id, project_id, project_name, project_path, started_at, ended_at,
     user_message_count, assistant_message_count, compact_count)
    VALUES (?, 'project', 'project', '/private/repo', ?, ?, 2, 1, ?)`);
  const message = db.prepare(`INSERT INTO messages
    (id, session_id, type, content, tool_calls, tool_results, timestamp)
    VALUES (?, ?, ?, ?, '[]', '[]', ?)`);
  const insight = db.prepare(`INSERT INTO insights
    (id, session_id, project_id, project_name, type, title, content, summary,
     bullets, confidence, source, metadata, timestamp, created_at)
    VALUES (?, ?, 'project', 'project', 'summary', 'Summary', 'Safe conclusion',
      'Bounded prior LLM summary', '[]', 0.9, 'llm', '{}', ?, ?)`);
  const task = db.prepare(`INSERT INTO work_tasks
    (id, root_task_id, thread_id, role, status, started_at, ended_at, era_id)
    VALUES (?, ?, ?, 'root', 'completed', ?, ?, 'era')`);
  for (let index = 0; index < 10; index += 1) {
    const day = String(10 + index).padStart(2, '0');
    const startedAt = `2026-07-${day}T00:00:00.000Z`;
    const endedAt = `2026-07-${day}T01:00:00.000Z`;
    const sessionId = `session-${index}`;
    session.run(sessionId, startedAt, endedAt, index === 0 ? 1 : 0);
    message.run(`${sessionId}-u1`, sessionId, 'user', `${index === 0 ? '$diagnose ' : ''}Implement /repo/item-${index}`, startedAt);
    message.run(`${sessionId}-a1`, sessionId, 'assistant', 'Done', endedAt);
    message.run(`${sessionId}-u2`, sessionId, 'user', index === 0 ? 'SECRET_RAW_MESSAGE' : 'verify tests', endedAt);
    insight.run(`insight-${index}`, sessionId, endedAt, endedAt);
    task.run(`task-${index}`, `task-${index}`, sessionId, startedAt, endedAt);
  }
  message.run('session-0-projected', 'session-0', 'user',
    '<observed_from_primary_session>\n<what_happened>Bash</what_happened>\n<parameters>rc=$?; exit $rc</parameters>',
    '2026-07-10T00:30:00.000Z');
  db.exec(`
    INSERT INTO source_artifacts (id, source_kind, locator_hash, observed_at, era_id)
      VALUES ('source', 'codex-rollout', 'hash', '2026-07-10T00:00:00.000Z', 'era');
    INSERT INTO canonical_events
      (id, source_artifact_id, era_id, native_event_id, sequence, occurred_at, kind, actor,
       sensitivity, payload_json, task_id, thread_id, parser_version)
      VALUES
      ('event-context', 'source', 'era', 'native-context', 0, '2026-07-10T00:05:00.000Z',
       'turn-context', 'system', 'metadata', '{"model":"gpt-5.6-sol","effort":"high"}',
       'task-0', 'session-0', 'fixture-v1'),
      ('event-edit', 'source', 'era', 'native-edit', 1, '2026-07-10T00:10:00.000Z',
       'tool-call', 'assistant', 'metadata', '{"toolName":"apply_patch","callId":"edit"}',
       'task-0', 'session-0', 'fixture-v1'),
      ('event-test', 'source', 'era', 'native-test', 2, '2026-07-10T00:20:00.000Z',
       'tool-call', 'assistant', 'metadata', '{"toolName":"exec_command","callId":"test","validationKind":"test"}',
       'task-0', 'session-0', 'fixture-v1');
  `);
  return db;
}

describe('cross-session behavior report', () => {
  it('runs only after new evidence and at most once per 24 hours', () => {
    const db = fixtureDb();
    const now = new Date('2026-07-22T00:00:00.000Z');
    expect(getAutomaticBehaviorReportState(db, now)).toMatchObject({ due: true, reason: 'due' });

    recordAnalysisRun({
      analysisType: 'behavior_report', status: 'completed', promptVersion: 'behavior-report-v5',
      inputSummary: { basis: { latestSessionAt: '2026-07-18T00:00:00.000Z' } },
    }, db);
    const cooldown = getAutomaticBehaviorReportState(db, new Date());
    expect(cooldown).toMatchObject({ due: false, reason: 'cooldown' });
    expect(getAutomaticBehaviorReportState(db, new Date(Date.parse(cooldown.latestAttemptAt!) + 24 * 60 * 60 * 1_000 + 1)))
      .toMatchObject({ due: true, reason: 'due' });
    db.close();
  });

  it('uses every structurally readable session when no session-level LLM insight exists', () => {
    const db = fixtureDb();
    db.prepare(`DELETE FROM insights`).run();

    const dataset = buildBehaviorReportDataset(db, new Date('2026-07-22T00:00:00.000Z'));

    expect(dataset.coverage).toEqual({
      windowSessions: 10,
      structurallyAnalyzedSessions: 10,
      semanticEnrichedSessions: 0,
      structuralRatio: 1,
      semanticEnrichmentRatio: 0,
    });
    expect(dataset.representativeEpisodes).toHaveLength(10);
    expect(dataset.representativeEpisodes[0]).toMatchObject({
      selectionReasons: expect.arrayContaining(['structural-analysis']),
      findings: [],
      behaviorSignals: {
        firstMessage: expect.objectContaining({ hasPathContext: true }),
      },
    });
    expect(behaviorReportUnavailableReason(dataset)).toBeNull();
    db.close();
  });

  it('calculates cache-read share from input token classes only', () => {
    const db = fixtureDb();
    db.prepare(`UPDATE sessions SET total_input_tokens = 400, total_output_tokens = 100,
      cache_creation_tokens = 100, cache_read_tokens = 200`).run();

    const dataset = buildBehaviorReportDataset(db, new Date('2026-07-22T00:00:00.000Z'));

    expect(dataset.tokenEfficiency.cacheReadShare).toBe(0.5);
    db.close();
  });

  it('discovers dynamic dimensions from representative episodes before coaching the final profile', async () => {
    const db = fixtureDb();
    const now = new Date('2026-07-22T00:00:00.000Z');
    const dataset = buildBehaviorReportDataset(db, now);
    expect(dataset.coverage).toEqual({
      windowSessions: 10,
      structurallyAnalyzedSessions: 10,
      semanticEnrichedSessions: 10,
      structuralRatio: 1,
      semanticEnrichmentRatio: 1,
    });
    expect(dataset.activity.rootTasks).toBe(10);
    expect(dataset.activity.sessionsOverFiveUserMessages).toBe(0);
    expect(dataset.promptSignals).toMatchObject({ firstMessages: 10, withPath: 10 });
    expect(dataset).not.toHaveProperty('workstyleSignals');
    expect(dataset).not.toHaveProperty('validationObservability');
    expect(dataset.representativeEpisodes).toHaveLength(10);
    expect(dataset.representativeEpisodes[0]).toMatchObject({
      sessionRef: expect.stringMatching(/^session-/),
      cohort: { projectRef: 'project', lengthBand: 'short' },
      selectionReasons: expect.arrayContaining(['structural-analysis', 'semantic-enrichment']),
    });
    expect(JSON.stringify(dataset.representativeEpisodes)).toContain('Bounded prior LLM summary');
    expect(dataset.basis.latestSessionAt).toBe('2026-07-19T00:00:00.000Z');
    expect(dataset.leverage.skills).toMatchObject({ explicitInvocations: 1, coveredSessions: 1 });
    expect(dataset.leverage.skills.items[0]).toMatchObject({
      name: 'diagnose', invocations: 1, sessions: 1, weeklyInvocations: [0, 0, 1, 0],
    });
    expect(dataset.leverage.skills.items[0]).not.toHaveProperty('validationRate');
    expect(dataset.leverage.tools).toMatchObject({ totalCalls: 2, coveredTasks: 1 });
    expect(dataset.runtimeUsage).toMatchObject({
      models: [{ name: 'gpt-5.6-sol', turns: 1, sessions: 1 }],
      reasoningEfforts: [{ name: 'high', turns: 1, sessions: 1 }],
    });
    expect(dataset.representativeEpisodes.find((item) => item.sessionRef === 'session-0')?.runtime)
      .toEqual({ models: ['gpt-5.6-sol'], reasoningEfforts: ['high'] });
    const runAnalysis = vi.fn(async ({ userPrompt }: { userPrompt: string }) => {
      expect(userPrompt).not.toContain('SECRET_RAW_MESSAGE');
      if (userPrompt.includes('阶段一')) {
        expect(userPrompt).toContain('representativeEpisodes');
        expect(userPrompt).toContain('Bounded prior LLM summary');
        return {
          rawJson: JSON.stringify({
            profileThesis: 'AI 工程编排者',
            selectedEpisodeRefs: ['session-0'],
            detailSelectionRationale: '选择包含主要模式与反例的任务。',
            behavioralFindings: [{ title: '多代理编排', observation: '稳定使用多个执行通道。', mechanism: '任务拆分。', applicability: ['复杂任务'], counterEvidence: [], evidenceRefs: ['session-0'] }],
            dimensions: [{
              id: 'orchestration-boundary', label: '编排边界设计', status: 'candidate',
              observation: '能组织复杂任务，但仍承担部分事件循环。', mechanism: '授权边界不统一。',
              applicability: ['多阶段实现'], counterEvidence: ['短任务中没有该问题'],
              benefitHypothesis: '明确可逆动作授权可能减少人工介入。', confidence: 'medium',
              evidenceRefs: ['session-0'],
            }],
            contradictions: ['短任务样本表现不同'], missingEvidence: ['缺少结果对照'],
          }),
          durationMs: 6, inputTokens: 12, outputTokens: 8, model: 'test', provider: 'test',
        };
      }
      expect(userPrompt).toContain('AI 工程编排者');
      return {
        rawJson: JSON.stringify({
          identity: { title: 'AI 工程编排者', stage: '系统化升级期', rationale: '已形成多代理工作方式。', evidenceRefs: ['session-0'] },
          headline: '从高频编排升级为自主闭环系统设计', summary: '总结',
          portrait: [{ title: '多项目高强度使用', finding: '形成稳定编排习惯。', evidenceRefs: ['session-0'] }],
          strengths: [], bottlenecks: [], dimensions: [{
            id: 'orchestration-boundary', label: '编排边界设计', status: 'candidate',
            observation: '能组织复杂任务，但仍承担部分事件循环。', benefitHypothesis: '待追踪。',
            applicability: ['多阶段实现'], limitations: ['缺少结果对照'], confidence: 'medium', evidenceRefs: ['session-0'],
          }],
          skillAssessments: [],
          runtimeAssessments: [{
            category: 'model', target: 'gpt-5.6-sol', fit: 'appropriate',
            observation: '复杂诊断任务中使用。', issue: null,
            recommendation: '复杂诊断继续使用；简单查询先比较更轻配置。',
            applicability: '多步骤诊断', evidenceRefs: ['session-0'],
          }],
          developmentPlan: {
            northStar: '建立可自主闭环的个人工程系统',
            operatingRules: ['可逆动作一次授权'],
            improvementPlans: [{ title: '授权边界改进', hypothesis: '减少人工介入。', eligibleCohort: '多阶段实现', observableOutcome: '用户介入次数', guardrail: '高风险动作仍询问', reviewAfter: '10 个任务', relationshipToPrevious: 'parallel', sequencingReason: '首个计划', evidenceRefs: ['session-0'] }],
            taskTemplate: '目标：\n边界：\n完成定义：',
          },
          uncertainty: '有限证据',
        }),
        durationMs: 10, inputTokens: 20, outputTokens: 10, model: 'test', provider: 'test',
      };
    });
    const runner = { name: 'test', runAnalysis } as AnalysisRunner;
    await expect(generateBehaviorReport({ db, runner, now })).resolves.toMatchObject({ status: 'completed' });
    expect(runAnalysis).toHaveBeenCalledTimes(2);
    await expect(generateBehaviorReport({ db, runner, now })).resolves.toMatchObject({ status: 'completed' });
    expect(runAnalysis).toHaveBeenCalledTimes(3);
    expect(db.prepare(`SELECT status, prompt_version AS promptVersion FROM analysis_runs
      WHERE analysis_type = 'behavior_report' ORDER BY created_at DESC LIMIT 1`).get())
      .toEqual({ status: 'completed', promptVersion: 'behavior-report-v11' });
    expect(db.prepare(`SELECT analysis_type AS analysisType, status FROM analysis_runs
      WHERE analysis_type IN ('behavior_research', 'behavior_coach')
      ORDER BY analysis_type`).all()).toEqual([
      { analysisType: 'behavior_coach', status: 'completed' },
      { analysisType: 'behavior_coach', status: 'completed' },
      { analysisType: 'behavior_research', status: 'completed' },
    ]);
    db.close();
  });

  it('does not use semantic enrichment as a report eligibility gate', () => {
    const db = fixtureDb();
    db.prepare(`DELETE FROM insights WHERE id NOT IN ('insight-0', 'insight-1', 'insight-2')`).run();
    const dataset = buildBehaviorReportDataset(db, new Date('2026-07-22T00:00:00.000Z'));
    expect(dataset.coverage.semanticEnrichedSessions).toBe(3);
    expect(behaviorReportUnavailableReason(dataset)).toBeNull();

    db.prepare(`DELETE FROM insights`).run();
    expect(behaviorReportUnavailableReason(buildBehaviorReportDataset(
      db, new Date('2026-07-22T00:00:00.000Z'),
    ))).toBeNull();
    db.close();
  });

  it('records an unreachable local model service as temporarily unavailable', async () => {
    const db = fixtureDb();
    const runner = {
      name: 'unreachable-provider',
      runAnalysis: vi.fn(async () => {
        throw new TypeError('fetch failed', { cause: new Error('connect ECONNREFUSED') });
      }),
    } as AnalysisRunner;

    await expect(generateBehaviorReport({
      db, runner, now: new Date('2026-07-22T00:00:00.000Z'),
    })).rejects.toThrow('fetch failed');
    expect(db.prepare(`SELECT status, unavailable_reason AS unavailableReason
      FROM analysis_runs WHERE analysis_type = 'behavior_report'`).get()).toEqual({
      status: 'failed',
      unavailableReason: 'runner-service-unavailable',
    });
    db.close();
  });
});
