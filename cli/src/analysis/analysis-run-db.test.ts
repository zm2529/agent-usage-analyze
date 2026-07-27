import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runMigrations } from '../db/migrate.js';
import { listAnalysisRuns, recordAnalysisRun, recordAnalysisRunWithRetry } from './analysis-run-db.js';

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

  it('retries an immutable ledger insert after another writer releases SQLite', async () => {
    const root = mkdtempSync(join(tmpdir(), 'analysis-run-retry-'));
    const path = join(root, 'data.db');
    const db = new Database(path);
    runMigrations(db);
    db.pragma('busy_timeout = 1');
    const writer = new Database(path);
    writer.exec('BEGIN IMMEDIATE');
    const release = setTimeout(() => writer.exec('ROLLBACK'), 15);

    await expect(recordAnalysisRunWithRetry({
      analysisType: 'behavior_report', status: 'completed', promptVersion: 'behavior-report-v1',
      inputSummary: { sessions: 12 },
    }, db, { attempts: 4, delayMs: 10 })).resolves.toMatch(/^analysis-run:/);

    clearTimeout(release);
    writer.close();
    db.close();
    rmSync(root, { recursive: true, force: true });
  });
});
