import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { runMigrations } from '../db/migrate.js';
import type { AnalysisRunner } from './runner-types.js';
import {
  assertPublicHttpUrl,
  assertSafeResearchLabel,
  isWeeklyKnowledgeRefreshDue,
  runKnowledgeResearch,
} from './knowledge-research.js';

function response(rawJson: string) {
  return {
    rawJson,
    durationMs: 10,
    inputTokens: 20,
    outputTokens: 30,
    model: 'test-model',
    provider: 'test-provider',
  };
}

function researchOutput() {
  return {
    snapshotTitle: 'Current evidence-supported delegation practices',
    summary: 'Official and corroborated community guidance.',
    practices: [{
      title: 'Define delegation boundaries',
      summary: 'State task ownership and completion evidence.',
      applicability: 'Multi-agent implementation work',
      sourceTrust: 'high',
      discussionBreadth: 'medium',
      recency: 'Current as of 2026-07-27',
      localRelevance: 'high',
      localEffectStatus: 'not-reviewed',
      rationale: 'Multiple independent sources describe the same boundary.',
      tags: ['delegation'],
      sourceRefs: [{
        url: 'https://example.com/current-guidance',
        title: 'Current guidance',
        sourceType: 'community',
        publishedAt: '2026-07-01',
        fetchedAt: '2026-07-27',
        author: 'Example author',
        independentEvidence: 'Corroborated by two independent maintainers.',
        discussionEvidence: 'Several detailed implementation reports.',
      }],
      conflicts: [],
    }],
  };
}

describe('knowledge research', () => {
  it('sends only LLM-redacted labels to public research and persists a versioned source chain', async () => {
    const db = new Database(':memory:');
    runMigrations(db);
    const labelRun = vi.fn(async () => response(JSON.stringify({
      safe: true,
      labels: ['coding-agent task delegation boundaries'],
      redactions: ['local project identity'],
    })));
    const researchRun = vi.fn(async ({ userPrompt }: { userPrompt: string }) => {
      expect(userPrompt).toContain('coding-agent task delegation boundaries');
      expect(userPrompt).not.toContain('PrivateRocket');
      return response(JSON.stringify(researchOutput()));
    });

    const snapshot = await runKnowledgeResearch({
      scope: 'weekly',
      rawTopics: ['PrivateRocket repository delegation logs'],
      labelRunner: { name: 'label', runAnalysis: labelRun } as AnalysisRunner,
      researchRunner: { name: 'research', runAnalysis: researchRun } as AnalysisRunner,
      db,
    });

    expect(snapshot).toMatchObject({ scope: 'weekly', sourceCount: 1, practiceCount: 1 });
    expect(labelRun).toHaveBeenCalledOnce();
    expect(researchRun).toHaveBeenCalledOnce();
    expect(db.prepare('SELECT COUNT(*) AS count FROM knowledge_practices').get())
      .toEqual({ count: 1 });
    expect(db.prepare(`SELECT COUNT(*) AS count FROM analysis_runs
      WHERE analysis_type IN ('knowledge_topic_redaction', 'knowledge_research')`).get())
      .toEqual({ count: 2 });
    expect(isWeeklyKnowledgeRefreshDue(db, new Date('2026-07-28T00:00:00Z'))).toBe(false);
    db.close();
  });

  it('rejects private sources and sensitive labels at the deterministic gate', () => {
    expect(() => assertPublicHttpUrl('http://127.0.0.1:3000/private')).toThrow(/public/i);
    expect(() => assertPublicHttpUrl('file:///Users/example/private')).toThrow(/public/i);
    expect(() => assertSafeResearchLabel('/Users/example/PrivateRocket logs')).toThrow(/privacy/i);
    expect(() => assertSafeResearchLabel('coding agent task planning')).not.toThrow();
  });

  it('retries only final persistence when another writer briefly owns SQLite', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'agent-knowledge-retry-'));
    const dbPath = join(dir, 'data.db');
    const db = new Database(dbPath);
    const blocker = new Database(dbPath);
    try {
      runMigrations(db);
      db.pragma('journal_mode = WAL');
      db.pragma('busy_timeout = 1');
      blocker.pragma('journal_mode = WAL');
      blocker.pragma('busy_timeout = 0');
      const labelRun = vi.fn(async () => response(JSON.stringify({
        safe: true,
        labels: ['coding-agent task delegation boundaries'],
        redactions: [],
      })));
      const researchRun = vi.fn(async () => {
        blocker.exec('BEGIN IMMEDIATE');
        setTimeout(() => {
          if (blocker.inTransaction) blocker.exec('COMMIT');
        }, 20);
        return response(JSON.stringify(researchOutput()));
      });

      await expect(runKnowledgeResearch({
        scope: 'weekly',
        rawTopics: ['task delegation'],
        labelRunner: { name: 'label', runAnalysis: labelRun } as AnalysisRunner,
        researchRunner: { name: 'research', runAnalysis: researchRun } as AnalysisRunner,
        db,
      })).resolves.toMatchObject({ practiceCount: 1 });

      expect(labelRun).toHaveBeenCalledOnce();
      expect(researchRun).toHaveBeenCalledOnce();
      expect(db.prepare(`SELECT analysis_type, COUNT(*) AS count FROM analysis_runs
        GROUP BY analysis_type ORDER BY analysis_type`).all()).toEqual([
        { analysis_type: 'knowledge_research', count: 1 },
        { analysis_type: 'knowledge_topic_redaction', count: 1 },
      ]);
      expect(db.prepare('SELECT COUNT(*) AS count FROM knowledge_snapshots').get())
        .toEqual({ count: 1 });
    } finally {
      if (blocker.inTransaction) blocker.exec('ROLLBACK');
      blocker.close();
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('preserves the provider error when writing its failure record is locked', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'agent-knowledge-error-'));
    const dbPath = join(dir, 'data.db');
    const db = new Database(dbPath);
    const blocker = new Database(dbPath);
    try {
      runMigrations(db);
      db.pragma('journal_mode = WAL');
      db.pragma('busy_timeout = 1');
      blocker.pragma('journal_mode = WAL');
      blocker.pragma('busy_timeout = 0');
      blocker.exec('BEGIN IMMEDIATE');
      const providerError = new Error('topic provider unavailable');
      const labelRun = vi.fn(async () => { throw providerError; });

      await expect(runKnowledgeResearch({
        scope: 'weekly',
        rawTopics: ['task delegation'],
        labelRunner: { name: 'label', runAnalysis: labelRun } as AnalysisRunner,
        db,
      })).rejects.toThrow('topic provider unavailable');

      expect(labelRun).toHaveBeenCalledOnce();
      expect(db.prepare('SELECT COUNT(*) AS count FROM analysis_runs').get())
        .toEqual({ count: 0 });
    } finally {
      if (blocker.inTransaction) blocker.exec('ROLLBACK');
      blocker.close();
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
