import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { closeDb } from '@agent-analytics/cli/db/client';
import { createApp } from '../index.js';

let dataDir: string;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'agent-analytics-git-ai-api-'));
  process.env.AGENT_ANALYTICS_CONFIG_DIR = dataDir;
});

afterEach(() => {
  closeDb();
  delete process.env.AGENT_ANALYTICS_CONFIG_DIR;
  rmSync(dataDir, { recursive: true, force: true });
});

describe('Git AI sidecar API', () => {
  it('reports pinned source, local Notes policy, and disabled consumption before a gate', async () => {
    const response = await createApp().request('/api/git-ai-sidecar');

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: 'disabled', gatePassed: false, configured: false, configuredEnabled: false,
      binaryHealthy: false, binaryVersion: null,
      consumptionEnabled: false, sourceVersion: '1.6.16',
      sourceCommit: 'da79071f21f3b018aa7d4ee4e7d5fa8bf3555a88',
      notesSchema: 'authorship/3.0.0', notesExportPolicy: 'local-only',
      automaticRepositoryMutation: false, latestRun: null, stateError: null,
    });
  });
});
