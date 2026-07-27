import Database from 'better-sqlite3';
import { describe, expect, it, vi } from 'vitest';
import { runMigrations } from '../db/migrate.js';
import type { AnalysisRunner } from './runner-types.js';
import {
  createImprovementPlanFromPractice,
  observeTaskAgainstImprovementPlans,
  reviewImprovementPlan,
} from './improvement-tracking.js';

function llm(rawJson: string) {
  return {
    rawJson,
    durationMs: 8,
    inputTokens: 12,
    outputTokens: 7,
    model: 'test-model',
    provider: 'test-provider',
  };
}

describe('LLM-led improvement tracking', () => {
  it('creates, observes, caps, and independently reviews a plan', async () => {
    const db = new Database(':memory:');
    runMigrations(db);
    db.prepare(`INSERT INTO knowledge_snapshots (
      id, scope, snapshot_version, prompt_version, status, source_count,
      practice_count, query_summary_json, output_json, created_at
    ) VALUES ('snapshot:1', 'weekly', 'v1', 'p1', 'completed', 1, 1, '{}', '{}', ?)`)
      .run('2026-07-20T00:00:00.000Z');
    db.prepare(`INSERT INTO knowledge_practices (
      id, snapshot_id, title, summary, applicability, source_trust,
      discussion_breadth, recency, local_relevance, local_effect_status,
      rationale, tags_json, source_refs_json, conflicts_json
    ) VALUES (
      'practice:1', 'snapshot:1', 'State completion evidence', 'Require evidence.',
      'Implementation tasks', 'official', 'medium', 'current', 'high', 'not-reviewed',
      'Official guidance', '[]', '[{"url":"https://example.com"}]', '[]'
    )`).run();
    const planRunner = {
      name: 'plan',
      runAnalysis: vi.fn(async () => llm(JSON.stringify({
        title: 'State completion evidence',
        hypothesis: 'Explicit evidence expectations reduce unsupported completion claims.',
        applicability: 'Implementation tasks',
        eligibleTasks: 'Tasks that modify code and require validation',
        observableOutcome: 'Completion reports cite fresh validation evidence',
        guardrail: 'Do not reduce necessary validation scope',
        reviewWhen: 'Review after enough comparable completed implementation tasks',
        overlapWithPlanIds: [],
        sequencingReason: 'No active overlap',
      }))),
    } as AnalysisRunner;
    const created = await createImprovementPlanFromPractice({
      practiceId: 'practice:1',
      runner: planRunner,
      db,
    });
    expect(created.status).toBe('observing');

    db.prepare(`UPDATE improvement_plans SET max_task_count = 1 WHERE id = ?`).run(created.id);
    db.prepare(`INSERT INTO observation_eras (
      id, name, mode, parser_version, capabilities_json, starts_at
    ) VALUES (
      'era:1', 'test', 'continuous-observation', 'v1', '[]',
      '2026-07-25T00:00:00.000Z'
    )`).run();
    db.prepare(`INSERT INTO work_tasks (
      id, root_task_id, thread_id, role, status, started_at, ended_at, era_id
    ) VALUES (
      'task:1', 'task:1', 'thread:1', 'root', 'completed',
      '2026-07-25T00:00:00.000Z', '2026-07-25T01:00:00.000Z', 'era:1'
    )`).run();
    const observationRunner = {
      name: 'observation',
      runAnalysis: vi.fn(async () => llm(JSON.stringify({
        observations: [{
          planId: created.id,
          eligible: true,
          adoption: 'observed',
          counterEvidence: false,
          negativeImpact: false,
          reviewReady: false,
          rationale: 'The completed task is in the LLM-defined cohort.',
          evidenceRefs: ['task:1'],
        }],
      }))),
    } as AnalysisRunner;
    const observed = await observeTaskAgainstImprovementPlans({
      taskId: 'task:1',
      runner: observationRunner,
      db,
      now: new Date('2026-07-25T02:00:00.000Z'),
    });
    expect(observed).toEqual({ observed: 1, reviewReady: [created.id] });
    expect(db.prepare(`SELECT status, matched_task_count AS matched,
      adoption_signal_count AS adopted FROM improvement_plans WHERE id = ?`)
      .get(created.id)).toEqual({ status: 'review-ready', matched: 1, adopted: 1 });

    const reviewRunner = {
      name: 'review',
      runAnalysis: vi.fn(async () => llm(JSON.stringify({
        outcome: 'insufficient-evidence',
        rationale: 'One task is not enough to establish a local effect.',
        supportingRefs: ['task:1'],
        opposingRefs: [],
        limitations: ['Only one eligible task'],
      }))),
    } as AnalysisRunner;
    const reviewed = await reviewImprovementPlan({
      planId: created.id,
      runner: reviewRunner,
      db,
    });
    expect(reviewed.outcome).toBe('insufficient-evidence');
    expect(db.prepare('SELECT status FROM improvement_plans WHERE id = ?').get(created.id))
      .toEqual({ status: 'reviewed' });
    expect(db.prepare('SELECT outcome FROM improvement_reviews WHERE plan_id = ?').get(created.id))
      .toEqual({ outcome: 'insufficient-evidence' });
    db.close();
  });
});
