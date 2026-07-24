import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { closeDb } from 'agent-usage-analyze/db/client';
import { createApp } from '../index.js';

let dataDir: string;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'agent-analytics-patterns-api-'));
  process.env.AGENT_ANALYTICS_CONFIG_DIR = dataDir;
});

afterEach(() => {
  closeDb();
  delete process.env.AGENT_ANALYTICS_CONFIG_DIR;
  rmSync(dataDir, { recursive: true, force: true });
});

describe('pattern trend API', () => {
  it('returns a history-wide deterministic overview without model configuration', async () => {
    const response = await createApp().request('/api/patterns/overview');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ analyzedTaskCount: 0, patterns: [] });
  });

  it('returns equal adjacent windows, era metadata, coverage, and evidence-closed trends', async () => {
    const response = await createApp().request(
      '/api/patterns/trends?currentStart=2026-07-14T00%3A00%3A00.000Z&currentEnd=2026-07-21T00%3A00%3A00.000Z',
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      comparison: {
        previousWindow: {
          start: '2026-07-07T00:00:00.000Z', end: '2026-07-14T00:00:00.000Z',
          taskCount: 0, coverage: 0, eras: [],
        },
        currentWindow: {
          start: '2026-07-14T00:00:00.000Z', end: '2026-07-21T00:00:00.000Z',
          taskCount: 0, coverage: 0, eras: [],
        },
        eraCompatibility: 'incomparable', trends: [],
      },
    });
  });

  it('rejects missing or non-increasing boundaries', async () => {
    const app = createApp();
    expect((await app.request('/api/patterns/trends')).status).toBe(400);
    expect((await app.request('/api/patterns/trends?currentStart=2026-07-21&currentEnd=2026-07-20')).status).toBe(400);
  });
});
