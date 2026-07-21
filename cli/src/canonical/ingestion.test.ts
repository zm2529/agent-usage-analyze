import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { runMigrations } from '../db/migrate.js';
import {
  ingestSourceAdapter,
  readIngestionHealth,
  type CanonicalBatch,
  type SourceAdapter,
  type SourceArtifact,
} from './ingestion.js';

const artifact: SourceArtifact = {
  id: 'fixture:rollout-1',
  sourceKind: 'synthetic-codex',
  locatorHash: 'sha256:fixture-1',
  observedAt: '2026-07-21T08:00:00.000Z',
};

function fixtureBatch(): CanonicalBatch {
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
    diagnostics: [{ severity: 'info', code: 'fixture', count: 1 }],
    coverage: { discovered: 1, parsed: 1, skipped: 0, failed: 0, unknown: 0 },
    nextCursor: 'line:1',
  };
}

class FixtureAdapter implements SourceAdapter {
  readonly name = 'fixture';

  async discover(): Promise<SourceArtifact[]> {
    return [artifact];
  }

  async parse(): Promise<CanonicalBatch> {
    return fixtureBatch();
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
});
