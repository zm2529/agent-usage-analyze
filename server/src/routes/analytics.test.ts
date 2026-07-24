import Database from 'better-sqlite3';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { runMigrations } from 'agent-usage-analyze/db/schema';

// ──────────────────────────────────────────────────────
// Module-scoped mutable DB reference for mocking.
// ──────────────────────────────────────────────────────

let testDb: Database.Database;

vi.mock('agent-usage-analyze/db/client', () => ({
  getDb: () => testDb,
  closeDb: () => {},
}));

vi.mock('agent-usage-analyze/utils/telemetry', () => ({
  trackEvent: vi.fn(),
}));

const { createApp } = await import('../index.js');

// ──────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────

function initTestDb(): Database.Database {
  const db = new Database(':memory:');
  runMigrations(db);
  return db;
}

// ──────────────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────────────

describe('Analytics routes', () => {
  beforeEach(() => {
    testDb = initTestDb();
  });

  afterEach(() => {
    testDb.close();
  });

  describe('GET /api/analytics/dashboard', () => {
    it('returns stats shape with default range', async () => {
      const app = createApp();
      const res = await app.request('/api/analytics/dashboard');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.range).toBe('7d');
      expect(body.stats).toBeDefined();
      expect(body.stats.session_count).toBe(0);
    });

    it('accepts valid range parameter', async () => {
      const app = createApp();
      const res = await app.request('/api/analytics/dashboard?range=30d');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.range).toBe('30d');
    });

    it('returns 400 for invalid range', async () => {
      const app = createApp();
      const res = await app.request('/api/analytics/dashboard?range=invalid');
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain('Invalid range');
    });
  });

  describe('GET /api/analytics/overview', () => {
    it('returns complete empty hourly data for today', async () => {
      const app = createApp();
      const res = await app.request('/api/analytics/overview?range=today');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.range).toBe('today');
      expect(body.timeline).toHaveLength(24);
      expect(body.totals).toMatchObject({ sessions: 0, subagents: 0, inputTokens: 0 });
      expect(body.skills).toEqual([]);
    });

    it('rejects unsupported overview ranges', async () => {
      const app = createApp();
      const res = await app.request('/api/analytics/overview?range=all');
      expect(res.status).toBe(400);
    });

    it('uses event-time Token deltas without adding cached input twice', async () => {
      const now = new Date();
      const hour = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}T${String(now.getHours()).padStart(2, '0')}:00:00`;
      testDb.prepare(`INSERT INTO token_usage_hourly (
        hour, input_tokens, output_tokens, cache_creation_tokens, cache_read_tokens,
        reasoning_tokens, event_count
      ) VALUES (?, 1000, 100, 20, 700, 50, 2)`).run(hour);

      const app = createApp();
      const res = await app.request('/api/analytics/overview?range=today');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.totals).toMatchObject({
        inputTokens: 1000,
        outputTokens: 100,
        cacheCreationTokens: 20,
        cacheReadTokens: 700,
      });
      expect(body.timeline[now.getHours()]).toMatchObject({
        inputTokens: 280,
        outputTokens: 100,
        cacheTokens: 720,
      });
    });
  });

  describe('GET /api/analytics/usage', () => {
    it('returns null stats when no usage data exists', async () => {
      const app = createApp();
      const res = await app.request('/api/analytics/usage');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.stats).toBeNull();
    });

    it('returns usage stats when data exists', async () => {
      testDb.prepare(`
        INSERT INTO usage_stats (
          id, total_input_tokens, total_output_tokens,
          estimated_cost_usd, sessions_with_usage
        ) VALUES (1, 10000, 20000, 1.50, 5)
      `).run();

      const app = createApp();
      const res = await app.request('/api/analytics/usage');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.stats).not.toBeNull();
      expect(body.stats.total_input_tokens).toBe(10000);
      expect(body.stats.total_output_tokens).toBe(20000);
      expect(body.stats.estimated_cost_usd).toBe(1.5);
    });
  });
});
