import { Hono, type Context } from 'hono';
import { getDb } from 'agent-usage-analyze/db/client';
import { CodexRolloutAdapter } from 'agent-usage-analyze/canonical/codex-rollout';
import {
  listSemanticClaims,
  previewSemanticAnalysis,
  runSemanticAnalysis,
  semanticProviderLocality,
  type SemanticAnalysisConfig,
  type SemanticPayloadResolver,
  type SemanticProvider,
} from 'agent-usage-analyze/canonical/semantic-analysis';
import { loadConfig } from 'agent-usage-analyze/utils/config';
import type { ClaudeInsightConfig, LLMProviderConfig } from 'agent-usage-analyze/types';
import { createClientFromConfig } from '../llm/client.js';
import { calculateAnalysisCostIfKnown } from '../llm/analysis-pricing.js';

interface SemanticRouteDependencies {
  getDb: typeof getDb;
  loadConfig: typeof loadConfig;
  resolvePayload: SemanticPayloadResolver;
  createProvider: (config: SemanticAnalysisConfig, llm: LLMProviderConfig) => SemanticProvider;
}

function configuredSemanticAnalysis(config: ClaudeInsightConfig | null): {
  analysis: SemanticAnalysisConfig;
  llm: LLMProviderConfig;
} | null {
  const llm = config?.dashboard?.llm;
  if (config?.dashboard?.semanticAnalysisEnabled !== true || !llm?.provider || !llm.model) return null;
  const locality = semanticProviderLocality(llm.provider, llm.baseUrl);
  const localStyleProvider = llm.provider === 'ollama' || llm.provider === 'llamacpp';
  if ((localStyleProvider && locality === 'remote') || (!localStyleProvider && !llm.apiKey)) return null;
  return {
    analysis: { enabled: true, provider: llm.provider, model: llm.model, locality },
    llm: { ...llm },
  };
}

function defaultProvider(config: SemanticAnalysisConfig, llm: LLMProviderConfig): SemanticProvider {
  const client = createClientFromConfig(llm);
  return {
    provider: client.provider,
    model: client.model,
    locality: config.locality,
    estimateTokens: (text) => client.estimateTokens(text),
    analyze: async ({ systemInstruction, evidenceData }) => {
      const response = await client.chat([
        { role: 'system', content: systemInstruction },
        { role: 'user', content: evidenceData },
      ], { temperature: 0, responseFormat: 'json' });
      const inputTokens = response.usage?.inputTokens ?? null;
      const outputTokens = response.usage?.outputTokens ?? null;
      return {
        content: response.content,
        usage: {
          inputTokens,
          outputTokens,
          costUsd: config.locality === 'local' ? 0
            : inputTokens === null || outputTokens === null ? null
            : calculateAnalysisCostIfKnown(config.provider, config.model, {
            inputTokens, outputTokens,
            cacheCreationTokens: response.usage?.cacheCreationTokens,
            cacheReadTokens: response.usage?.cacheReadTokens,
          }),
        },
      };
    },
  };
}

const defaultAdapter = new CodexRolloutAdapter();
const DEFAULT_DEPENDENCIES: SemanticRouteDependencies = {
  getDb,
  loadConfig,
  resolvePayload: (ref) => defaultAdapter.resolvePayloadText(ref),
  createProvider: defaultProvider,
};

async function taskBody(c: Context): Promise<string | null> {
  const body = await c.req.json<unknown>();
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return null;
  const record = body as Record<string, unknown>;
  return Object.keys(record).length === 1 && typeof record.taskId === 'string'
    && record.taskId.length > 0 && record.taskId.length <= 256 ? record.taskId : null;
}

function isMissingTask(error: unknown): boolean {
  return error instanceof Error && error.message === 'Semantic analysis task not found';
}

export function createSemanticAnalysisRouter(
  dependencies: SemanticRouteDependencies = DEFAULT_DEPENDENCIES,
): Hono {
  const app = new Hono();

  app.post('/preview', async (c) => {
    const taskId = await taskBody(c);
    if (!taskId) return c.json({ error: 'taskId is required' }, 400);
    const configured = configuredSemanticAnalysis(dependencies.loadConfig());
    try {
      const preview = await previewSemanticAnalysis(dependencies.getDb(), {
        taskId, config: configured?.analysis ?? null, resolvePayload: dependencies.resolvePayload,
      });
      if (preview.status === 'ready') {
        preview.estimatedCostUsd = calculateAnalysisCostIfKnown(preview.provider, preview.model, {
          inputTokens: preview.estimatedInputTokens, outputTokens: 1_024,
        });
      }
      return c.json(preview);
    } catch (error) {
      if (isMissingTask(error)) return c.json({ error: 'Task not found' }, 404);
      throw error;
    }
  });

  app.post('/analyze', async (c) => {
    const taskId = await taskBody(c);
    if (!taskId) return c.json({ error: 'taskId is required' }, 400);
    const configured = configuredSemanticAnalysis(dependencies.loadConfig());
    if (!configured) {
      return c.json({ status: 'disabled', reason: 'not-enabled', deterministicAvailable: true });
    }
    const provider = dependencies.createProvider(configured.analysis, configured.llm);
    try {
      return c.json(await runSemanticAnalysis(dependencies.getDb(), {
        taskId, config: configured.analysis, resolvePayload: dependencies.resolvePayload, provider,
      }));
    } catch (error) {
      if (isMissingTask(error)) return c.json({ error: 'Task not found' }, 404);
      throw error;
    }
  });

  app.get('/claims', (c) => {
    const taskId = c.req.query('taskId');
    if (!taskId || taskId.length > 256) return c.json({ error: 'taskId is required' }, 400);
    return c.json({ claims: listSemanticClaims(dependencies.getDb(), taskId) });
  });

  return app;
}

export default createSemanticAnalysisRouter();
