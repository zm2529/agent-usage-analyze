import Database from 'better-sqlite3';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { runMigrations } from '@agent-analytics/cli/db/schema';

// ──────────────────────────────────────────────────────
// Module-scoped mutable DB reference for mocking.
// ──────────────────────────────────────────────────────

let testDb: Database.Database;

vi.mock('@agent-analytics/cli/db/client', () => ({
  getDb: () => testDb,
  closeDb: () => {},
}));

vi.mock('@agent-analytics/cli/utils/telemetry', () => ({
  trackEvent: vi.fn(),
  captureError: vi.fn(),
  isTelemetryEnabled: () => false,
  getStableMachineId: () => 'test-id',
}));

const mockIsLLMConfigured = vi.fn(() => false);

vi.mock('../llm/client.js', () => ({
  isLLMConfigured: () => mockIsLLMConfigured(),
  createLLMClient: vi.fn(),
  loadLLMConfig: () => null,
}));

const mockExtractFacetsOnly = vi.fn();
const mockAnalyzePromptQuality = vi.fn();

vi.mock('../llm/analysis.js', () => ({
  extractFacetsOnly: (...args: unknown[]) => mockExtractFacetsOnly(...args),
  analyzePromptQuality: (...args: unknown[]) => mockAnalyzePromptQuality(...args),
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

function seedProject(id: string, name: string) {
  testDb.prepare(`
    INSERT INTO projects (id, name, path, last_activity, session_count)
    VALUES (?, ?, ?, datetime('now'), 1)
  `).run(id, name, `/projects/${name}`);
}

function seedSession(
  id: string,
  projectId: string,
  overrides: Record<string, unknown> = {},
) {
  const defaults = {
    project_name: 'test-project',
    project_path: '/test',
    started_at: '2025-06-15T10:00:00Z',
    ended_at: '2025-06-15T11:00:00Z',
    message_count: 5,
    source_tool: 'claude-code',
  };
  const row = { ...defaults, ...overrides };
  testDb.prepare(`
    INSERT INTO sessions (id, project_id, project_name, project_path,
      started_at, ended_at, message_count, source_tool)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, projectId, row.project_name, row.project_path,
    row.started_at, row.ended_at, row.message_count, row.source_tool,
  );
}

function seedFacets(
  sessionId: string,
  overrides: {
    outcome_satisfaction?: string;
    workflow_pattern?: string | null;
    had_course_correction?: number;
    friction_points?: unknown[];
    effective_patterns?: unknown[];
  } = {},
) {
  const defaults = {
    outcome_satisfaction: 'successful',
    workflow_pattern: null,
    had_course_correction: 0,
    friction_points: [],
    effective_patterns: [],
  };
  const row = { ...defaults, ...overrides };
  testDb.prepare(`
    INSERT INTO session_facets
      (session_id, outcome_satisfaction, workflow_pattern, had_course_correction,
       friction_points, effective_patterns)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    sessionId,
    row.outcome_satisfaction,
    row.workflow_pattern,
    row.had_course_correction,
    JSON.stringify(row.friction_points),
    JSON.stringify(row.effective_patterns),
  );
}

function seedInsight(
  sessionId: string,
  projectId: string,
  type: string,
  metadata: Record<string, unknown> = {},
) {
  const id = `insight-${sessionId}-${type}`;
  testDb.prepare(`
    INSERT INTO insights
      (id, session_id, project_id, project_name, type, title, content, summary,
       confidence, timestamp, metadata)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, sessionId, projectId, 'test-project', type,
    'Test Insight', 'Content', 'Summary',
    0.9, '2025-06-15T10:30:00Z',
    JSON.stringify(metadata),
  );
}

function seedMessage(sessionId: string) {
  testDb.prepare(`
    INSERT INTO messages (id, session_id, type, content, timestamp)
    VALUES (?, ?, 'human', 'test message', datetime('now'))
  `).run(`msg-${sessionId}`, sessionId);
}

function parseSSEEvents(text: string): Array<{ event: string; data: string }> {
  const events: Array<{ event: string; data: string }> = [];
  const blocks = text.split('\n\n').filter(Boolean);
  for (const block of blocks) {
    const lines = block.split('\n');
    let event = '';
    let data = '';
    for (const line of lines) {
      if (line.startsWith('event:')) event = line.slice(6).trim();
      if (line.startsWith('data:')) data = line.slice(5).trim();
    }
    if (event && data) events.push({ event, data });
  }
  return events;
}

// ──────────────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────────────

describe('Facets routes', () => {
  beforeEach(() => {
    testDb = initTestDb();
    mockIsLLMConfigured.mockReturnValue(false);
    mockExtractFacetsOnly.mockReset();
    mockAnalyzePromptQuality.mockReset();
  });

  afterEach(() => {
    testDb.close();
  });

  // ────────────────────────────────────────────────
  // GET /api/facets
  // ────────────────────────────────────────────────
  describe('GET /api/facets', () => {
    it('returns empty facets when none exist', async () => {
      const app = createApp();
      const res = await app.request('/api/facets?period=all');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.facets).toEqual([]);
      expect(body.missingCount).toBe(0);
      expect(body.totalSessions).toBe(0);
    });

    it('returns facets with correct missingCount', async () => {
      seedProject('proj-1', 'alpha');
      seedSession('sess-1', 'proj-1');
      seedSession('sess-2', 'proj-1');
      seedSession('sess-3', 'proj-1');
      // Only sess-1 and sess-2 have facets; sess-3 does not
      seedFacets('sess-1');
      seedFacets('sess-2');

      const app = createApp();
      const res = await app.request('/api/facets?period=all');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.facets).toHaveLength(2);
      expect(body.totalSessions).toBe(3);
      expect(body.missingCount).toBe(1);
    });

    it('filters by project query param', async () => {
      seedProject('proj-1', 'alpha');
      seedProject('proj-2', 'beta');
      seedSession('sess-1', 'proj-1');
      seedSession('sess-2', 'proj-2');
      seedFacets('sess-1');
      seedFacets('sess-2');

      const app = createApp();
      const res = await app.request('/api/facets?period=all&project=proj-1');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.facets).toHaveLength(1);
      expect(body.facets[0].session_id).toBe('sess-1');
      expect(body.totalSessions).toBe(1);
    });

    it('filters by source query param', async () => {
      seedProject('proj-1', 'alpha');
      seedSession('sess-cc', 'proj-1', { source_tool: 'claude-code' });
      seedSession('sess-cur', 'proj-1', { source_tool: 'cursor' });
      seedFacets('sess-cc');
      seedFacets('sess-cur');

      const app = createApp();
      const res = await app.request('/api/facets?period=all&source=cursor');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.facets).toHaveLength(1);
      expect(body.facets[0].session_id).toBe('sess-cur');
    });
  });

  // ────────────────────────────────────────────────
  // GET /api/facets/aggregated
  // ────────────────────────────────────────────────
  describe('GET /api/facets/aggregated', () => {
    it('returns 200 with expected shape when no data', async () => {
      const app = createApp();
      const res = await app.request('/api/facets/aggregated?period=all');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toHaveProperty('frictionCategories');
      expect(body).toHaveProperty('effectivePatterns');
      expect(body).toHaveProperty('outcomeDistribution');
      expect(body).toHaveProperty('totalSessions');
      expect(Array.isArray(body.frictionCategories)).toBe(true);
      expect(Array.isArray(body.effectivePatterns)).toBe(true);
    });

    it('returns aggregated friction and pattern data', async () => {
      seedProject('proj-1', 'alpha');
      seedSession('sess-1', 'proj-1');
      seedFacets('sess-1', {
        friction_points: [
          { category: 'knowledge-gap', description: 'Didn\'t know API', severity: 'medium', attribution: 'user-actionable' },
        ],
        effective_patterns: [
          { category: 'structured-planning', description: 'Planned first', confidence: 80, driver: 'user-driven' },
        ],
      });

      const app = createApp();
      const res = await app.request('/api/facets/aggregated?period=all');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.frictionCategories).toHaveLength(1);
      expect(body.frictionCategories[0].category).toBe('knowledge-gap');
      expect(body.effectivePatterns).toHaveLength(1);
      expect(body.effectivePatterns[0].category).toBe('structured-planning');
    });
  });

  // ────────────────────────────────────────────────
  // GET /api/facets/missing
  // ────────────────────────────────────────────────
  describe('GET /api/facets/missing', () => {
    it('returns session IDs that have insights but no session_facets row', async () => {
      seedProject('proj-1', 'alpha');
      seedSession('sess-1', 'proj-1');
      seedSession('sess-2', 'proj-1');
      // sess-1 has an insight but no facets
      seedInsight('sess-1', 'proj-1', 'analysis');
      // sess-2 has both an insight and facets
      seedInsight('sess-2', 'proj-1', 'analysis');
      seedFacets('sess-2');

      const app = createApp();
      const res = await app.request('/api/facets/missing');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.sessionIds).toContain('sess-1');
      expect(body.sessionIds).not.toContain('sess-2');
      expect(body.count).toBe(1);
    });

    it('returns empty when all sessions have facets', async () => {
      seedProject('proj-1', 'alpha');
      seedSession('sess-1', 'proj-1');
      seedInsight('sess-1', 'proj-1', 'analysis');
      seedFacets('sess-1');

      const app = createApp();
      const res = await app.request('/api/facets/missing');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.sessionIds).toEqual([]);
      expect(body.count).toBe(0);
    });

    it('filters by project', async () => {
      seedProject('proj-1', 'alpha');
      seedProject('proj-2', 'beta');
      seedSession('sess-1', 'proj-1');
      seedSession('sess-2', 'proj-2');
      seedInsight('sess-1', 'proj-1', 'analysis');
      seedInsight('sess-2', 'proj-2', 'analysis');
      // Neither has facets

      const app = createApp();
      const res = await app.request('/api/facets/missing?project=proj-1');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.sessionIds).toContain('sess-1');
      expect(body.sessionIds).not.toContain('sess-2');
      expect(body.count).toBe(1);
    });

    it('filters out sessions outside the period window (30d)', async () => {
      seedProject('proj-1', 'alpha');
      // Session from 2020 — well outside 30d window
      seedSession('sess-old', 'proj-1', { started_at: '2020-01-01T00:00:00Z' });
      seedInsight('sess-old', 'proj-1', 'analysis');
      // No facets for this session

      const app = createApp();
      const res = await app.request('/api/facets/missing?period=30d');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.sessionIds).not.toContain('sess-old');
      expect(body.count).toBe(0);
    });

    it('filters by source tool', async () => {
      seedProject('proj-1', 'alpha');
      seedSession('sess-cc', 'proj-1', { source_tool: 'claude-code' });
      seedSession('sess-cur', 'proj-1', { source_tool: 'cursor' });
      seedInsight('sess-cc', 'proj-1', 'analysis');
      seedInsight('sess-cur', 'proj-1', 'analysis');
      // Neither has facets

      const app = createApp();
      const res = await app.request('/api/facets/missing?source=cursor');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.sessionIds).toContain('sess-cur');
      expect(body.sessionIds).not.toContain('sess-cc');
      expect(body.count).toBe(1);
    });
  });

  // ────────────────────────────────────────────────
  // GET /api/facets/outdated
  // ────────────────────────────────────────────────
  describe('GET /api/facets/outdated', () => {
    it('detects friction_points missing attribution field', async () => {
      seedProject('proj-1', 'alpha');
      seedSession('sess-1', 'proj-1');
      seedFacets('sess-1', {
        friction_points: [
          // No attribution field — outdated
          { category: 'knowledge-gap', description: 'missing attr', severity: 'low' },
        ],
        effective_patterns: [
          { category: 'structured-planning', description: 'ok pattern', confidence: 80, driver: 'user-driven' },
        ],
      });

      const app = createApp();
      const res = await app.request('/api/facets/outdated?period=all');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.sessionIds).toContain('sess-1');
      expect(body.count).toBeGreaterThanOrEqual(1);
    });

    it('detects effective_patterns missing category field', async () => {
      seedProject('proj-1', 'alpha');
      seedSession('sess-1', 'proj-1');
      seedFacets('sess-1', {
        friction_points: [
          { category: 'knowledge-gap', description: 'ok friction', severity: 'low', attribution: 'user-actionable' },
        ],
        effective_patterns: [
          // No category field — outdated
          { description: 'missing category', confidence: 80, driver: 'user-driven' },
        ],
      });

      const app = createApp();
      const res = await app.request('/api/facets/outdated?period=all');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.sessionIds).toContain('sess-1');
    });

    it('detects effective_patterns missing driver field', async () => {
      seedProject('proj-1', 'alpha');
      seedSession('sess-1', 'proj-1');
      seedFacets('sess-1', {
        effective_patterns: [
          // No driver field — outdated
          { category: 'structured-planning', description: 'missing driver', confidence: 80 },
        ],
      });

      const app = createApp();
      const res = await app.request('/api/facets/outdated?period=all');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.sessionIds).toContain('sess-1');
    });

    it('returns empty when all facets are up to date', async () => {
      seedProject('proj-1', 'alpha');
      seedSession('sess-1', 'proj-1');
      seedFacets('sess-1', {
        friction_points: [
          { category: 'knowledge-gap', description: 'ok', severity: 'low', attribution: 'user-actionable' },
        ],
        effective_patterns: [
          { category: 'structured-planning', description: 'ok', confidence: 80, driver: 'user-driven' },
        ],
      });

      const app = createApp();
      const res = await app.request('/api/facets/outdated?period=all');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.sessionIds).toEqual([]);
      expect(body.count).toBe(0);
    });
  });

  // ────────────────────────────────────────────────
  // GET /api/facets/missing-pq
  // ────────────────────────────────────────────────
  describe('GET /api/facets/missing-pq', () => {
    it('returns sessions with non-PQ insights but no prompt_quality insight', async () => {
      seedProject('proj-1', 'alpha');
      seedSession('sess-1', 'proj-1');
      seedSession('sess-2', 'proj-1');
      // sess-1 has analysis insight but no PQ
      seedInsight('sess-1', 'proj-1', 'analysis');
      // sess-2 has both analysis and PQ
      seedInsight('sess-2', 'proj-1', 'analysis');
      seedInsight('sess-2', 'proj-1', 'prompt_quality', { findings: [] });

      const app = createApp();
      const res = await app.request('/api/facets/missing-pq');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.sessionIds).toContain('sess-1');
      expect(body.sessionIds).not.toContain('sess-2');
      expect(body.count).toBe(1);
    });

    it('excludes sessions that have prompt_quality insights', async () => {
      seedProject('proj-1', 'alpha');
      seedSession('sess-1', 'proj-1');
      seedInsight('sess-1', 'proj-1', 'analysis');
      seedInsight('sess-1', 'proj-1', 'prompt_quality', { findings: [] });

      const app = createApp();
      const res = await app.request('/api/facets/missing-pq');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.sessionIds).toEqual([]);
      expect(body.count).toBe(0);
    });
  });

  // ────────────────────────────────────────────────
  // GET /api/facets/outdated-pq
  // ────────────────────────────────────────────────
  describe('GET /api/facets/outdated-pq', () => {
    it('detects PQ insights missing findings array in metadata', async () => {
      seedProject('proj-1', 'alpha');
      seedSession('sess-1', 'proj-1');
      // Old-schema PQ: metadata has no findings array
      seedInsight('sess-1', 'proj-1', 'prompt_quality', { efficiency_score: 75 });

      const app = createApp();
      const res = await app.request('/api/facets/outdated-pq');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.sessionIds).toContain('sess-1');
      expect(body.count).toBeGreaterThanOrEqual(1);
    });

    it('does not flag PQ insights with findings array', async () => {
      seedProject('proj-1', 'alpha');
      seedSession('sess-1', 'proj-1');
      // New-schema PQ: has findings array
      seedInsight('sess-1', 'proj-1', 'prompt_quality', {
        findings: [{ category: 'vague-request', type: 'deficit' }],
        takeaways: [],
      });

      const app = createApp();
      const res = await app.request('/api/facets/outdated-pq');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.sessionIds).not.toContain('sess-1');
      expect(body.count).toBe(0);
    });
  });

  // ────────────────────────────────────────────────
  // POST /api/facets/backfill (validation only)
  // ────────────────────────────────────────────────
  describe('POST /api/facets/backfill (validation)', () => {
    it('returns 400 when LLM not configured', async () => {
      const app = createApp();
      const res = await app.request('/api/facets/backfill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionIds: ['sess-1'] }),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain('LLM not configured');
    });

    it('returns 400 when sessionIds missing from body', async () => {
      const app = createApp();
      const res = await app.request('/api/facets/backfill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
    });

    it('returns 400 when sessionIds exceeds 200', async () => {
      mockIsLLMConfigured.mockReturnValue(true);
      const app = createApp();
      const res = await app.request('/api/facets/backfill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionIds: Array(201).fill('id') }),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain('Maximum 200 sessions');
    });
  });

  // ────────────────────────────────────────────────
  // POST /api/facets/backfill (SSE streaming)
  // ────────────────────────────────────────────────
  describe('POST /api/facets/backfill (SSE)', () => {
    it('streams progress and complete events for a valid session', async () => {
      seedProject('proj-1', 'alpha');
      seedSession('sess-1', 'proj-1');
      seedMessage('sess-1');

      mockIsLLMConfigured.mockReturnValue(true);
      mockExtractFacetsOnly.mockResolvedValue({ success: true });

      const app = createApp();
      const res = await app.request('/api/facets/backfill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionIds: ['sess-1'] }),
      });

      expect(res.status).toBe(200);
      const text = await res.text();
      const events = parseSSEEvents(text);

      const progressEvents = events.filter(e => e.event === 'progress');
      const completeEvents = events.filter(e => e.event === 'complete');

      expect(progressEvents.length).toBeGreaterThanOrEqual(1);
      expect(completeEvents).toHaveLength(1);

      const completeData = JSON.parse(completeEvents[0].data);
      expect(completeData).toMatchObject({ completed: 1, failed: 0, total: 1 });
    });

    it('counts session as failed when session not found', async () => {
      mockIsLLMConfigured.mockReturnValue(true);

      const app = createApp();
      const res = await app.request('/api/facets/backfill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionIds: ['nonexistent'] }),
      });

      expect(res.status).toBe(200);
      const text = await res.text();
      const events = parseSSEEvents(text);

      const completeEvents = events.filter(e => e.event === 'complete');
      expect(completeEvents).toHaveLength(1);

      const completeData = JSON.parse(completeEvents[0].data);
      expect(completeData).toMatchObject({ completed: 0, failed: 1, total: 1 });
    });

    it('skips sessions with existing facets when force=false', async () => {
      seedProject('proj-1', 'alpha');
      seedSession('sess-1', 'proj-1');
      seedFacets('sess-1');

      mockIsLLMConfigured.mockReturnValue(true);

      const app = createApp();
      const res = await app.request('/api/facets/backfill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionIds: ['sess-1'] }),
      });

      expect(res.status).toBe(200);
      const text = await res.text();
      const events = parseSSEEvents(text);

      const completeEvents = events.filter(e => e.event === 'complete');
      expect(completeEvents).toHaveLength(1);

      const completeData = JSON.parse(completeEvents[0].data);
      expect(completeData).toMatchObject({ completed: 1, failed: 0, total: 1 });

      // extractFacetsOnly should NOT have been called (skipped)
      expect(mockExtractFacetsOnly).not.toHaveBeenCalled();
    });

    it('re-processes sessions with existing facets when force=true', async () => {
      seedProject('proj-1', 'alpha');
      seedSession('sess-1', 'proj-1');
      seedFacets('sess-1');
      seedMessage('sess-1');

      mockIsLLMConfigured.mockReturnValue(true);
      mockExtractFacetsOnly.mockResolvedValue({ success: true });

      const app = createApp();
      const res = await app.request('/api/facets/backfill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionIds: ['sess-1'], force: true }),
      });

      expect(res.status).toBe(200);
      await res.text(); // consume stream

      expect(mockExtractFacetsOnly).toHaveBeenCalledOnce();
    });
  });

  // ────────────────────────────────────────────────
  // POST /api/facets/backfill-pq (validation)
  // ────────────────────────────────────────────────
  describe('POST /api/facets/backfill-pq (validation)', () => {
    it('returns 400 when LLM not configured', async () => {
      const app = createApp();
      const res = await app.request('/api/facets/backfill-pq', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionIds: ['sess-1'] }),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain('LLM not configured');
    });

    it('returns 400 when sessionIds missing from body', async () => {
      mockIsLLMConfigured.mockReturnValue(true);
      const app = createApp();
      const res = await app.request('/api/facets/backfill-pq', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain('sessionIds array required');
    });

    it('returns 400 when sessionIds exceeds 200', async () => {
      mockIsLLMConfigured.mockReturnValue(true);
      const app = createApp();
      const res = await app.request('/api/facets/backfill-pq', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionIds: Array(201).fill('id') }),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain('Maximum 200 sessions');
    });
  });

  // ────────────────────────────────────────────────
  // POST /api/facets/backfill-pq (SSE streaming)
  // ────────────────────────────────────────────────
  describe('POST /api/facets/backfill-pq (SSE)', () => {
    it('streams progress and complete events for a valid session', async () => {
      seedProject('proj-1', 'alpha');
      seedSession('sess-1', 'proj-1');
      seedMessage('sess-1');

      mockIsLLMConfigured.mockReturnValue(true);
      mockAnalyzePromptQuality.mockResolvedValue({ success: true });

      const app = createApp();
      const res = await app.request('/api/facets/backfill-pq', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionIds: ['sess-1'] }),
      });

      expect(res.status).toBe(200);
      const text = await res.text();
      const events = parseSSEEvents(text);

      const completeEvents = events.filter(e => e.event === 'complete');
      expect(completeEvents).toHaveLength(1);

      const completeData = JSON.parse(completeEvents[0].data);
      expect(completeData).toMatchObject({ completed: 1, failed: 0, total: 1 });
    });

    it('skips sessions that already have a PQ insight when force=false', async () => {
      seedProject('proj-1', 'alpha');
      seedSession('sess-1', 'proj-1');
      seedInsight('sess-1', 'proj-1', 'prompt_quality', { findings: [] });

      mockIsLLMConfigured.mockReturnValue(true);

      const app = createApp();
      const res = await app.request('/api/facets/backfill-pq', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionIds: ['sess-1'] }),
      });

      expect(res.status).toBe(200);
      const text = await res.text();
      const events = parseSSEEvents(text);

      const completeEvents = events.filter(e => e.event === 'complete');
      expect(completeEvents).toHaveLength(1);

      const completeData = JSON.parse(completeEvents[0].data);
      expect(completeData).toMatchObject({ completed: 1, failed: 0, total: 1 });

      // analyzePromptQuality should NOT have been called (skipped)
      expect(mockAnalyzePromptQuality).not.toHaveBeenCalled();
    });

    it('counts session as failed when session not found', async () => {
      mockIsLLMConfigured.mockReturnValue(true);

      const app = createApp();
      const res = await app.request('/api/facets/backfill-pq', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionIds: ['nonexistent-pq'] }),
      });

      expect(res.status).toBe(200);
      const text = await res.text();
      const events = parseSSEEvents(text);

      const completeEvents = events.filter(e => e.event === 'complete');
      expect(completeEvents).toHaveLength(1);

      const completeData = JSON.parse(completeEvents[0].data);
      expect(completeData).toMatchObject({ completed: 0, failed: 1, total: 1 });
    });
  });
});
