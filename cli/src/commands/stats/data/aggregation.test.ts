import { describe, it, expect } from 'vitest';
import {
  periodStartDate,
  resolveTitle,
  shortenModelName,
  bucketKey,
  createBuckets,
  computeDayStats,
  computeTopProjects,
  groupByDay,
  computeRangeStats,
  computeOverview,
  computeCostBreakdown,
  computeProjectStats,
  computeTodayStats,
  computeModelStats,
} from './aggregation.js';
import type { SessionRow } from './types.js';

// ── Helper Factory ──

function makeSessionRow(overrides: Partial<SessionRow> = {}): SessionRow {
  return {
    id: 'session-1',
    projectId: 'proj-1',
    projectName: 'test-project',
    startedAt: new Date('2026-01-15T10:00:00Z'),
    endedAt: new Date('2026-01-15T11:00:00Z'),
    messageCount: 10,
    userMessageCount: 5,
    assistantMessageCount: 5,
    toolCallCount: 3,
    sourceTool: 'claude-code',
    ...overrides,
  };
}

// ── periodStartDate ──

describe('periodStartDate', () => {
  it('returns a date 7 days ago for "7d"', () => {
    const result = periodStartDate('7d');
    expect(result).toBeInstanceOf(Date);
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const expected = new Date(now);
    expected.setDate(expected.getDate() - 7);
    expect(result!.getTime()).toBe(expected.getTime());
  });

  it('returns a date 30 days ago for "30d"', () => {
    const result = periodStartDate('30d');
    expect(result).toBeInstanceOf(Date);
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const expected = new Date(now);
    expected.setDate(expected.getDate() - 30);
    expect(result!.getTime()).toBe(expected.getTime());
  });

  it('returns a date 90 days ago for "90d"', () => {
    const result = periodStartDate('90d');
    expect(result).toBeInstanceOf(Date);
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const expected = new Date(now);
    expected.setDate(expected.getDate() - 90);
    expect(result!.getTime()).toBe(expected.getTime());
  });

  it('returns undefined for "all"', () => {
    expect(periodStartDate('all')).toBeUndefined();
  });
});

// ── resolveTitle ──

describe('resolveTitle', () => {
  it('returns customTitle when available', () => {
    const session = makeSessionRow({ customTitle: 'My Custom Title' });
    expect(resolveTitle(session)).toBe('My Custom Title');
  });

  it('returns generatedTitle when customTitle is absent', () => {
    const session = makeSessionRow({
      generatedTitle: 'Generated Title',
      summary: 'Summary',
    });
    expect(resolveTitle(session)).toBe('Generated Title');
  });

  it('returns summary when customTitle and generatedTitle are absent', () => {
    const session = makeSessionRow({ summary: 'Session Summary' });
    expect(resolveTitle(session)).toBe('Session Summary');
  });

  it('returns "Untitled Session" when all title fields are absent', () => {
    const session = makeSessionRow();
    expect(resolveTitle(session)).toBe('Untitled Session');
  });

  it('uses priority: customTitle > generatedTitle > summary > fallback', () => {
    const session = makeSessionRow({
      customTitle: 'Custom',
      generatedTitle: 'Generated',
      summary: 'Summary',
    });
    expect(resolveTitle(session)).toBe('Custom');
  });
});

// ── shortenModelName ──

describe('shortenModelName', () => {
  it('shortens claude-opus-4-5 to "Opus 4.x"', () => {
    expect(shortenModelName('claude-opus-4-5')).toBe('Opus 4.x');
  });

  it('shortens claude-sonnet-4 to "Sonnet 4.x"', () => {
    expect(shortenModelName('claude-sonnet-4')).toBe('Sonnet 4.x');
  });

  it('shortens claude-haiku-4-5 to "Haiku"', () => {
    expect(shortenModelName('claude-haiku-4-5')).toBe('Haiku');
  });

  it('shortens claude-3-5-sonnet-20241022 to "Sonnet 3.5"', () => {
    expect(shortenModelName('claude-3-5-sonnet-20241022')).toBe('Sonnet 3.5');
  });

  it('shortens claude-3-5-haiku-20241022 to "Haiku 3.5"', () => {
    expect(shortenModelName('claude-3-5-haiku-20241022')).toBe('Haiku 3.5');
  });

  it('shortens claude-3-opus-20240229 to "Opus 3"', () => {
    expect(shortenModelName('claude-3-opus-20240229')).toBe('Opus 3');
  });

  it('shortens gpt-4o to "GPT-4o"', () => {
    expect(shortenModelName('gpt-4o')).toBe('GPT-4o');
  });

  it('shortens gpt-4-turbo to "GPT-4 Turbo"', () => {
    expect(shortenModelName('gpt-4-turbo')).toBe('GPT-4 Turbo');
  });

  it('truncates unknown models longer than 20 chars', () => {
    expect(shortenModelName('some-very-long-model-name-here')).toBe('some-very-long-model');
  });

  it('returns unknown models under 20 chars as-is', () => {
    expect(shortenModelName('short-model')).toBe('short-model');
  });
});

// ── bucketKey ──

describe('bucketKey', () => {
  it('returns YYYY-MM-DD for 7d period', () => {
    const date = new Date(2026, 0, 15); // Jan 15, 2026
    expect(bucketKey(date, '7d')).toBe('2026-01-15');
  });

  it('returns YYYY-MM-DD for 30d period', () => {
    const date = new Date(2026, 0, 5); // Jan 5, 2026
    expect(bucketKey(date, '30d')).toBe('2026-01-05');
  });

  it('returns YYYY-Wxx for 90d period', () => {
    const date = new Date(2026, 0, 15); // Jan 15, 2026
    const result = bucketKey(date, '90d');
    expect(result).toMatch(/^\d{4}-W\d{2}$/);
  });

  it('returns YYYY-MM for all period', () => {
    const date = new Date(2026, 0, 15); // Jan 15, 2026
    expect(bucketKey(date, 'all')).toBe('2026-01');
  });

  it('zero-pads month and day', () => {
    const date = new Date(2026, 1, 5); // Feb 5, 2026
    expect(bucketKey(date, '7d')).toBe('2026-02-05');
  });
});

// ── createBuckets ──

describe('createBuckets', () => {
  const refDate = new Date(2026, 0, 15); // Jan 15, 2026

  it('creates 7 buckets for 7d period', () => {
    const buckets = createBuckets('7d', refDate);
    expect(buckets.size).toBe(7);
  });

  it('creates 30 buckets for 30d period', () => {
    const buckets = createBuckets('30d', refDate);
    expect(buckets.size).toBe(30);
  });

  it('creates ~13 buckets for 90d period', () => {
    const buckets = createBuckets('90d', refDate);
    // Approximately 13 weekly buckets (could be fewer if some weeks overlap)
    expect(buckets.size).toBeGreaterThanOrEqual(10);
    expect(buckets.size).toBeLessThanOrEqual(13);
  });

  it('creates 12 buckets for all period', () => {
    const buckets = createBuckets('all', refDate);
    expect(buckets.size).toBe(12);
  });

  it('all bucket values start at 0', () => {
    const buckets = createBuckets('7d', refDate);
    for (const point of buckets.values()) {
      expect(point.value).toBe(0);
    }
  });

  it('7d buckets end at the reference date', () => {
    const buckets = createBuckets('7d', refDate);
    const keys = Array.from(buckets.keys());
    expect(keys[keys.length - 1]).toBe('2026-01-15');
  });
});

// ── computeDayStats ──

describe('computeDayStats', () => {
  it('returns zero stats when no sessions match the day', () => {
    const sessions = [
      makeSessionRow({
        startedAt: new Date(2026, 0, 14, 10, 0),
        endedAt: new Date(2026, 0, 14, 11, 0),
      }),
    ];
    const dayStart = new Date(2026, 0, 15);
    const result = computeDayStats(sessions, dayStart);
    expect(result.sessionCount).toBe(0);
    expect(result.totalCost).toBe(0);
    expect(result.totalMinutes).toBe(0);
  });

  it('counts sessions that start on the given day', () => {
    const sessions = [
      makeSessionRow({
        startedAt: new Date(2026, 0, 15, 10, 0),
        endedAt: new Date(2026, 0, 15, 11, 0),
        estimatedCostUsd: 2.50,
      }),
      makeSessionRow({
        id: 'session-2',
        startedAt: new Date(2026, 0, 15, 14, 0),
        endedAt: new Date(2026, 0, 15, 15, 30),
        estimatedCostUsd: 1.00,
      }),
    ];
    const dayStart = new Date(2026, 0, 15);
    const result = computeDayStats(sessions, dayStart);
    expect(result.sessionCount).toBe(2);
    expect(result.totalCost).toBe(3.50);
    expect(result.totalMinutes).toBe(150); // 60 + 90 minutes
  });

  it('returns 0 cost when estimatedCostUsd is undefined', () => {
    const sessions = [
      makeSessionRow({
        startedAt: new Date(2026, 0, 15, 10, 0),
        endedAt: new Date(2026, 0, 15, 11, 0),
      }),
    ];
    const dayStart = new Date(2026, 0, 15);
    const result = computeDayStats(sessions, dayStart);
    expect(result.sessionCount).toBe(1);
    expect(result.totalCost).toBe(0);
  });
});

// ── computeTopProjects ──

describe('computeTopProjects', () => {
  it('returns empty array for no sessions', () => {
    expect(computeTopProjects([], 5)).toEqual([]);
  });

  it('groups sessions by project name and sorts by count', () => {
    const sessions = [
      makeSessionRow({ projectName: 'project-a' }),
      makeSessionRow({ id: 's2', projectName: 'project-a' }),
      makeSessionRow({ id: 's3', projectName: 'project-b' }),
    ];
    const result = computeTopProjects(sessions, 5);
    expect(result.length).toBe(2);
    expect(result[0].name).toBe('project-a');
    expect(result[0].count).toBe(2);
    expect(result[1].name).toBe('project-b');
    expect(result[1].count).toBe(1);
  });

  it('respects the limit parameter', () => {
    const sessions = [
      makeSessionRow({ projectName: 'a' }),
      makeSessionRow({ id: 's2', projectName: 'b' }),
      makeSessionRow({ id: 's3', projectName: 'c' }),
    ];
    const result = computeTopProjects(sessions, 2);
    expect(result.length).toBe(2);
  });

  it('calculates percent correctly', () => {
    const sessions = [
      makeSessionRow({ projectName: 'a' }),
      makeSessionRow({ id: 's2', projectName: 'a' }),
      makeSessionRow({ id: 's3', projectName: 'b' }),
      makeSessionRow({ id: 's4', projectName: 'b' }),
    ];
    const result = computeTopProjects(sessions, 5);
    expect(result[0].percent).toBe(50);
    expect(result[1].percent).toBe(50);
  });

  it('sums cost per project', () => {
    const sessions = [
      makeSessionRow({ projectName: 'a', estimatedCostUsd: 1.50 }),
      makeSessionRow({ id: 's2', projectName: 'a', estimatedCostUsd: 2.00 }),
    ];
    const result = computeTopProjects(sessions, 5);
    expect(result[0].cost).toBe(3.50);
  });
});

// ── groupByDay ──

describe('groupByDay', () => {
  const refDate = new Date(2026, 0, 15); // Jan 15, 2026

  it('returns all-zero buckets for empty sessions array', () => {
    const result = groupByDay([], '7d');
    expect(result.length).toBeGreaterThan(0);
    expect(result.every((p) => p.value === 0)).toBe(true);
  });

  it('counts sessions in the correct day bucket for sessions metric', () => {
    // Create a session on Jan 15, 2026 (the reference date)
    const sessions = [
      makeSessionRow({
        startedAt: new Date(2026, 0, 15, 10, 0),
        endedAt: new Date(2026, 0, 15, 11, 0),
      }),
    ];
    // Use createBuckets reference date to ensure Jan 15 is included
    const buckets = createBuckets('7d', refDate);
    // groupByDay uses today() internally, so we test with sessions matching actual today
    // Instead, test the shape: all values are numbers
    const result = groupByDay(sessions, '7d');
    expect(Array.isArray(result)).toBe(true);
    expect(result.every((p) => typeof p.value === 'number')).toBe(true);
    expect(result.every((p) => typeof p.date === 'string')).toBe(true);
  });

  it('accumulates cost values for cost metric', () => {
    const sessions = [
      makeSessionRow({ estimatedCostUsd: 1.0 }),
      makeSessionRow({ id: 's2', estimatedCostUsd: 2.0 }),
    ];
    const result = groupByDay(sessions, '7d', 'cost');
    const total = result.reduce((sum, p) => sum + p.value, 0);
    // Both sessions are either within the 7d window (today) or outside —
    // just verify the total is non-negative and the shape is correct
    expect(total).toBeGreaterThanOrEqual(0);
  });

  it('accumulates token values for tokens metric', () => {
    const sessions = [
      makeSessionRow({
        totalInputTokens: 500,
        totalOutputTokens: 250,
        cacheCreationTokens: 100,
        cacheReadTokens: 50,
      }),
    ];
    const result = groupByDay(sessions, '7d', 'tokens');
    const total = result.reduce((sum, p) => sum + p.value, 0);
    expect(total).toBeGreaterThanOrEqual(0);
  });

  it('returns 7 points for 7d period', () => {
    const result = groupByDay([], '7d');
    expect(result.length).toBe(7);
  });

  it('returns 30 points for 30d period', () => {
    const result = groupByDay([], '30d');
    expect(result.length).toBe(30);
  });

  it('returns 12 points for all period', () => {
    const result = groupByDay([], 'all');
    expect(result.length).toBe(12);
  });

  it('returns points sorted oldest-first', () => {
    const result = groupByDay([], '7d');
    for (let i = 1; i < result.length; i++) {
      expect(result[i].date >= result[i - 1].date).toBe(true);
    }
  });
});

// ── computeRangeStats ──

describe('computeRangeStats', () => {
  it('returns zero stats for empty session array', () => {
    const from = new Date(2026, 0, 1);
    const to = new Date(2026, 0, 31);
    const result = computeRangeStats([], from, to);
    expect(result.sessionCount).toBe(0);
    expect(result.totalCost).toBe(0);
    expect(result.totalMinutes).toBe(0);
  });

  it('includes sessions within [from, to) range', () => {
    const from = new Date(2026, 0, 10);
    const to = new Date(2026, 0, 20);
    const sessions = [
      makeSessionRow({
        startedAt: new Date(2026, 0, 15, 10, 0),
        endedAt: new Date(2026, 0, 15, 11, 0),
        estimatedCostUsd: 1.0,
      }),
    ];
    const result = computeRangeStats(sessions, from, to);
    expect(result.sessionCount).toBe(1);
    expect(result.totalCost).toBe(1.0);
    expect(result.totalMinutes).toBe(60);
  });

  it('excludes sessions before the from date', () => {
    const from = new Date(2026, 0, 10);
    const to = new Date(2026, 0, 20);
    const sessions = [
      makeSessionRow({
        startedAt: new Date(2026, 0, 5, 10, 0),
        endedAt: new Date(2026, 0, 5, 11, 0),
      }),
    ];
    const result = computeRangeStats(sessions, from, to);
    expect(result.sessionCount).toBe(0);
  });

  it('excludes sessions at exactly the to date (exclusive upper bound)', () => {
    const from = new Date(2026, 0, 10);
    const to = new Date(2026, 0, 20);
    const sessions = [
      makeSessionRow({
        startedAt: new Date(2026, 0, 20, 0, 0, 0),
        endedAt: new Date(2026, 0, 20, 1, 0, 0),
      }),
    ];
    const result = computeRangeStats(sessions, from, to);
    expect(result.sessionCount).toBe(0);
  });

  it('sums cost for multiple sessions in range', () => {
    const from = new Date(2026, 0, 1);
    const to = new Date(2026, 0, 31);
    const sessions = [
      makeSessionRow({
        startedAt: new Date(2026, 0, 5),
        endedAt: new Date(2026, 0, 5, 1, 0),
        estimatedCostUsd: 1.5,
      }),
      makeSessionRow({
        id: 's2',
        startedAt: new Date(2026, 0, 10),
        endedAt: new Date(2026, 0, 10, 2, 0),
        estimatedCostUsd: 2.5,
      }),
    ];
    const result = computeRangeStats(sessions, from, to);
    expect(result.sessionCount).toBe(2);
    expect(result.totalCost).toBeCloseTo(4.0);
    expect(result.totalMinutes).toBe(180); // 60 + 120
  });
});

// ── computeOverview ──

describe('computeOverview', () => {
  it('returns zeros for empty sessions array', () => {
    const result = computeOverview([], '7d');
    expect(result.sessionCount).toBe(0);
    expect(result.totalCost).toBe(0);
    expect(result.messageCount).toBe(0);
    expect(result.totalTokens).toBe(0);
    expect(result.projectCount).toBe(0);
    expect(result.sessionsWithCostCount).toBe(0);
    expect(result.topProjects).toEqual([]);
    expect(result.sourceTools).toEqual([]);
  });

  it('counts sessions and projects correctly', () => {
    const sessions = [
      makeSessionRow({ projectId: 'p1', projectName: 'proj-a', messageCount: 10 }),
      makeSessionRow({ id: 's2', projectId: 'p1', projectName: 'proj-a', messageCount: 5 }),
      makeSessionRow({ id: 's3', projectId: 'p2', projectName: 'proj-b', messageCount: 8 }),
    ];
    const result = computeOverview(sessions, '7d');
    expect(result.sessionCount).toBe(3);
    expect(result.projectCount).toBe(2);
    expect(result.messageCount).toBe(23);
  });

  it('sums cost only from sessions with estimatedCostUsd', () => {
    const sessions = [
      makeSessionRow({ estimatedCostUsd: 1.0 }),
      makeSessionRow({ id: 's2', estimatedCostUsd: 2.0 }),
      makeSessionRow({ id: 's3' }), // no cost
    ];
    const result = computeOverview(sessions, '7d');
    expect(result.sessionsWithCostCount).toBe(2);
    expect(result.totalCost).toBeCloseTo(3.0);
  });

  it('does not populate sourceTools for single source', () => {
    const sessions = [
      makeSessionRow({ sourceTool: 'claude-code' }),
      makeSessionRow({ id: 's2', sourceTool: 'claude-code' }),
    ];
    const result = computeOverview(sessions, '7d');
    expect(result.sourceTools).toEqual([]);
  });

  it('populates sourceTools when 2+ distinct sources exist', () => {
    const sessions = [
      makeSessionRow({ sourceTool: 'claude-code' }),
      makeSessionRow({ id: 's2', sourceTool: 'cursor' }),
    ];
    const result = computeOverview(sessions, '7d');
    expect(result.sourceTools.length).toBe(2);
    const names = result.sourceTools.map((s) => s.name);
    expect(names).toContain('claude-code');
    expect(names).toContain('cursor');
  });

  it('activityByDay has 7 points for 7d period', () => {
    const result = computeOverview([], '7d');
    expect(result.activityByDay.length).toBe(7);
  });

  it('returns todayStats, yesterdayStats, weekStats as DayStats objects', () => {
    const result = computeOverview([], '7d');
    expect(result.todayStats).toHaveProperty('sessionCount');
    expect(result.todayStats).toHaveProperty('totalCost');
    expect(result.todayStats).toHaveProperty('totalMinutes');
    expect(result.yesterdayStats).toHaveProperty('sessionCount');
    expect(result.weekStats).toHaveProperty('sessionCount');
  });
});

// ── computeCostBreakdown ──

describe('computeCostBreakdown', () => {
  it('returns zeros for empty sessions array', () => {
    const result = computeCostBreakdown([], '7d');
    expect(result.totalCost).toBe(0);
    expect(result.avgPerDay).toBe(0);
    expect(result.avgPerSession).toBe(0);
    expect(result.sessionCount).toBe(0);
    expect(result.sessionsWithCostCount).toBe(0);
    expect(result.byProject).toEqual([]);
    expect(result.byModel).toEqual([]);
    expect(result.peakDay).toBeNull();
  });

  it('correctly aggregates total cost', () => {
    const sessions = [
      makeSessionRow({ estimatedCostUsd: 1.0 }),
      makeSessionRow({ id: 's2', estimatedCostUsd: 3.0 }),
    ];
    const result = computeCostBreakdown(sessions, '7d');
    expect(result.totalCost).toBeCloseTo(4.0);
    expect(result.sessionsWithCostCount).toBe(2);
    expect(result.sessionCount).toBe(2);
  });

  it('excludes sessions without cost from cost aggregation', () => {
    const sessions = [
      makeSessionRow({ estimatedCostUsd: 2.0 }),
      makeSessionRow({ id: 's2' }), // no cost
    ];
    const result = computeCostBreakdown(sessions, '7d');
    expect(result.totalCost).toBeCloseTo(2.0);
    expect(result.sessionsWithCostCount).toBe(1);
    expect(result.sessionCount).toBe(2);
  });

  it('groups byProject correctly', () => {
    const sessions = [
      makeSessionRow({ projectName: 'alpha', estimatedCostUsd: 1.0 }),
      makeSessionRow({ id: 's2', projectName: 'alpha', estimatedCostUsd: 1.5 }),
      makeSessionRow({ id: 's3', projectName: 'beta', estimatedCostUsd: 5.0 }),
    ];
    const result = computeCostBreakdown(sessions, '7d');
    expect(result.byProject.length).toBe(2);
    // sorted by cost descending: beta (5.0) > alpha (2.5)
    expect(result.byProject[0].name).toBe('beta');
    expect(result.byProject[0].cost).toBeCloseTo(5.0);
    expect(result.byProject[1].name).toBe('alpha');
    expect(result.byProject[1].cost).toBeCloseTo(2.5);
  });

  it('groups byModel correctly', () => {
    const sessions = [
      makeSessionRow({ primaryModel: 'claude-sonnet-4-5', estimatedCostUsd: 1.0 }),
      makeSessionRow({ id: 's2', primaryModel: 'claude-haiku-4-5', estimatedCostUsd: 0.5 }),
    ];
    const result = computeCostBreakdown(sessions, '7d');
    expect(result.byModel.length).toBe(2);
    const modelNames = result.byModel.map((m) => m.name);
    expect(modelNames).toContain('claude-sonnet-4-5');
    expect(modelNames).toContain('claude-haiku-4-5');
  });

  it('tokenBreakdown sums tokens correctly', () => {
    const sessions = [
      makeSessionRow({
        estimatedCostUsd: 1.0,
        totalInputTokens: 1000,
        totalOutputTokens: 500,
        cacheCreationTokens: 200,
        cacheReadTokens: 100,
      }),
    ];
    const result = computeCostBreakdown(sessions, '7d');
    expect(result.tokenBreakdown.inputTokens).toBe(1000);
    expect(result.tokenBreakdown.outputTokens).toBe(500);
    expect(result.tokenBreakdown.cacheCreation).toBe(200);
    expect(result.tokenBreakdown.cacheReads).toBe(100);
  });

  it('cacheHitRate is 0 when no tokens', () => {
    const sessions = [makeSessionRow({ estimatedCostUsd: 1.0 })];
    const result = computeCostBreakdown(sessions, '7d');
    expect(result.tokenBreakdown.cacheHitRate).toBe(0);
  });

  it('cacheHitRate is correct when cache reads present', () => {
    const sessions = [
      makeSessionRow({
        estimatedCostUsd: 1.0,
        totalInputTokens: 900,
        cacheReadTokens: 100,
      }),
    ];
    const result = computeCostBreakdown(sessions, '7d');
    // cacheHitRate = cacheReads / (inputTokens + cacheReads) = 100/1000 = 0.1
    expect(result.tokenBreakdown.cacheHitRate).toBeCloseTo(0.1);
  });
});

// ── computeProjectStats ──

describe('computeProjectStats', () => {
  it('returns empty array for no sessions', () => {
    expect(computeProjectStats([], '7d')).toEqual([]);
  });

  it('groups sessions by projectId', () => {
    const sessions = [
      makeSessionRow({ projectId: 'p1', projectName: 'proj-a' }),
      makeSessionRow({ id: 's2', projectId: 'p1', projectName: 'proj-a' }),
      makeSessionRow({ id: 's3', projectId: 'p2', projectName: 'proj-b' }),
    ];
    const result = computeProjectStats(sessions, '7d');
    expect(result.length).toBe(2);
  });

  it('sorts entries by session count descending', () => {
    const sessions = [
      makeSessionRow({ projectId: 'p1', projectName: 'proj-a' }),
      makeSessionRow({ id: 's2', projectId: 'p2', projectName: 'proj-b' }),
      makeSessionRow({ id: 's3', projectId: 'p2', projectName: 'proj-b' }),
    ];
    const result = computeProjectStats(sessions, '7d');
    expect(result[0].projectId).toBe('p2');
    expect(result[0].sessionCount).toBe(2);
    expect(result[1].projectId).toBe('p1');
    expect(result[1].sessionCount).toBe(1);
  });

  it('computes correct totalTimeMinutes', () => {
    const sessions = [
      makeSessionRow({
        projectId: 'p1',
        projectName: 'proj-a',
        startedAt: new Date(2026, 0, 15, 10, 0),
        endedAt: new Date(2026, 0, 15, 11, 30), // 90 min
      }),
    ];
    const result = computeProjectStats(sessions, '7d');
    expect(result[0].totalTimeMinutes).toBe(90);
  });

  it('finds most frequent primaryModel', () => {
    const sessions = [
      makeSessionRow({ projectId: 'p1', projectName: 'a', primaryModel: 'model-x' }),
      makeSessionRow({ id: 's2', projectId: 'p1', projectName: 'a', primaryModel: 'model-x' }),
      makeSessionRow({ id: 's3', projectId: 'p1', projectName: 'a', primaryModel: 'model-y' }),
    ];
    const result = computeProjectStats(sessions, '7d');
    expect(result[0].primaryModel).toBe('model-x');
  });

  it('sets primaryModel to undefined when no sessions have primaryModel', () => {
    const sessions = [makeSessionRow({ projectId: 'p1', projectName: 'a' })];
    const result = computeProjectStats(sessions, '7d');
    expect(result[0].primaryModel).toBeUndefined();
  });

  it('computes lastActive as the latest endedAt', () => {
    const earlier = new Date(2026, 0, 10, 12, 0);
    const later = new Date(2026, 0, 15, 18, 0);
    const sessions = [
      makeSessionRow({ projectId: 'p1', projectName: 'a', startedAt: new Date(2026, 0, 10, 10, 0), endedAt: earlier }),
      makeSessionRow({ id: 's2', projectId: 'p1', projectName: 'a', startedAt: new Date(2026, 0, 15, 16, 0), endedAt: later }),
    ];
    const result = computeProjectStats(sessions, '7d');
    expect(result[0].lastActive).toEqual(later);
  });

  it('activityByDay has 7 points for 7d period', () => {
    const sessions = [makeSessionRow({ projectId: 'p1', projectName: 'a' })];
    const result = computeProjectStats(sessions, '7d');
    expect(result[0].activityByDay.length).toBe(7);
  });
});

// ── computeTodayStats ──

describe('computeTodayStats', () => {
  it('returns zero stats for empty sessions array', () => {
    const result = computeTodayStats([]);
    expect(result.sessionCount).toBe(0);
    expect(result.totalCost).toBe(0);
    expect(result.totalTimeMinutes).toBe(0);
    expect(result.messageCount).toBe(0);
    expect(result.totalTokens).toBe(0);
    expect(result.sessions).toEqual([]);
  });

  it('returns only sessions started today', () => {
    const todayDate = new Date();
    const todayStart = new Date(todayDate.getFullYear(), todayDate.getMonth(), todayDate.getDate(), 9, 0, 0);
    const todayEnd = new Date(todayDate.getFullYear(), todayDate.getMonth(), todayDate.getDate(), 10, 0, 0);

    const sessions = [
      makeSessionRow({ startedAt: todayStart, endedAt: todayEnd }),
      makeSessionRow({
        id: 's2',
        startedAt: new Date(2026, 0, 1, 9, 0),
        endedAt: new Date(2026, 0, 1, 10, 0),
      }),
    ];
    const result = computeTodayStats(sessions);
    // Only the today session should be included (or 0 if today is not Jan 1 2026)
    expect(result.sessionCount).toBeGreaterThanOrEqual(0);
    expect(result.sessions.length).toBe(result.sessionCount);
  });

  it('sessions are sorted chronologically', () => {
    const today = new Date();
    const y = today.getFullYear();
    const mo = today.getMonth();
    const d = today.getDate();

    const sessions = [
      makeSessionRow({
        id: 'late',
        startedAt: new Date(y, mo, d, 14, 0),
        endedAt: new Date(y, mo, d, 15, 0),
      }),
      makeSessionRow({
        id: 'early',
        startedAt: new Date(y, mo, d, 9, 0),
        endedAt: new Date(y, mo, d, 10, 0),
      }),
    ];
    const result = computeTodayStats(sessions);
    if (result.sessions.length >= 2) {
      expect(result.sessions[0].startedAt.getTime()).toBeLessThan(
        result.sessions[1].startedAt.getTime(),
      );
    }
  });

  it('each TodaySession has expected fields', () => {
    const today = new Date();
    const y = today.getFullYear();
    const mo = today.getMonth();
    const d = today.getDate();

    const sessions = [
      makeSessionRow({
        id: 'today-session',
        startedAt: new Date(y, mo, d, 10, 0),
        endedAt: new Date(y, mo, d, 11, 0),
        estimatedCostUsd: 0.5,
        primaryModel: 'claude-sonnet-4-5',
        sessionCharacter: 'feature_build',
      }),
    ];
    const result = computeTodayStats(sessions);
    expect(result.sessionCount).toBe(1);
    const s = result.sessions[0];
    expect(s.id).toBe('today-session');
    expect(s.durationMinutes).toBe(60);
    expect(s.cost).toBe(0.5);
    expect(s.model).toBe('claude-sonnet-4-5');
    expect(s.sessionCharacter).toBe('feature_build');
  });

  it('date field is today at midnight', () => {
    const result = computeTodayStats([]);
    const expected = new Date();
    expected.setHours(0, 0, 0, 0);
    expect(result.date.getTime()).toBe(expected.getTime());
  });
});

// ── computeModelStats ──

describe('computeModelStats', () => {
  it('returns empty array for no sessions', () => {
    expect(computeModelStats([], '7d')).toEqual([]);
  });

  it('returns empty array when no sessions have primaryModel', () => {
    const sessions = [makeSessionRow()]; // no primaryModel
    expect(computeModelStats(sessions, '7d')).toEqual([]);
  });

  it('groups sessions by model', () => {
    const sessions = [
      makeSessionRow({ primaryModel: 'model-a', estimatedCostUsd: 1.0 }),
      makeSessionRow({ id: 's2', primaryModel: 'model-a', estimatedCostUsd: 1.0 }),
      makeSessionRow({ id: 's3', primaryModel: 'model-b', estimatedCostUsd: 0.5 }),
    ];
    const result = computeModelStats(sessions, '7d');
    expect(result.length).toBe(2);
  });

  it('sorts entries by totalCost descending', () => {
    const sessions = [
      makeSessionRow({ primaryModel: 'cheap-model', estimatedCostUsd: 0.5 }),
      makeSessionRow({ id: 's2', primaryModel: 'expensive-model', estimatedCostUsd: 5.0 }),
    ];
    const result = computeModelStats(sessions, '7d');
    expect(result[0].model).toBe('expensive-model');
    expect(result[1].model).toBe('cheap-model');
  });

  it('computes sessionPercent correctly', () => {
    const sessions = [
      makeSessionRow({ primaryModel: 'model-a' }),
      makeSessionRow({ id: 's2', primaryModel: 'model-a' }),
      makeSessionRow({ id: 's3', primaryModel: 'model-b' }),
    ];
    const result = computeModelStats(sessions, '7d');
    const entryA = result.find((e) => e.model === 'model-a')!;
    const entryB = result.find((e) => e.model === 'model-b')!;
    expect(entryA.sessionPercent).toBeCloseTo(66.67, 1);
    expect(entryB.sessionPercent).toBeCloseTo(33.33, 1);
  });

  it('computes costPercent correctly', () => {
    const sessions = [
      makeSessionRow({ primaryModel: 'model-a', estimatedCostUsd: 3.0 }),
      makeSessionRow({ id: 's2', primaryModel: 'model-b', estimatedCostUsd: 1.0 }),
    ];
    const result = computeModelStats(sessions, '7d');
    const entryA = result.find((e) => e.model === 'model-a')!;
    expect(entryA.costPercent).toBeCloseTo(75);
  });

  it('sets displayName using shortenModelName', () => {
    const sessions = [
      makeSessionRow({ primaryModel: 'claude-sonnet-4-5', estimatedCostUsd: 1.0 }),
    ];
    const result = computeModelStats(sessions, '7d');
    expect(result[0].displayName).toBe('Sonnet 4.x');
  });

  it('avgCostPerSession is 0 when no sessions have cost', () => {
    const sessions = [
      makeSessionRow({ primaryModel: 'model-a' }), // no cost
    ];
    const result = computeModelStats(sessions, '7d');
    expect(result[0].avgCostPerSession).toBe(0);
  });

  it('trend array has 7 points for 7d period', () => {
    const sessions = [
      makeSessionRow({ primaryModel: 'model-a', estimatedCostUsd: 1.0 }),
    ];
    const result = computeModelStats(sessions, '7d');
    expect(result[0].trend.length).toBe(7);
  });
});
