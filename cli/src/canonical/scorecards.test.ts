import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { runMigrations } from '../db/migrate.js';
import {
  createScorecardVersion,
  evaluateScorecard,
  listScorecardResults,
  listScorecardVersions,
  transitionScorecardVersion,
} from './scorecards.js';
import { readObserverOverhead, recordObserverOverhead } from './observer-overhead.js';

function freshDb(): Database.Database {
  const db = new Database(':memory:');
  runMigrations(db);
  db.prepare(`INSERT INTO observation_eras
    (id, name, mode, parser_version, capabilities_json, starts_at)
    VALUES ('era:scorecard', 'scorecard fixture', 'continuous-observation', 'fixture-v1', '[]',
      '2026-07-21T00:00:00.000Z')`).run();
  const insertTask = db.prepare(`INSERT INTO work_tasks
    (id, root_task_id, thread_id, role, status, started_at, ended_at, era_id)
    VALUES (?, ?, ?, ?, 'completed', '2026-07-21T00:00:00.000Z',
      '2026-07-21T00:10:00.000Z', 'era:scorecard')`);
  for (const id of ['task:one', 'task:two', 'task:three', 'task:quality', 'task:missing',
    'task:safety', 'task:coverage', 'task:shared']) insertTask.run(id, id, id, 'root');
  insertTask.run('task:worker', 'task:one', 'thread:worker', 'worker');
  return db;
}

const DEFINITION = {
  name: 'Personal delivery evidence',
  version: '2026.07.21-a',
  features: [
    { key: 'deliveryEvidence', label: 'Delivery evidence', weight: 0.7, requiresQualityGate: false },
    { key: 'tokenEfficiencyAfterQuality', label: 'Token efficiency after quality', weight: 0.3, requiresQualityGate: true },
  ],
  qualityGates: ['delivery-observed', 'validation-observed'],
  safetyGates: ['no-unsafe-attribution'],
  missingRules: {
    deliveryEvidence: 'unavailable' as const,
    tokenEfficiencyAfterQuality: 'unavailable' as const,
  },
  thresholds: { minimumCoverage: 0.8 },
  calibrationDataVersion: 'calibration:fixture-v1',
  scope: { kind: 'personal' as const },
  evidenceRefs: ['evidence:scorecard-design'],
};

describe('scorecard versions and results', () => {
  it('keeps draft and calibrating versions diagnostic-only, then produces an index only when active and gated', () => {
    const db = freshDb();
    const version = createScorecardVersion(db, DEFINITION);

    const draft = evaluateScorecard(db, {
      taskId: 'task:one', scorecardVersionId: version.id,
      rawFeatures: { deliveryEvidence: 0.9, tokenEfficiencyAfterQuality: 0.6 },
      gateResults: { quality: true, safety: true, calibration: true },
      coverage: 0.9, uncertainty: 0.1, evidenceRefs: ['evidence:task-one'],
    });
    expect(draft).toMatchObject({ indexValue: null, unavailableReason: 'scorecard-not-active' });

    transitionScorecardVersion(db, version.id, 'calibrating', ['evidence:calibration-start']);
    const calibrating = evaluateScorecard(db, {
      taskId: 'task:two', scorecardVersionId: version.id,
      rawFeatures: { deliveryEvidence: 0.9, tokenEfficiencyAfterQuality: 0.6 },
      gateResults: { quality: true, safety: true, calibration: true },
      coverage: 0.9, uncertainty: 0.1, evidenceRefs: ['evidence:task-two'],
    });
    expect(calibrating).toMatchObject({ indexValue: null, unavailableReason: 'scorecard-not-active' });

    transitionScorecardVersion(db, version.id, 'active', ['evidence:calibration-pass']);
    const active = evaluateScorecard(db, {
      taskId: 'task:three', scorecardVersionId: version.id,
      rawFeatures: { deliveryEvidence: 0.9, tokenEfficiencyAfterQuality: 0.6 },
      gateResults: { quality: true, safety: true, calibration: true },
      coverage: 0.9, uncertainty: 0.1, evidenceRefs: ['evidence:task-three'],
    });
    expect(active.indexValue).toBeCloseTo(81);
    expect(active.unavailableReason).toBeNull();
    db.close();
  });

  it('stores gate failures and missing features as explainable unavailable results', () => {
    const db = freshDb();
    const version = createScorecardVersion(db, DEFINITION);
    transitionScorecardVersion(db, version.id, 'calibrating', ['evidence:start']);
    transitionScorecardVersion(db, version.id, 'active', ['evidence:pass']);

    const qualityFailure = evaluateScorecard(db, {
      taskId: 'task:quality', scorecardVersionId: version.id,
      rawFeatures: { deliveryEvidence: 0.8, tokenEfficiencyAfterQuality: 1 },
      gateResults: { quality: false, safety: true, calibration: true },
      coverage: 1, uncertainty: 0.2, evidenceRefs: ['evidence:quality'],
    });
    const missing = evaluateScorecard(db, {
      taskId: 'task:missing', scorecardVersionId: version.id,
      rawFeatures: { deliveryEvidence: 0.8, tokenEfficiencyAfterQuality: null },
      gateResults: { quality: true, safety: true, calibration: true },
      coverage: 1, uncertainty: 0.2, evidenceRefs: ['evidence:missing'],
    });

    const safetyFailure = evaluateScorecard(db, {
      taskId: 'task:safety', scorecardVersionId: version.id,
      rawFeatures: { deliveryEvidence: 0.8, tokenEfficiencyAfterQuality: 0.5 },
      gateResults: { quality: true, safety: false, calibration: true },
      coverage: 1, uncertainty: 0.2, evidenceRefs: ['evidence:safety'],
    });
    const insufficientCoverage = evaluateScorecard(db, {
      taskId: 'task:coverage', scorecardVersionId: version.id,
      rawFeatures: { deliveryEvidence: 0.8, tokenEfficiencyAfterQuality: 0.5 },
      gateResults: { quality: true, safety: true, calibration: true },
      coverage: 0.79, uncertainty: 0.2, evidenceRefs: ['evidence:coverage'],
    });

    expect(qualityFailure).toMatchObject({ indexValue: null, unavailableReason: 'quality-gate-failed' });
    expect(missing).toMatchObject({ indexValue: null, unavailableReason: 'missing-feature' });
    expect(safetyFailure).toMatchObject({ indexValue: null, unavailableReason: 'safety-gate-failed' });
    expect(insufficientCoverage).toMatchObject({ indexValue: null, unavailableReason: 'insufficient-coverage' });
    expect(listScorecardResults(db)).toEqual(expect.arrayContaining([
      expect.objectContaining({ taskId: 'task:quality', rawFeatures: expect.any(Object), evidenceRefs: ['evidence:quality'] }),
      expect.objectContaining({ taskId: 'task:missing', unavailableReason: 'missing-feature' }),
    ]));
    db.close();
  });

  it('keeps immutable old and recomputed-new results side by side', () => {
    const db = freshDb();
    const oldVersion = createScorecardVersion(db, DEFINITION);
    const newVersion = createScorecardVersion(db, {
      ...DEFINITION,
      version: '2026.07.21-b',
      thresholds: { minimumCoverage: 0.9 },
    });
    for (const version of [oldVersion, newVersion]) {
      transitionScorecardVersion(db, version.id, 'calibrating', ['evidence:start']);
      transitionScorecardVersion(db, version.id, 'active', ['evidence:pass']);
      evaluateScorecard(db, {
        taskId: 'task:shared', scorecardVersionId: version.id,
        rawFeatures: { deliveryEvidence: 0.8, tokenEfficiencyAfterQuality: 0.5 },
        gateResults: { quality: true, safety: true, calibration: true },
        coverage: 1, uncertainty: 0.1, evidenceRefs: [`evidence:${version.version}`],
      });
    }

    expect(listScorecardResults(db, 'task:shared')).toHaveLength(2);
    expect(() => db.prepare("UPDATE scorecard_versions SET name = 'mutated'").run()).toThrow(/immutable/i);
    expect(() => db.prepare('UPDATE scorecard_results SET index_value = 100').run()).toThrow(/immutable/i);
    db.close();
  });

  it('rejects invalid transitions and misleading proxy features', () => {
    const db = freshDb();
    const version = createScorecardVersion(db, DEFINITION);
    expect(() => transitionScorecardVersion(db, version.id, 'active', ['evidence:skip']))
      .toThrow(/transition/i);
    expect(() => createScorecardVersion(db, {
      ...DEFINITION, version: 'bad-ai-lines',
      features: [{ key: 'aiLineRatio', label: 'AI lines', weight: 1, requiresQualityGate: false }],
      missingRules: { aiLineRatio: 'unavailable' },
    })).toThrow(/approved scorecard feature/i);
    expect(() => createScorecardVersion(db, {
      ...DEFINITION, version: 'bad-token-count',
      features: [{ key: 'tokenCount', label: 'Token count', weight: 1, requiresQualityGate: true }],
      missingRules: { tokenCount: 'unavailable' },
    })).toThrow(/approved scorecard feature/i);
    expect(() => createScorecardVersion(db, {
      ...DEFINITION, version: 'bad-normal-end',
      features: [{ key: 'normalEndRate', label: 'Normal end', weight: 1, requiresQualityGate: false }],
      missingRules: { normalEndRate: 'unavailable' },
    })).toThrow(/approved scorecard feature/i);
    for (const feature of [
      { key: 'efficiency', label: 'Fewer tokens is better' },
      { key: 'authorshipShare', label: 'Percentage of code written by the model' },
      { key: 'cleanCompletionRate', label: 'Clean completion rate' },
    ]) {
      expect(() => createScorecardVersion(db, {
        ...DEFINITION, version: `bad-${feature.key}`,
        features: [{ ...feature, weight: 1, requiresQualityGate: false }],
        missingRules: { [feature.key]: 'unavailable' },
      })).toThrow(/approved scorecard feature/i);
    }
    db.close();
  });

  it('fails closed when the analyzed task is missing or outside the version scope', () => {
    const db = freshDb();
    const version = createScorecardVersion(db, {
      ...DEFINITION, version: 'worker-only', scope: { kind: 'personal', taskRole: 'worker' },
    });
    transitionScorecardVersion(db, version.id, 'calibrating', ['evidence:start']);
    transitionScorecardVersion(db, version.id, 'active', ['evidence:pass']);
    const input = {
      scorecardVersionId: version.id,
      rawFeatures: { deliveryEvidence: 0.9, tokenEfficiencyAfterQuality: 0.9 },
      gateResults: { quality: true, safety: true, calibration: true },
      coverage: 1, uncertainty: 0.1, evidenceRefs: ['evidence:scope'],
    };
    expect(evaluateScorecard(db, { ...input, taskId: 'task:one' }))
      .toMatchObject({ indexValue: null, unavailableReason: 'out-of-scope' });
    expect(evaluateScorecard(db, { ...input, taskId: 'task:missing-subject' }))
      .toMatchObject({ indexValue: null, unavailableReason: 'task-not-found' });
    expect(evaluateScorecard(db, { ...input, taskId: 'task:worker' }))
      .toMatchObject({ indexValue: 90, unavailableReason: null });
    db.close();
  });

  it('retires an active version without changing its immutable definition', () => {
    const db = freshDb();
    const version = createScorecardVersion(db, DEFINITION);
    transitionScorecardVersion(db, version.id, 'calibrating', ['evidence:start']);
    transitionScorecardVersion(db, version.id, 'active', ['evidence:pass']);
    transitionScorecardVersion(db, version.id, 'retired', ['evidence:replacement']);
    expect(listScorecardVersions(db)[0]).toMatchObject({ status: 'retired', version: DEFINITION.version });
    db.close();
  });
});

describe('observer overhead', () => {
  it('records import, LLM, sidecar, and advisory overhead in an observer-only ledger', () => {
    const db = freshDb();
    recordObserverOverhead(db, {
      category: 'import', observerRunId: 'ingestion:one', analyzedTaskId: 'task:one',
      cpuMs: 12, wallMs: 20, dbBytesDelta: 4096, evidenceRefs: ['ingestion:one'],
    });
    recordObserverOverhead(db, {
      category: 'llm', observerRunId: 'semantic:one', analyzedTaskId: 'task:one',
      wallMs: 100, inputTokens: 500, outputTokens: 50, costUsd: null,
      evidenceRefs: ['semantic:one'],
    });
    recordObserverOverhead(db, {
      category: 'sidecar', observerRunId: 'git-ai:one', sidecarMs: 35,
      evidenceRefs: ['git-ai:one'],
    });
    recordObserverOverhead(db, {
      category: 'advisory', observerRunId: 'advice:one', advisoryAction: 'shown',
      evidenceRefs: ['advice:one'],
    });

    expect(readObserverOverhead(db)).toMatchObject({
      eventCount: 4,
      totals: { cpuMs: 12, wallMs: 120, dbBytesDelta: 4096, inputTokens: 500, outputTokens: 50, costUsd: null, sidecarMs: 35 },
      advisory: { shown: 1, adopted: 0, ignored: 0, dismissed: 0 },
      byCategory: expect.arrayContaining([expect.objectContaining({ category: 'llm', eventCount: 1 })]),
    });
    const row = db.prepare('SELECT subject_kind AS subjectKind FROM observer_overhead_events LIMIT 1').get();
    expect(row).toEqual({ subjectKind: 'observer' });
    expect(() => db.prepare('UPDATE observer_overhead_events SET wall_ms = 0').run()).toThrow(/immutable/i);
    db.close();
  });

  it('rejects negative metrics and analyzed-task token fields', () => {
    const db = freshDb();
    expect(() => recordObserverOverhead(db, {
      category: 'import', observerRunId: 'bad', wallMs: -1, evidenceRefs: ['bad'],
    })).toThrow(/non-negative/i);
    expect(() => recordObserverOverhead(db, {
      category: 'llm', observerRunId: 'bad-task', evidenceRefs: ['bad'],
      taskInputTokens: 20,
    } as never)).toThrow(/unsupported field/i);
    expect(() => recordObserverOverhead(db, {
      category: 'import', observerRunId: 'bad-category', inputTokens: 20,
      evidenceRefs: ['bad-category'],
    } as never)).toThrow(/import overhead contains unsupported field/i);
    db.close();
  });

  it('preserves unknown LLM token usage instead of reporting zero', () => {
    const db = freshDb();
    recordObserverOverhead(db, {
      category: 'llm', observerRunId: 'semantic:unknown', costUsd: null,
      evidenceRefs: ['semantic:unknown'],
    });
    expect(readObserverOverhead(db).totals).toMatchObject({
      inputTokens: null, outputTokens: null, costUsd: null,
    });
    db.close();
  });
});
