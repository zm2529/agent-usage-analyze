import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../db/migrate.js';
import {
  queryAdvisories,
  readAdvisoryHistory,
  recordAdvisoryEvent,
  setAdvisoryMute,
} from './advisory.js';
import { runSemanticAnalysis, type SemanticProvider } from './semantic-analysis.js';

let db: Database.Database;

beforeEach(() => {
  db = new Database(':memory:');
  runMigrations(db);
  db.exec(`
    INSERT INTO observation_eras
      (id, name, mode, parser_version, capabilities_json, starts_at)
    VALUES
      ('era:one', 'fixture', 'continuous-observation', 'fixture-v1', '[]',
       '2026-07-21T00:00:00.000Z');
    INSERT INTO work_tasks
      (id, root_task_id, thread_id, role, status, started_at, ended_at, era_id)
    VALUES
      ('task:one', 'task:one', 'thread:one', 'root', 'active',
       '2026-07-21T00:00:00.000Z', NULL, 'era:one');
    INSERT INTO source_artifacts
      (id, source_kind, parser_version, locator_hash, observed_at, era_id)
    VALUES
      ('source:one', 'synthetic-codex', 'fixture-v1', 'sha256:source',
       '2026-07-21T00:00:00.000Z', 'era:one');
    INSERT INTO canonical_events
      (id, source_artifact_id, era_id, native_event_id, sequence, occurred_at, kind,
       actor, sensitivity, payload_json, task_id, thread_id, parser_version)
    VALUES
      ('event:missing-validation', 'source:one', 'era:one', 'event-native', 1,
       '2026-07-21T00:03:00.000Z', 'task-completed', 'system', 'structural',
       '{"status":"completed"}', 'task:one', 'thread:one', 'fixture-v1');
    INSERT INTO evidence_records
      (id, evidence_type, subject_ref, position, source_category, algorithm_version,
       coverage, confidence, era_compatibility, era_ids_json, human_status, fact_refs_json)
    VALUES
      ('evidence:validation', 'canonical-event-observation', 'pattern:validation-missing',
       'supports', 'deterministic', 'deterministic-patterns-v1', 1, 0.9, 'compatible',
       '["era:one"]', 'unreviewed',
       '[{"eventId":"event:missing-validation","taskId":"task:one"}]');
    INSERT INTO analysis_claims
      (id, pattern_key, source_category, algorithm_version, window_start, window_end,
       sample_count, total_task_count, coverage, confidence, era_compatibility,
       sample_task_refs_json, evidence_refs_json)
    VALUES
      ('claim:validation', 'validation-missing', 'deterministic',
       'deterministic-patterns-v1', '2026-07-14T00:00:00.000Z',
       '2026-07-21T00:00:00.000Z', 1, 1, 1, 0.9, 'compatible',
       '["task:one"]', '["evidence:validation"]');
  `);
});

afterEach(() => db.close());

describe('queryAdvisories', () => {
  it('returns one evidence-linked suggestion through a read-only task query', () => {
    const before = db.prepare('SELECT total_changes() AS changes').get() as { changes: number };

    const result = queryAdvisories(db, {
      taskId: 'task:one', now: '2026-07-21T00:05:00.000Z', limit: 1,
    });

    expect(result).toEqual({
      status: 'ok', taskId: 'task:one', suggestions: [{
        issueKey: 'pattern:validation-missing',
        sourceCategory: 'deterministic',
        triggerFact: 'A completed task changed files without an observed validation tool call.',
        expectedBenefit: 'Earlier validation may shorten the feedback loop and expose rework sooner.',
        confidence: 0.9,
        coverage: 1,
        evidenceRefs: ['event:missing-validation'],
        verification: 'Run the smallest relevant validation and compare the next similar task.',
        muted: false,
      }],
      diagnostics: [],
    });
    expect(db.prepare('SELECT total_changes() AS changes').get()).toEqual(before);
  });

  it('turns a waiting pattern into a neutral reminder instead of an ability judgment', () => {
    db.prepare(`UPDATE analysis_claims SET pattern_key = 'waiting' WHERE id = 'claim:validation'`).run();

    expect(queryAdvisories(db, {
      taskId: 'task:one', now: '2026-07-21T00:05:00.000Z', limit: 1,
    }).suggestions).toMatchObject([{
      issueKey: 'pattern:waiting',
      triggerFact: 'A linked tool call and result were at least 60 seconds apart.',
      expectedBenefit: 'A narrower or staged operation may make the next feedback point arrive sooner.',
      verification: 'Compare tool wait time in the next similar task.',
    }]);
  });

  it('suppresses a repeated issue during its per-task cooldown and returns it afterwards', () => {
    recordAdvisoryEvent(db, {
      issueKey: 'pattern:validation-missing', taskId: 'task:one', action: 'shown',
      observationEraId: 'era:one', coverage: 1,
      evidenceRefs: ['event:missing-validation'], occurredAt: '2026-07-21T00:05:00.000Z',
    });

    expect(queryAdvisories(db, {
      taskId: 'task:one', now: '2026-07-22T00:05:00.000Z', cooldownMs: 7 * 86_400_000,
    }).suggestions).toEqual([]);
    expect(queryAdvisories(db, {
      taskId: 'task:one', now: '2026-07-29T00:05:00.001Z', cooldownMs: 7 * 86_400_000,
    }).suggestions.map((item) => item.issueKey)).toEqual(['pattern:validation-missing']);
  });

  it('hides muted categories from hooks while exposing their state to the Advice UI', () => {
    setAdvisoryMute(db, {
      scopeKind: 'category', scopeKey: 'deterministic',
      mutedUntil: '2026-07-28T00:00:00.000Z', now: '2026-07-21T00:00:00.000Z',
    });

    expect(queryAdvisories(db, {
      taskId: 'task:one', now: '2026-07-22T00:00:00.000Z',
    }).suggestions).toEqual([]);
    expect(queryAdvisories(db, {
      taskId: 'task:one', now: '2026-07-22T00:00:00.000Z', includeMuted: true,
    }).suggestions).toMatchObject([{ issueKey: 'pattern:validation-missing', muted: true }]);
  });

  it('deduplicates accepted semantic advice into one stable evidence-closed issue', async () => {
    db.exec(`
      DELETE FROM analysis_claims;
      DELETE FROM evidence_records;
      UPDATE canonical_events SET kind = 'user-message', actor = 'user', turn_id = 'turn:one'
        WHERE id = 'event:missing-validation';
      INSERT INTO source_ingestion_stats
        (source_artifact_id, discovered_count, parsed_count, skipped_count, failed_count, unknown_count)
      VALUES ('source:one', 1, 1, 0, 0, 0);
    `);
    const content = JSON.stringify({
      schemaVersion: 'agent-analytics.semantic-output.v1',
      claims: [{
        claimType: 'improvement-advice', title: 'Validate early',
        summary: 'Validation was observed late.',
        expectedBenefit: 'Shorter feedback loops may reduce rework.',
        verification: 'Compare the next similar task.', confidence: 0.9,
        evidenceRefs: ['event:missing-validation'],
      }],
    });
    const provider: SemanticProvider = {
      provider: 'fixture', model: 'fixture-v1', locality: 'local',
      estimateTokens: () => 20,
      analyze: async () => ({ content, usage: { inputTokens: 20, outputTokens: 4, costUsd: 0 } }),
    };
    for (let run = 0; run < 2; run += 1) {
      await runSemanticAnalysis(db, {
        taskId: 'task:one',
        config: { enabled: true, provider: 'fixture', model: 'fixture-v1', locality: 'local' },
        resolvePayload: async () => 'safe evidence', provider,
      });
    }

    const first = queryAdvisories(db, {
      taskId: 'task:one', now: '2026-07-21T00:05:00.000Z', limit: 3,
    });
    const second = queryAdvisories(db, {
      taskId: 'task:one', now: '2026-07-21T00:06:00.000Z', limit: 3,
    });

    expect(first.suggestions).toHaveLength(1);
    expect(first.suggestions[0]).toMatchObject({
      issueKey: expect.stringMatching(/^semantic:sha256:[a-f0-9]{64}$/),
      sourceCategory: 'llm-semantic',
      triggerFact: 'Validation was observed late.',
      expectedBenefit: 'Shorter feedback loops may reduce rework.',
      confidence: 0.9,
      coverage: 1,
      evidenceRefs: ['event:missing-validation'],
      verification: 'Compare the next similar task.',
    });
    expect(second.suggestions[0]?.issueKey).toBe(first.suggestions[0]?.issueKey);
  });

  it('keeps interaction and follow-up events independent and labels comparisons non-causal', () => {
    db.prepare(`INSERT INTO observation_eras
      (id, name, mode, parser_version, capabilities_json, starts_at)
      VALUES ('era:two', 'follow-up', 'continuous-observation', 'fixture-v2', '[]',
        '2026-07-28T00:00:00.000Z')`).run();
    db.exec(`
      INSERT INTO work_tasks
        (id, root_task_id, thread_id, role, status, started_at, ended_at, era_id)
      VALUES ('task:two', 'task:two', 'thread:two', 'root', 'completed',
        '2026-07-28T00:00:00.000Z', '2026-07-29T00:00:00.000Z', 'era:two');
      INSERT INTO source_artifacts
        (id, source_kind, parser_version, locator_hash, observed_at, era_id)
      VALUES ('source:two', 'synthetic-codex', 'fixture-v2', 'sha256:source-two',
        '2026-07-29T00:00:00.000Z', 'era:two');
      INSERT INTO canonical_events
        (id, source_artifact_id, era_id, native_event_id, sequence, occurred_at, kind,
         actor, sensitivity, payload_json, task_id, thread_id, parser_version)
      VALUES ('event:followup-validation', 'source:two', 'era:two', 'event-followup', 1,
        '2026-07-29T00:00:00.000Z', 'task-completed', 'system', 'structural',
        '{"status":"completed"}', 'task:two', 'thread:two', 'fixture-v2');
    `);
    const first = recordAdvisoryEvent(db, {
      issueKey: 'pattern:validation-missing', taskId: 'task:one', action: 'shown',
      observationEraId: 'era:one', coverage: 1, evidenceRefs: ['event:missing-validation'],
      occurredAt: '2026-07-21T00:05:00.000Z',
    });
    recordAdvisoryEvent(db, {
      interventionId: first.interventionId,
      issueKey: 'pattern:validation-missing', taskId: 'task:one', action: 'adopted',
      observationEraId: 'era:one', coverage: 1, evidenceRefs: ['event:missing-validation'],
      occurredAt: '2026-07-21T00:06:00.000Z',
    });
    recordAdvisoryEvent(db, {
      interventionId: first.interventionId,
      issueKey: 'pattern:validation-missing', taskId: 'task:two', action: 'outcome',
      outcome: 'improved', observationEraId: 'era:two', coverage: 0.8,
      evidenceRefs: ['event:followup-validation'], occurredAt: '2026-07-29T00:00:00.000Z',
    });
    const second = recordAdvisoryEvent(db, {
      issueKey: 'pattern:validation-missing', taskId: 'task:one', action: 'shown',
      observationEraId: 'era:one', coverage: 0.7, evidenceRefs: ['event:missing-validation'],
      occurredAt: '2026-08-01T00:00:00.000Z',
    });
    recordAdvisoryEvent(db, {
      interventionId: second.interventionId,
      issueKey: 'pattern:validation-missing', taskId: 'task:two', action: 'outcome',
      outcome: 'not-improved', observationEraId: 'era:two', coverage: 0.6,
      evidenceRefs: ['event:followup-validation'], occurredAt: '2026-08-08T00:00:00.000Z',
    });

    const history = readAdvisoryHistory(db, 'task:one');

    expect(history.events.map((event) => [event.action, event.outcome])).toEqual([
      ['outcome', 'not-improved'], ['shown', null],
      ['outcome', 'improved'], ['adopted', null], ['shown', null],
    ]);
    expect(history.comparisons).toEqual([{
      interventionId: first.interventionId,
      issueKey: 'pattern:validation-missing', kind: 'observational-before-after', causal: false,
      baseline: {
        observationEraId: 'era:one', coverage: 1, occurredAt: '2026-07-21T00:05:00.000Z',
      },
      followup: {
        observationEraId: 'era:two', coverage: 0.8, outcome: 'improved',
        occurredAt: '2026-07-29T00:00:00.000Z',
      },
    }, {
      interventionId: second.interventionId,
      issueKey: 'pattern:validation-missing', kind: 'observational-before-after', causal: false,
      baseline: {
        observationEraId: 'era:one', coverage: 0.7, occurredAt: '2026-08-01T00:00:00.000Z',
      },
      followup: {
        observationEraId: 'era:two', coverage: 0.6, outcome: 'not-improved',
        occurredAt: '2026-08-08T00:00:00.000Z',
      },
    }]);
    expect(() => db.prepare(`UPDATE advisory_events SET coverage = 0 WHERE action = 'shown'`).run())
      .toThrow(/immutable/);
  });

  it('rejects advisory events whose evidence does not belong to the analyzed task', () => {
    expect(() => recordAdvisoryEvent(db, {
      issueKey: 'pattern:validation-missing', taskId: 'task:one', action: 'shown',
      observationEraId: 'era:one', coverage: 1, evidenceRefs: ['event:missing'],
      occurredAt: '2026-07-21T00:05:00.000Z',
    })).toThrow(/evidence/i);
    expect(db.prepare('SELECT COUNT(*) AS count FROM advisory_events').get()).toEqual({ count: 0 });
  });
});
