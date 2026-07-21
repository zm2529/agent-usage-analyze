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
}));

// Import createApp AFTER mocks are declared
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

// ──────────────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────────────

describe('Projects routes', () => {
  beforeEach(() => {
    testDb = initTestDb();
  });

  afterEach(() => {
    testDb.close();
  });

  describe('GET /api/projects', () => {
    it('returns empty array when no projects exist', async () => {
      const app = createApp();
      const res = await app.request('/api/projects');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.projects).toEqual([]);
    });

    it('returns seeded projects', async () => {
      seedProject('proj-1', 'alpha');
      seedProject('proj-2', 'beta');

      const app = createApp();
      const res = await app.request('/api/projects');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.projects).toHaveLength(2);
    });
  });

  describe('GET /api/projects/:id', () => {
    it('returns a project by ID', async () => {
      seedProject('proj-abc', 'my-project');

      const app = createApp();
      const res = await app.request('/api/projects/proj-abc');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.project.id).toBe('proj-abc');
      expect(body.project.name).toBe('my-project');
    });

    it('returns 404 for unknown project ID', async () => {
      const app = createApp();
      const res = await app.request('/api/projects/nonexistent');
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toBe('Not found');
    });
  });
});
