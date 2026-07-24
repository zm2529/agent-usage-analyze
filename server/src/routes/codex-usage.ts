import { Hono } from 'hono';
import {
  readCodexAccountUsage,
  type CodexAccountUsage,
} from 'agent-usage-analyze/analysis/codex-account-usage';

interface CodexUsageDependencies {
  readUsage(): Promise<CodexAccountUsage>;
  now(): number;
}

const CACHE_MS = 30_000;

export function createCodexUsageRouter(dependencies: CodexUsageDependencies = {
  readUsage: readCodexAccountUsage,
  now: Date.now,
}): Hono {
  const app = new Hono();
  let cached: { expiresAt: number; value: CodexAccountUsage } | null = null;
  let pending: Promise<CodexAccountUsage> | null = null;

  app.get('/', async (c) => {
    if (cached && cached.expiresAt > dependencies.now()) {
      return c.json({ available: true as const, ...cached.value });
    }
    try {
      pending ??= dependencies.readUsage();
      const value = await pending;
      cached = { value, expiresAt: dependencies.now() + CACHE_MS };
      return c.json({ available: true as const, ...value });
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'codex-app-server-unavailable';
      return c.json({ available: false as const, reason });
    } finally {
      pending = null;
    }
  });

  return app;
}

export default createCodexUsageRouter();
