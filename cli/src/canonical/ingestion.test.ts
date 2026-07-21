import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { runMigrations } from '../db/migrate.js';
import {
  ingestSourceAdapter,
  readIngestionHealth,
  type CanonicalBatch,
  type SourceAdapter,
  type SourceArtifact,
  type SourceCursor,
} from './ingestion.js';

const artifact: SourceArtifact = {
  id: 'fixture:rollout-1',
  sourceKind: 'synthetic-codex',
  locatorHash: 'sha256:fixture-1',
  observedAt: '2026-07-21T08:00:00.000Z',
};

function fixtureBatch(previousCursor: SourceCursor | null = null): CanonicalBatch {
  return {
    artifact,
    era: {
      id: 'era:historical-fixture-v1',
      name: 'Historical fixture',
      mode: 'historical-backfill',
      parserVersion: 'fixture-v1',
      capabilities: ['canonical-event'],
      startsAt: '2026-07-21T08:00:00.000Z',
    },
    events: [
      {
        id: 'event:fixture-1:0',
        nativeEventId: '0',
        sequence: 0,
        occurredAt: '2026-07-21T08:00:00.000Z',
        kind: 'task-started',
        actor: 'system',
        sensitivity: 'structural',
        payload: { taskId: 'task-1' },
      },
    ],
    identityEdges: [],
    diagnostics: [{ severity: 'info', code: 'fixture', count: 1 }],
    coverage: { discovered: 1, parsed: 1, skipped: 0, failed: 0, unknown: 0 },
    previousCursor,
    nextCursor: { token: 'line:1', position: 1 },
  };
}

class FixtureAdapter implements SourceAdapter {
  readonly name = 'fixture';

  async discover(): Promise<SourceArtifact[]> {
    return [artifact];
  }

  async parse(_artifact: SourceArtifact, context: { currentCursor: SourceCursor | null }): Promise<CanonicalBatch> {
    return fixtureBatch(context.currentCursor);
  }
}

describe('canonical ingestion', () => {
  it('imports a source idempotently and exposes coverage through the public health query', async () => {
    const db = new Database(':memory:');
    runMigrations(db);

    const first = await ingestSourceAdapter(new FixtureAdapter(), db);
    const second = await ingestSourceAdapter(new FixtureAdapter(), db);
    const health = readIngestionHealth(db);

    expect(first).toMatchObject({ insertedEvents: 1, advancedSources: 1 });
    expect(second).toMatchObject({ insertedEvents: 0, advancedSources: 1 });
    expect(health).toEqual({
      status: 'completed',
      diagnostics: [{ severity: 'info', code: 'fixture', count: 1 }],
      coverage: { discovered: 1, parsed: 1, skipped: 0, failed: 0, unknown: 0 },
      eventCount: 1,
      sourceCount: 1,
      eras: [
        {
          id: 'era:historical-fixture-v1',
          mode: 'historical-backfill',
          parserVersion: 'fixture-v1',
        },
      ],
    });

    db.close();
  });

  it('rejects analysis or causal fields at the canonical boundary', async () => {
    const db = new Database(':memory:');
    runMigrations(db);
    const adapter = new FixtureAdapter();
    adapter.parse = async (_artifact, context) => {
      const batch = fixtureBatch(context.currentCursor);
      batch.events[0]!.payload = { score: 95, causalConclusion: 'user caused delay' };
      return batch;
    };

    await expect(ingestSourceAdapter(adapter, db)).rejects.toThrow(/analysis or causal/i);
    expect(readIngestionHealth(db).eventCount).toBe(0);
    db.close();
  });

  it('does not let a stale batch move a source cursor backwards', async () => {
    const db = new Database(':memory:');
    runMigrations(db);
    await ingestSourceAdapter(new FixtureAdapter(), db);
    const stale = new FixtureAdapter();
    stale.parse = async () => fixtureBatch(null);

    await expect(ingestSourceAdapter(stale, db)).rejects.toThrow(/stale source cursor/i);
    expect(readIngestionHealth(db).eventCount).toBe(1);
    db.close();
  });

  it('reports the newest failed run and its diagnostic instead of stale health', async () => {
    const db = new Database(':memory:');
    runMigrations(db);
    await ingestSourceAdapter(new FixtureAdapter(), db);
    const failing = new FixtureAdapter();
    failing.parse = async () => { throw new Error('broken fixture'); };

    await ingestSourceAdapter(failing, db);
    const health = readIngestionHealth(db);

    expect(health.status).toBe('failed');
    expect(health.diagnostics).toEqual([
      { severity: 'error', code: 'adapter-parse-failed', count: 1 },
    ]);
    db.close();
  });

  it('rejects a changed source body under an existing immutable identity', async () => {
    const db = new Database(':memory:');
    runMigrations(db);
    const firstArtifact = { ...artifact, contentHash: 'sha256:first' };
    const first = new FixtureAdapter();
    first.discover = async () => [firstArtifact];
    first.parse = async (_artifact, context) => ({
      ...fixtureBatch(context.currentCursor),
      artifact: firstArtifact,
    });
    await ingestSourceAdapter(first, db);

    const changedArtifact = { ...artifact, contentHash: 'sha256:changed' };
    const changed = new FixtureAdapter();
    changed.discover = async () => [changedArtifact];
    changed.parse = async (_artifact, context) => ({
      ...fixtureBatch(context.currentCursor),
      artifact: changedArtifact,
    });

    await expect(ingestSourceAdapter(changed, db)).rejects.toThrow(/immutable source identity/i);
    expect(readIngestionHealth(db).eventCount).toBe(1);
    db.close();
  });
});
