import Database from 'better-sqlite3';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { runMigrations } from 'agent-usage-analyze/db/schema';
import { loadConfig, saveConfig } from 'agent-usage-analyze/utils/config';

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

vi.mock('agent-usage-analyze/utils/config', () => ({
  loadConfig: vi.fn(() => null),
  saveConfig: vi.fn(),
  getConfigDir: () => '/tmp/agent-analytics-test',
}));

vi.mock('../llm/client.js', () => ({
  loadLLMConfig: () => null,
  isLLMConfigured: () => false,
  testLLMConfig: vi.fn().mockResolvedValue({ success: true }),
}));

vi.mock('../llm/providers/ollama.js', () => ({
  discoverOllamaModels: vi.fn().mockResolvedValue([]),
}));

vi.mock('agent-usage-analyze/analysis/execution-policy', () => ({
  isAnalysisExecutionMode: (value: unknown) => [
    'auto', 'codex-native', 'claude-native', 'provider', 'local-only', 'off',
  ].includes(String(value)),
  resolveAnalysisExecutionPolicy: (config: { dashboard?: { analysis?: { mode?: string }; llm?: unknown } } | null) => ({
    mode: config?.dashboard?.analysis?.mode ?? 'auto',
    effectiveRunner: config?.dashboard?.llm ? 'provider' : 'codex-native',
    authentication: config?.dashboard?.llm ? 'provider' : 'chatgpt',
    locality: 'remote',
    reason: config?.dashboard?.llm ? 'configured-provider' : 'codex-chatgpt-auth',
  }),
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

describe('Config routes', () => {
  beforeEach(() => {
    testDb = initTestDb();
    vi.mocked(loadConfig).mockReturnValue(null);
    vi.mocked(saveConfig).mockClear();
  });

  afterEach(() => {
    testDb.close();
  });

  describe('GET /api/config/llm', () => {
    it('returns config shape when no config exists', async () => {
      const app = createApp();
      const res = await app.request('/api/config/llm');
      expect(res.status).toBe(200);
      const body = await res.json();
      // loadConfig returns null, so llm is undefined
      expect(body.dashboardPort).toBe(7890);
      expect(body.provider).toBeUndefined();
      expect(body.model).toBeUndefined();
      expect(body.semanticAnalysisEnabled).toBe(false);
      expect(body.analysis).toEqual({
        mode: 'auto', effectiveRunner: 'codex-native', authentication: 'chatgpt',
        locality: 'remote', reason: 'codex-chatgpt-auth',
      });
    });
  });

  describe('GET /api/config/runtime', () => {
    it('reports only local runtime, source, migration, and recovery metadata', async () => {
      testDb.exec(`
        INSERT INTO observation_eras
          (id, name, mode, parser_version, capabilities_json, starts_at)
        VALUES ('era:runtime', 'Runtime', 'continuous-observation', 'fixture-v1', '[]',
          '2026-07-21T00:00:00.000Z');
        INSERT INTO source_artifacts
          (id, source_kind, parser_version, locator_hash, observed_at, era_id)
        VALUES ('source:runtime', 'synthetic-codex', 'fixture-v1', 'sha256:runtime',
          '2026-07-21T00:00:00.000Z', 'era:runtime');
      `);
      const response = await createApp().request('/api/config/runtime');
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        dataDirectory: '/tmp/agent-analytics-test',
        listenAddress: '127.0.0.1:7890',
        sources: [{ kind: 'synthetic-codex', count: 1 }],
        eras: [{ mode: 'continuous-observation', parserVersion: 'fixture-v1' }],
        llm: { configured: false, enabled: false },
        migration: { databaseSchema: 28 },
        dataActions: {
          exportPath: '/api/export/sanitized',
          archiveCommand: 'agent-usage-analyze reset',
          rebuildCommand: 'agent-usage-analyze import-codex',
        },
      });
    });
  });

  describe('PUT /api/config/llm', () => {
    it('persists a valid analysis execution mode without requiring a provider', async () => {
      const response = await createApp().request('/api/config/llm', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ analysisMode: 'local-only' }),
      });

      expect(response.status).toBe(200);
      expect(vi.mocked(saveConfig)).toHaveBeenCalledWith(expect.objectContaining({
        dashboard: expect.objectContaining({ analysis: { mode: 'local-only' } }),
      }));
    });

    it('rejects an unknown analysis execution mode', async () => {
      const response = await createApp().request('/api/config/llm', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ analysisMode: 'free-magic' }),
      });
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ error: expect.stringMatching(/analysisMode/) });
    });

    it('returns 400 for port above valid range', async () => {
      const app = createApp();
      const res = await app.request('/api/config/llm', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dashboardPort: 99999 }),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toMatch(/dashboardPort/);
    });

    it('returns 400 for negative port', async () => {
      const app = createApp();
      const res = await app.request('/api/config/llm', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dashboardPort: -1 }),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toMatch(/dashboardPort/);
    });

    it('returns 400 for non-integer port', async () => {
      const app = createApp();
      const res = await app.request('/api/config/llm', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dashboardPort: 'abc' }),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toMatch(/dashboardPort/);
    });

    it('returns 400 for invalid provider name', async () => {
      const app = createApp();
      const res = await app.request('/api/config/llm', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: 'notreal', model: 'some-model' }),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toMatch(/provider/);
    });

    it('returns 400 when provider is given but model is empty', async () => {
      const app = createApp();
      const res = await app.request('/api/config/llm', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        // model is omitted — no existing config to fall back to, so model resolves to ''
        body: JSON.stringify({ provider: 'ollama' }),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toMatch(/model/);
    });

    it('returns 200 with ok:true when no fields are provided (no-op)', async () => {
      const app = createApp();
      const res = await app.request('/api/config/llm', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
    });

    it('returns 200 when updating with valid provider and model', async () => {
      const app = createApp();
      const res = await app.request('/api/config/llm', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: 'ollama', model: 'llama3' }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
    });

    it('calls saveConfig when LLM config changes', async () => {
      vi.mocked(saveConfig).mockClear();
      const app = createApp();
      await app.request('/api/config/llm', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: 'anthropic', model: 'claude-3-5-sonnet-20241022' }),
      });
      expect(vi.mocked(saveConfig)).toHaveBeenCalledOnce();
    });

    it('persists semantic analysis as an explicit opt-in with the selected provider', async () => {
      vi.mocked(saveConfig).mockClear();
      const response = await createApp().request('/api/config/llm', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'ollama', model: 'qwen3:14b', semanticAnalysisEnabled: true,
        }),
      });

      expect(response.status).toBe(200);
      expect(vi.mocked(saveConfig)).toHaveBeenCalledWith(expect.objectContaining({
        dashboard: expect.objectContaining({
          semanticAnalysisEnabled: true,
          llm: expect.objectContaining({ provider: 'ollama', model: 'qwen3:14b' }),
        }),
      }));
    });

    it('does not enable a remote semantic provider without explicit credentials', async () => {
      const response = await createApp().request('/api/config/llm', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'anthropic', model: 'claude-sonnet-4-6', semanticAnalysisEnabled: true,
        }),
      });

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        error: 'An API key is required before remote semantic analysis can be enabled',
      });
    });

    it('does not switch an enabled local semantic configuration to an uncredentialed remote provider', async () => {
      vi.mocked(loadConfig).mockReturnValue({
        sync: { claudeDir: '', excludeProjects: [] },
        dashboard: {
          semanticAnalysisEnabled: true,
          llm: { provider: 'ollama', model: 'qwen3:14b' },
        },
      });
      const response = await createApp().request('/api/config/llm', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: 'anthropic', model: 'claude-sonnet-4-6' }),
      });

      expect(response.status).toBe(400);
      expect(saveConfig).not.toHaveBeenCalled();
    });

    it('does not remove the credential from an enabled remote semantic configuration', async () => {
      vi.mocked(loadConfig).mockReturnValue({
        sync: { claudeDir: '', excludeProjects: [] },
        dashboard: {
          semanticAnalysisEnabled: true,
          llm: { provider: 'anthropic', model: 'claude-sonnet-4-6', apiKey: 'configured-secret' },
        },
      });
      const response = await createApp().request('/api/config/llm', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: '' }),
      });

      expect(response.status).toBe(400);
      expect(saveConfig).not.toHaveBeenCalled();
    });

    it('does not reuse one remote provider credential after switching providers', async () => {
      vi.mocked(loadConfig).mockReturnValue({
        sync: { claudeDir: '', excludeProjects: [] },
        dashboard: {
          semanticAnalysisEnabled: true,
          llm: { provider: 'openai', model: 'gpt-fixture', apiKey: 'openai-only-secret' },
        },
      });
      const response = await createApp().request('/api/config/llm', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: 'anthropic', model: 'claude-fixture' }),
      });

      expect(response.status).toBe(400);
      expect(saveConfig).not.toHaveBeenCalled();
    });

    it('does not classify a custom remote Ollama endpoint as local semantic analysis', async () => {
      const response = await createApp().request('/api/config/llm', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'ollama', model: 'qwen3:14b', baseUrl: 'https://remote.example',
          apiKey: 'unused-secret', semanticAnalysisEnabled: true,
        }),
      });

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        error: 'Remote Ollama and llama.cpp endpoints are not supported for semantic analysis',
      });
      expect(saveConfig).not.toHaveBeenCalled();
    });
  });

  describe('POST /api/config/llm/test', () => {
    it('returns 400 when no LLM config exists and no body is provided', async () => {
      // loadLLMConfig mock returns null; no body in request
      const app = createApp();
      const res = await app.request('/api/config/llm/test', {
        method: 'POST',
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.success).toBe(false);
      expect(body.error).toBeTruthy();
    });

    it('returns 200 when body provides a valid config', async () => {
      // testLLMConfig mock resolves to { success: true }
      const app = createApp();
      const res = await app.request('/api/config/llm/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: 'ollama', model: 'llama3' }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
    });
  });

  describe('GET /api/config/llm/ollama-models', () => {
    it('returns empty models array when no Ollama models are discovered', async () => {
      // discoverOllamaModels mock resolves to []
      const app = createApp();
      const res = await app.request('/api/config/llm/ollama-models');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.models).toEqual([]);
    });
  });
});
