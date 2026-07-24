import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { runMigrations } from '../db/migrate.js';
import { listAnalysisRuns, recordAnalysisRun } from './analysis-run-db.js';

describe('analysis run ledger', () => {
  it('stores exact local prompts and immutable run metadata', () => {
    const db = new Database(':memory:');
    runMigrations(db);
    recordAnalysisRun({
      analysisType: 'behavior_report', status: 'completed', promptVersion: 'behavior-report-v1',
      provider: 'codex-native', model: 'codex-default', systemPrompt: 'system', inputPrompt: 'input',
      inputSummary: { sessions: 12, coverage: 0.9 }, outputJson: '{"profile":"orchestrator"}',
      inputTokens: 100, outputTokens: 50, durationMs: 25,
    }, db);

    expect(listAnalysisRuns({}, db)[0]).toMatchObject({
      analysisType: 'behavior_report', status: 'completed', systemPrompt: 'system',
      inputPrompt: 'input', inputSummary: { sessions: 12, coverage: 0.9 },
    });
    const id = listAnalysisRuns({}, db)[0]!.id;
    expect(() => db.prepare('UPDATE analysis_runs SET status = ? WHERE id = ?').run('failed', id))
      .toThrow(/immutable/i);
    db.close();
  });
});
