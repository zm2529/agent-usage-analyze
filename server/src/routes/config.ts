import { Hono } from 'hono';
import { getDb } from '@agent-analytics/cli/db/client';
import { getConfigDir, loadConfig, saveConfig } from '@agent-analytics/cli/utils/config';
import type { ClaudeInsightConfig, LLMProviderConfig } from '@agent-analytics/cli/types';
import { loadLLMConfig, testLLMConfig } from '../llm/client.js';
import { discoverOllamaModels } from '../llm/providers/ollama.js';
import { discoverLlamaCppModels } from '../llm/providers/llamacpp.js';
import { semanticProviderLocality } from '@agent-analytics/cli/canonical/semantic-analysis';

const app = new Hono();

const VALID_PROVIDERS = ['openai', 'anthropic', 'gemini', 'ollama', 'llamacpp'] as const;

function maskApiKey(key: string | undefined): string | undefined {
  if (!key || key.length < 8) return key ? '***' : undefined;
  return key.slice(0, 4) + '...' + key.slice(-4);
}

app.get('/runtime', (c) => {
  const config = loadConfig();
  const port = config?.dashboard?.port ?? 7890;
  const llm = config?.dashboard?.llm;
  const db = getDb();
  const sources = db.prepare(`SELECT source_kind AS kind, COUNT(*) AS count
    FROM source_artifacts GROUP BY source_kind ORDER BY source_kind`).all() as Array<{
      kind: string; count: number;
    }>;
  const eras = db.prepare(`SELECT mode, parser_version AS parserVersion, COUNT(*) AS count
    FROM observation_eras GROUP BY mode, parser_version ORDER BY mode, parser_version`).all() as Array<{
      mode: string; parserVersion: string; count: number;
    }>;
  const databaseSchema = (db.prepare('SELECT COALESCE(MAX(version), 0) AS version FROM schema_version')
    .get() as { version: number }).version;
  const migration = db.prepare(`SELECT status, completed_at AS completedAt
    FROM product_migration_runs ORDER BY completed_at DESC, id DESC LIMIT 1`).get() as {
      status: string; completedAt: string;
    } | undefined;

  return c.json({
    dataDirectory: getConfigDir(),
    listenAddress: `127.0.0.1:${port}`,
    sources,
    eras,
    llm: {
      configured: Boolean(llm?.provider && llm.model),
      provider: llm?.provider,
      model: llm?.model,
      locality: llm ? semanticProviderLocality(llm.provider, llm.baseUrl) : undefined,
      enabled: config?.dashboard?.semanticAnalysisEnabled === true,
    },
    migration: {
      databaseSchema,
      status: migration?.status ?? 'not-recorded',
      completedAt: migration?.completedAt ?? null,
    },
    dataActions: {
      exportPath: '/api/export/sanitized',
      archiveCommand: 'agent-analytics reset',
      rebuildCommand: 'agent-analytics import-codex',
      scope: 'Local analysis data only; imported sources and Git repositories are unchanged.',
      recovery: 'Reset creates timestamped backups under the data directory.',
    },
  });
});

// GET /api/config/llm — return full config (API key masked)
app.get('/llm', (c) => {
  const config = loadConfig();
  const llm = config?.dashboard?.llm;

  return c.json({
    dashboardPort: config?.dashboard?.port ?? 7890,
    provider: llm?.provider,
    model: llm?.model,
    apiKey: maskApiKey(llm?.apiKey),
    baseUrl: llm?.baseUrl,
    semanticProviderLocality: llm ? semanticProviderLocality(llm.provider, llm.baseUrl) : undefined,
    semanticAnalysisEnabled: config?.dashboard?.semanticAnalysisEnabled === true,
  });
});

// PUT /api/config/llm — update dashboard port and/or LLM config
app.put('/llm', async (c) => {
  const body = await c.req.json<{
    dashboardPort?: number;
    provider?: string;
    model?: string;
    apiKey?: string;
    baseUrl?: string;
    semanticAnalysisEnabled?: boolean;
  }>();

  const config: ClaudeInsightConfig = loadConfig() ?? {
    sync: { claudeDir: '', excludeProjects: [] },
  };

  let changed = false;

  // Update dashboard port if provided
  if (body.dashboardPort !== undefined) {
    const port = body.dashboardPort;
    if (typeof port !== 'number' || !Number.isInteger(port) || port < 1 || port > 65535) {
      return c.json({ error: 'dashboardPort must be an integer between 1 and 65535' }, 400);
    }
    config.dashboard = { ...config.dashboard, port };
    changed = true;
  }

  // Update LLM config if any LLM field is provided
  const hasLLMField = body.provider !== undefined || body.model !== undefined ||
    body.apiKey !== undefined || body.baseUrl !== undefined;

  if (hasLLMField) {
    if (body.provider !== undefined && !VALID_PROVIDERS.includes(body.provider as typeof VALID_PROVIDERS[number])) {
      return c.json({ error: `provider must be one of: ${VALID_PROVIDERS.join(', ')}` }, 400);
    }

    const existingLlm = config.dashboard?.llm ?? {} as Partial<LLMProviderConfig>;
    const providerChanged = body.provider !== undefined && body.provider !== existingLlm.provider;

    const updatedLlm: LLMProviderConfig = {
      provider: (body.provider as LLMProviderConfig['provider']) ?? existingLlm.provider ?? 'ollama',
      model: body.model ?? existingLlm.model ?? '',
      // Preserve existing API key if not provided in update
      ...(body.apiKey !== undefined
        ? { apiKey: body.apiKey || undefined }
        : !providerChanged && existingLlm.apiKey !== undefined ? { apiKey: existingLlm.apiKey } : {}),
      ...(body.baseUrl !== undefined
        ? { baseUrl: body.baseUrl || undefined }
        : existingLlm.baseUrl !== undefined ? { baseUrl: existingLlm.baseUrl } : {}),
    };

    if (!updatedLlm.model) {
      return c.json({ error: 'model is required when setting LLM config' }, 400);
    }

    config.dashboard = { ...config.dashboard, llm: updatedLlm };
    changed = true;
  }

  if (body.semanticAnalysisEnabled !== undefined) {
    if (typeof body.semanticAnalysisEnabled !== 'boolean') {
      return c.json({ error: 'semanticAnalysisEnabled must be a boolean' }, 400);
    }
    if (body.semanticAnalysisEnabled && !config.dashboard?.llm) {
      return c.json({ error: 'A provider and model are required before semantic analysis can be enabled' }, 400);
    }
    config.dashboard = {
      ...config.dashboard,
      semanticAnalysisEnabled: body.semanticAnalysisEnabled,
    };
    changed = true;
  }

  const semanticLlm = config.dashboard?.llm;
  if (config.dashboard?.semanticAnalysisEnabled === true) {
    if (!semanticLlm) {
      return c.json({ error: 'A provider and model are required before semantic analysis can be enabled' }, 400);
    }
    const isLocalProvider = semanticLlm.provider === 'ollama' || semanticLlm.provider === 'llamacpp';
    const locality = semanticProviderLocality(semanticLlm.provider, semanticLlm.baseUrl);
    if (isLocalProvider && locality === 'remote') {
      return c.json({
        error: 'Remote Ollama and llama.cpp endpoints are not supported for semantic analysis',
      }, 400);
    }
    if (!isLocalProvider && !semanticLlm.apiKey) {
      return c.json({
        error: 'An API key is required before remote semantic analysis can be enabled',
      }, 400);
    }
  }

  if (!changed) {
    return c.json({ ok: true });
  }

  saveConfig(config);
  return c.json({ ok: true });
});

// POST /api/config/llm/test — validate LLM credentials with a test call
app.post('/llm/test', async (c) => {
  // Allow testing with body config or existing saved config
  let testConfig: LLMProviderConfig | null = null;

  try {
    const body = await c.req.json<Partial<LLMProviderConfig>>();
    if (body.provider && body.model) {
      testConfig = {
        provider: body.provider,
        model: body.model,
        ...(body.apiKey ? { apiKey: body.apiKey } : {}),
        ...(body.baseUrl ? { baseUrl: body.baseUrl } : {}),
      };
    }
  } catch {
    // No body or invalid JSON — use existing config
  }

  if (!testConfig) {
    testConfig = loadLLMConfig();
  }

  if (!testConfig) {
    return c.json({
      success: false,
      error: 'No LLM config found. Run `agent-analytics config llm` or provide config in request body.',
    }, 400);
  }

  const result = await testLLMConfig(testConfig);
  return c.json(result, result.success ? 200 : 422);
});

// GET /api/config/llm/ollama-models — return locally available Ollama models
app.get('/llm/ollama-models', async (c) => {
  const baseUrl = c.req.query('baseUrl');
  const models = await discoverOllamaModels(baseUrl);
  return c.json({ models });
});

// GET /api/config/llm/llamacpp-models — return model(s) loaded in the running llama-server instance
app.get('/llm/llamacpp-models', async (c) => {
  const baseUrl = c.req.query('baseUrl');
  const models = await discoverLlamaCppModels(baseUrl);
  return c.json({ models });
});

export default app;
