import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { closeDb } from 'agent-usage-analyze/db/client';
import { createApp } from '../index.js';

let dataDir: string;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'agent-analytics-buildermark-api-'));
  process.env.AGENT_ANALYTICS_CONFIG_DIR = dataDir;
});

afterEach(() => {
  closeDb();
  delete process.env.AGENT_ANALYTICS_CONFIG_DIR;
  rmSync(dataDir, { recursive: true, force: true });
});

describe('Buildermark helper gate API', () => {
  it('reports an explicit disabled state before any isolated gate has run', async () => {
    const response = await createApp().request('/api/buildermark-gate');

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: 'disabled', candidateEnabled: false, latestRun: null,
      realGatePassed: false, syntheticGatePassed: false, stateError: null,
    });
  });
});
