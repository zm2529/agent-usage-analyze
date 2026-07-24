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

function seedProjectAndSession(projectId: string, sessionId: string) {
  testDb.prepare(`
    INSERT INTO projects (id, name, path, last_activity, session_count)
    VALUES (?, 'test', '/test', datetime('now'), 1)
  `).run(projectId);

  testDb.prepare(`
    INSERT INTO sessions (id, project_id, project_name, project_path,
      started_at, ended_at, message_count, source_tool)
    VALUES (?, ?, 'test', '/test', '2025-06-15T10:00:00Z', '2025-06-15T11:00:00Z', 5, 'claude-code')
  `).run(sessionId, projectId);
}

function seedMessage(
  id: string,
  sessionId: string,
  type: string,
  content: string,
  timestamp: string,
) {
  testDb.prepare(`
    INSERT INTO messages (id, session_id, type, content, timestamp)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, sessionId, type, content, timestamp);
}

// ──────────────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────────────

describe('Messages routes', () => {
  beforeEach(() => {
    testDb = initTestDb();
  });

  afterEach(() => {
    testDb.close();
  });

  describe('GET /api/messages/:sessionId', () => {
    it('returns messages for a session', async () => {
      seedProjectAndSession('proj-1', 'sess-1');
      seedMessage('msg-1', 'sess-1', 'user', 'Hello', '2025-06-15T10:00:00Z');
      seedMessage('msg-2', 'sess-1', 'assistant', 'Hi there', '2025-06-15T10:01:00Z');

      const app = createApp();
      const res = await app.request('/api/messages/sess-1');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.messages).toHaveLength(2);
      expect(body.messages[0].id).toBe('msg-1');
      expect(body.messages[0].type).toBe('user');
      expect(body.messages[0].content).toBe('Hello');
      expect(body.messages[1].id).toBe('msg-2');
      expect(body.messages[1].type).toBe('assistant');
    });

    it('returns empty array for unknown session ID', async () => {
      const app = createApp();
      const res = await app.request('/api/messages/nonexistent');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.messages).toEqual([]);
    });

    it('returns messages ordered by timestamp ascending', async () => {
      seedProjectAndSession('proj-1', 'sess-1');
      seedMessage('msg-later', 'sess-1', 'assistant', 'Later', '2025-06-15T10:05:00Z');
      seedMessage('msg-earlier', 'sess-1', 'user', 'Earlier', '2025-06-15T10:00:00Z');

      const app = createApp();
      const res = await app.request('/api/messages/sess-1');
      const body = await res.json();
      expect(body.messages[0].id).toBe('msg-earlier');
      expect(body.messages[1].id).toBe('msg-later');
    });
  });
});
