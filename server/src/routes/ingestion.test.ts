import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { closeDb, getDb } from '@agent-analytics/cli/db/client';
import {
  ingestSourceAdapter,
  type CanonicalBatch,
  type SourceAdapter,
  type SourceArtifact,
} from '@agent-analytics/cli/canonical/ingestion';
import { createApp } from '../index.js';

let dataDir: string;

const artifact: SourceArtifact = {
  id: 'fixture:api',
  sourceKind: 'synthetic-codex',
  locatorHash: 'sha256:api',
  observedAt: '2026-07-21T09:00:00.000Z',
};

class ApiFixtureAdapter implements SourceAdapter {
  readonly name = 'api-fixture';

  async discover(): Promise<SourceArtifact[]> {
    return [artifact];
  }

  async parse(): Promise<CanonicalBatch> {
    return {
      artifact,
      era: {
        id: 'era:api',
        name: 'API fixture',
        mode: 'historical-backfill',
        parserVersion: 'api-v1',
        capabilities: ['canonical-event'],
        startsAt: artifact.observedAt,
      },
      events: [{
        id: 'event:api:0', nativeEventId: '0', sequence: 0,
        occurredAt: artifact.observedAt, kind: 'task-started', actor: 'system',
        sensitivity: 'structural', payload: {},
      }],
      identityEdges: [],
      diagnostics: [],
      coverage: { discovered: 1, parsed: 1, skipped: 0, failed: 0, unknown: 0 },
      previousCursor: null,
      nextCursor: { token: 'line:1', position: 1 },
    };
  }
}

describe('GET /api/ingestion/health', () => {
  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'agent-analytics-api-'));
    process.env.AGENT_ANALYTICS_CONFIG_DIR = dataDir;
  });

  afterEach(() => {
    closeDb();
    delete process.env.AGENT_ANALYTICS_CONFIG_DIR;
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('returns canonical coverage and observation eras', async () => {
    await ingestSourceAdapter(new ApiFixtureAdapter(), getDb());

    const response = await createApp().request('/api/ingestion/health');

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: 'completed',
      diagnostics: [],
      coverage: { discovered: 1, parsed: 1, skipped: 0, failed: 0, unknown: 0 },
      eventCount: 1,
      sourceCount: 1,
      eras: [{ id: 'era:api', mode: 'historical-backfill', parserVersion: 'api-v1' }],
    });
  });

  it('returns the newest failed run instead of stale successful health', async () => {
    await ingestSourceAdapter(new ApiFixtureAdapter(), getDb());
    const failing = new ApiFixtureAdapter();
    failing.parse = async () => { throw new Error('raw private failure detail'); };
    await ingestSourceAdapter(failing, getDb());

    const response = await createApp().request('/api/ingestion/health');
    const body = await response.json() as {
      status: string;
      diagnostics: Array<{ severity: string; code: string; count: number }>;
    };

    expect(body.status).toBe('failed');
    expect(body.diagnostics).toEqual([
      { severity: 'error', code: 'adapter-parse-failed', count: 1 },
    ]);
    expect(JSON.stringify(body)).not.toContain('raw private failure detail');
  });
});
