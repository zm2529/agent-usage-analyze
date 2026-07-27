import Database from 'better-sqlite3';
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
      return response(JSON.stringify({
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
      }));
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
});
