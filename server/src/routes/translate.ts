import { createHash } from 'node:crypto';
import { Hono } from 'hono';
import { jsonrepair } from 'jsonrepair';
import { getDb } from 'agent-usage-analyze/db/client';
import { createAnalysisRunnerFromPolicy } from 'agent-usage-analyze/analysis/runner-factory';
import { recordAnalysisRun } from 'agent-usage-analyze/analysis/analysis-run-db';

const app = new Hono();
const jobs = new Map<string, TranslationJob>();
const translationQueue: Array<() => Promise<void>> = [];
let activeTranslations = 0;
const MAX_CONCURRENT_TRANSLATIONS = 1;
// A Codex-native call carries a substantial fixed prompt/runtime cost. Keep a
// normal page or report in one ordered translation call and split only inputs
// that approach the route's own 200 KB safety boundary.
const MAX_TRANSLATION_STRINGS_PER_CALL = 1_000;
const MAX_TRANSLATION_SOURCE_BYTES_PER_CALL = 160_000;

type TargetLanguage = 'en' | 'zh-CN';
type JsonPath = Array<string | number>;

interface TranslationLeaf {
  path: JsonPath;
  text: string;
}

interface TranslationJob {
  status: 'queued' | 'running' | 'completed' | 'failed';
  queuedAt: string;
  startedAt: string;
  error?: string;
}

function drainTranslationQueue() {
  while (activeTranslations < MAX_CONCURRENT_TRANSLATIONS && translationQueue.length > 0) {
    const task = translationQueue.shift()!;
    activeTranslations += 1;
    void task().finally(() => {
      activeTranslations -= 1;
      drainTranslationQueue();
    });
  }
}

function scheduleTranslation(
  jobId: string,
  targetLanguage: TargetLanguage,
  content: unknown,
  source: string,
) {
  const queuedAt = new Date().toISOString();
  jobs.set(jobId, { status: 'queued', queuedAt, startedAt: queuedAt });
  translationQueue.push(async () => {
    jobs.set(jobId, {
      ...jobs.get(jobId)!,
      status: 'running',
      startedAt: new Date().toISOString(),
    });
    await runTranslation(jobId, targetLanguage, content, source);
  });
  drainTranslationQueue();
}

export function schemaForShape(value: unknown): Record<string, unknown> {
  if (value === null) return { type: 'null' };
  if (Array.isArray(value)) {
    return {
      type: 'array',
      items: value.length > 0 ? schemaForShape(value[0]) : { type: 'string' },
    };
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    return {
      type: 'object',
      properties: Object.fromEntries(entries.map(([key, child]) => [key, schemaForShape(child)])),
      required: entries.map(([key]) => key),
      additionalProperties: false,
    };
  }
  if (typeof value === 'number') return { type: Number.isInteger(value) ? 'integer' : 'number' };
  if (typeof value === 'boolean') return { type: 'boolean' };
  return { type: 'string' };
}

export function collectTranslationLeaves(value: unknown, path: JsonPath = [], result: TranslationLeaf[] = []): TranslationLeaf[] {
  if (typeof value === 'string') {
    result.push({ path, text: value });
    return result;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectTranslationLeaves(item, [...path, index], result));
    return result;
  }
  if (value && typeof value === 'object') {
    Object.entries(value as Record<string, unknown>)
      .forEach(([key, child]) => collectTranslationLeaves(child, [...path, key], result));
  }
  return result;
}

export function translationLeavesForTarget(value: unknown, targetLanguage: TargetLanguage): TranslationLeaf[] {
  return collectTranslationLeaves(value).filter(({ text }) => {
    if (targetLanguage === 'en') return /[\u3400-\u9fff]/.test(text);
    const trimmed = text.trim();
    if (/^(?:https?:\/\/|\/|[A-Za-z]:\\)/.test(trimmed)) return false;
    const latinLetters = (trimmed.match(/[A-Za-z]/g) ?? []).length;
    return latinLetters >= 8 && /\s/.test(trimmed);
  });
}

export function applyTranslatedLeaves<T>(value: T, leaves: TranslationLeaf[], translated: string[]): T {
  if (leaves.length !== translated.length) {
    throw new Error(`Translation returned ${translated.length} strings for ${leaves.length} inputs`);
  }
  const copy = structuredClone(value);
  leaves.forEach((leaf, index) => {
    if (leaf.path.length === 0) return;
    let parent = copy as unknown;
    for (const segment of leaf.path.slice(0, -1)) {
      parent = (parent as Record<string | number, unknown>)[segment];
    }
    const key = leaf.path.at(-1)!;
    (parent as Record<string | number, unknown>)[key] = translated[index];
  });
  return leaves.length === 1 && leaves[0].path.length === 0
    ? translated[0] as T
    : copy;
}

function translationChunks(leaves: TranslationLeaf[]): TranslationLeaf[][] {
  const chunks: TranslationLeaf[][] = [];
  let current: TranslationLeaf[] = [];
  let bytes = 0;
  for (const leaf of leaves) {
    const leafBytes = Buffer.byteLength(JSON.stringify(leaf.text));
    if (current.length > 0 && (
      current.length >= MAX_TRANSLATION_STRINGS_PER_CALL
      || bytes + leafBytes > MAX_TRANSLATION_SOURCE_BYTES_PER_CALL
    )) {
      chunks.push(current);
      current = [];
      bytes = 0;
    }
    current.push(leaf);
    bytes += leafBytes;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

async function retryDatabaseWrite(db: ReturnType<typeof getDb>, action: () => void): Promise<void> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const previousTimeout = db.pragma('busy_timeout', { simple: true }) as number;
    db.pragma('busy_timeout = 0');
    let shouldRetry = false;
    try {
      action();
      return;
    } catch (error) {
      shouldRetry = error instanceof Error
        && ('code' in error ? (error as Error & { code?: string }).code === 'SQLITE_BUSY' : /database is locked/i.test(error.message));
      if (!shouldRetry || attempt === 29) throw error;
    } finally {
      db.pragma(`busy_timeout = ${previousTimeout}`);
    }
    if (shouldRetry) await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
}

async function runTranslation(jobId: string, targetLanguage: TargetLanguage, content: unknown, source: string) {
  const db = getDb();
  const started = Date.now();
  try {
    const leaves = translationLeavesForTarget(content, targetLanguage);
    if (leaves.length === 0) {
      await retryDatabaseWrite(db, () => {
        db.prepare(`INSERT OR REPLACE INTO translation_cache
          (content_hash, target_language, translated_json) VALUES (?, ?, ?)`)
          .run(jobId.split(':')[1], targetLanguage, source);
      });
      jobs.set(jobId, { ...jobs.get(jobId)!, status: 'completed' });
      return;
    }
    const { runner } = createAnalysisRunnerFromPolicy({
      codexTimeoutMs: 300_000,
      codexReasoningEffort: 'low',
    });
    const language = targetLanguage === 'zh-CN' ? 'Simplified Chinese' : 'English';
    const translated: string[] = [];
    let usage = {
      inputTokens: 0,
      outputTokens: 0,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
      model: '',
      provider: '',
    };
    for (const chunk of translationChunks(leaves)) {
      const result = await runner.runAnalysis({
        systemPrompt: `Translate each user-visible natural-language string to ${language}. Return one string for every input in the same order. Preserve URLs, IDs, file paths, code, commands, tags, enum values, product names, and strings that do not need translation.`,
        userPrompt: JSON.stringify({ strings: chunk.map((leaf) => leaf.text) }),
        jsonSchema: {
          type: 'object',
          properties: {
            translations: { type: 'array', items: { type: 'string' } },
          },
          required: ['translations'],
          additionalProperties: false,
        },
      });
      const parsed = JSON.parse(jsonrepair(result.rawJson)) as { translations?: unknown };
      if (!Array.isArray(parsed.translations) || parsed.translations.some((item) => typeof item !== 'string')) {
        throw new Error('Translation result did not return an ordered string list');
      }
      if (parsed.translations.length !== chunk.length) {
        throw new Error(`Translation returned ${parsed.translations.length} strings for ${chunk.length} inputs`);
      }
      translated.push(...parsed.translations);
      usage = {
        inputTokens: usage.inputTokens + result.inputTokens,
        outputTokens: usage.outputTokens + result.outputTokens,
        cacheCreationTokens: usage.cacheCreationTokens + (result.cacheCreationTokens ?? 0),
        cacheReadTokens: usage.cacheReadTokens + (result.cacheReadTokens ?? 0),
        model: result.model,
        provider: result.provider,
      };
    }
    const translatedContent = applyTranslatedLeaves(content, leaves, translated);
    const contentHash = jobId.split(':')[1];
    await retryDatabaseWrite(db, () => {
      db.prepare(`INSERT OR REPLACE INTO translation_cache
        (content_hash, target_language, translated_json) VALUES (?, ?, ?)`)
        .run(contentHash, targetLanguage, JSON.stringify(translatedContent));
      recordAnalysisRun({
        analysisType: 'translation',
        status: 'completed',
        provider: usage.provider,
        model: usage.model,
        promptVersion: 'translation-v2',
        inputSummary: {
          contentHash,
          targetLanguage,
          sourceBytes: source.length,
          stringCount: leaves.length,
        },
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        cacheCreationTokens: usage.cacheCreationTokens,
        cacheReadTokens: usage.cacheReadTokens,
        durationMs: Date.now() - started,
      }, db);
    });
    jobs.set(jobId, { ...jobs.get(jobId)!, status: 'completed' });
  } catch (error) {
    jobs.set(jobId, {
      ...jobs.get(jobId)!,
      status: 'failed',
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function cachedTranslation(contentHash: string, targetLanguage: TargetLanguage) {
  const db = getDb();
  return db.prepare(`SELECT translated_json AS translatedJson
    FROM translation_cache WHERE content_hash = ? AND target_language = ?`)
    .get(contentHash, targetLanguage) as { translatedJson: string } | undefined;
}

app.post('/', async (c) => {
  const body = await c.req.json<{ targetLanguage?: TargetLanguage; content?: unknown }>();
  if (!['en', 'zh-CN'].includes(body.targetLanguage ?? '') || body.content == null) {
    return c.json({ error: 'targetLanguage and content are required' }, 400);
  }
  const source = JSON.stringify(body.content);
  if (source.length > 200_000) return c.json({ error: 'Content is too large to translate' }, 413);
  const hash = createHash('sha256').update(source).digest('hex');
  const targetLanguage = body.targetLanguage as TargetLanguage;
  const cached = cachedTranslation(hash, targetLanguage);
  if (cached) return c.json({
    status: 'completed' as const,
    content: JSON.parse(cached.translatedJson),
    cached: true,
  });

  const jobId = `${targetLanguage}:${hash}`;
  const existing = jobs.get(jobId);
  if (existing?.status === 'failed') {
    scheduleTranslation(jobId, targetLanguage, body.content, source);
    return c.json({ jobId, ...jobs.get(jobId)! }, 202);
  }
  if (existing) return c.json({ jobId, ...existing }, 202);

  scheduleTranslation(jobId, targetLanguage, body.content, source);
  return c.json({ jobId, ...jobs.get(jobId)! }, 202);
});

app.get('/:targetLanguage/:hash', (c) => {
  const targetLanguage = c.req.param('targetLanguage') as TargetLanguage;
  const hash = c.req.param('hash');
  if (!['en', 'zh-CN'].includes(targetLanguage) || !/^[a-f0-9]{64}$/.test(hash)) {
    return c.json({ error: 'Invalid translation job' }, 400);
  }
  const cached = cachedTranslation(hash, targetLanguage);
  if (cached) return c.json({
    status: 'completed' as const,
    content: JSON.parse(cached.translatedJson),
    cached: false,
  });
  const jobId = `${targetLanguage}:${hash}`;
  const job = jobs.get(jobId);
  if (!job) return c.json({ status: 'missing' as const }, 404);
  return c.json({ jobId, ...job }, job.status === 'failed' ? 200 : 202);
});

export default app;
