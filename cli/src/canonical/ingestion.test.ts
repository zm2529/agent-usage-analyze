import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runMigrations } from '../db/migrate.js';
import {
  ingestSourceAdapter,
  readIngestionHealth,
  parseCanonicalBatch,
  type CanonicalBatch,
  type SourceAdapter,
  type SourceArtifact,
  type SourceCursor,
} from './ingestion.js';
import { readObserverOverhead } from './observer-overhead.js';

const artifact: SourceArtifact = {
  id: 'fixture:rollout-1',
  sourceKind: 'synthetic-codex',
  parserVersion: 'fixture-v1',
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
        payload: { status: 'started' },
        taskId: 'task-1',
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
  it('serializes concurrent ingestion runs before either can rebuild projections', async () => {
    const root = mkdtempSync(join(tmpdir(), 'agent-analytics-ingestion-'));
    const databasePath = join(root, 'data.db');
    const firstDb = new Database(databasePath);
    const secondDb = new Database(databasePath);
    runMigrations(firstDb);
    runMigrations(secondDb);
    let releaseDiscovery!: () => void;
    let firstDiscoveryStarted!: () => void;
    const firstDiscovery = new Promise<void>((resolve) => { firstDiscoveryStarted = resolve; });
    const discoveryGate = new Promise<void>((resolve) => { releaseDiscovery = resolve; });
    let secondDiscovered = false;
    const firstAdapter = new FixtureAdapter();
    firstAdapter.discover = async () => {
      firstDiscoveryStarted();
      await discoveryGate;
      return [artifact];
    };
    const secondAdapter = new FixtureAdapter();
    secondAdapter.discover = async () => {
      secondDiscovered = true;
      return [artifact];
    };

    try {
      const first = ingestSourceAdapter(firstAdapter, firstDb);
      await firstDiscovery;
      const second = ingestSourceAdapter(secondAdapter, secondDb);
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(secondDiscovered).toBe(false);

      releaseDiscovery();
      await expect(first).resolves.toMatchObject({ status: 'completed' });
      await expect(second).resolves.toMatchObject({ status: 'completed' });
      expect(secondDiscovered).toBe(true);
    } finally {
      firstDb.close();
      secondDb.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('imports a source idempotently and exposes coverage through the public health query', async () => {
    const db = new Database(':memory:');
    runMigrations(db);

    const first = await ingestSourceAdapter(new FixtureAdapter(), db);
    const second = await ingestSourceAdapter(new FixtureAdapter(), db);
    const health = readIngestionHealth(db);

    expect(first).toMatchObject({ insertedEvents: 1, advancedSources: 1 });
    expect(second).toMatchObject({ insertedEvents: 0, advancedSources: 1 });
    expect(readObserverOverhead(db)).toMatchObject({
      eventCount: 2,
      byCategory: [{ category: 'import', eventCount: 2 }],
    });
    expect(health).toEqual({
      status: 'completed',
      diagnostics: [{ severity: 'info', code: 'fixture', count: 1 }],
      coverage: { discovered: 1, parsed: 1, skipped: 0, failed: 0, unknown: 0 },
      eventCount: 1,
      sourceCount: 1,
      processedSources: 1,
      startedAt: expect.any(String),
      completedAt: expect.any(String),
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

  it('does not let observer ledger failure change a completed import result', async () => {
    const db = new Database(':memory:');
    runMigrations(db);
    db.exec(`CREATE TRIGGER observer_insert_failure BEFORE INSERT ON observer_overhead_events
      BEGIN SELECT RAISE(ABORT, 'observer ledger unavailable'); END;`);

    await expect(ingestSourceAdapter(new FixtureAdapter(), db)).resolves.toMatchObject({ status: 'completed' });
    expect(db.prepare('SELECT status FROM ingestion_runs').get()).toEqual({ status: 'completed' });
    expect(readObserverOverhead(db)).toMatchObject({
      degraded: true,
      diagnostics: [{ category: 'import', code: 'observer-write-failed' }],
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

  it('rejects unknown payload fields, short raw text, and malformed optional fields', async () => {
    const invalidPayloads: Array<Record<string, unknown>> = [
      { claim: 'user caused delay' },
      { text: 'secret' },
    ];
    for (const payload of invalidPayloads) {
      const db = new Database(':memory:');
      runMigrations(db);
      const adapter = new FixtureAdapter();
      adapter.parse = async (_artifact, context) => {
        const batch = fixtureBatch(context.currentCursor);
        batch.events[0]!.payload = payload;
        return batch;
      };
      await expect(ingestSourceAdapter(adapter, db)).rejects.toThrow(/payload/i);
      expect(readIngestionHealth(db).eventCount).toBe(0);
      db.close();
    }

    const db = new Database(':memory:');
    runMigrations(db);
    const adapter = new FixtureAdapter();
    adapter.parse = async (_artifact, context) => {
      const batch = fixtureBatch(context.currentCursor);
      batch.events[0]!.repository = { root: 42 as unknown as string };
      return batch;
    };
    await expect(ingestSourceAdapter(adapter, db)).rejects.toThrow(/repository/i);
    db.close();
  });

  it('records discovery failure as the newest failed health state', async () => {
    const db = new Database(':memory:');
    runMigrations(db);
    await ingestSourceAdapter(new FixtureAdapter(), db);
    const failing = new FixtureAdapter();
    failing.discover = async () => { throw new Error('discovery unavailable'); };

    await expect(ingestSourceAdapter(failing, db)).rejects.toThrow('discovery unavailable');
    expect(readIngestionHealth(db)).toMatchObject({
      status: 'failed',
      diagnostics: [{ severity: 'error', code: 'ingestion-failed', count: 1 }],
    });
    db.close();
  });

  it('treats parser version as part of immutable source identity', async () => {
    const db = new Database(':memory:');
    runMigrations(db);
    await ingestSourceAdapter(new FixtureAdapter(), db);
    const changed = new FixtureAdapter();
    const changedArtifact = { ...artifact, parserVersion: 'fixture-v2' };
    changed.discover = async () => [changedArtifact];
    changed.parse = async (_artifact, context) => ({
      ...fixtureBatch(context.currentCursor),
      artifact: changedArtifact,
      era: { ...fixtureBatch(context.currentCursor).era, parserVersion: 'fixture-v2' },
    });

    await expect(ingestSourceAdapter(changed, db)).rejects.toThrow(/immutable source identity/i);
    db.close();
  });

  it('requires one parser version within a canonical batch', async () => {
    const db = new Database(':memory:');
    runMigrations(db);
    const adapter = new FixtureAdapter();
    adapter.parse = async (_artifact, context) => ({
      ...fixtureBatch(context.currentCursor),
      era: { ...fixtureBatch(context.currentCursor).era, parserVersion: 'fixture-v2' },
    });
    await expect(ingestSourceAdapter(adapter, db)).rejects.toThrow(/parser versions must match/i);
    db.close();
  });

  it('requires a new observation era when collection capabilities change', async () => {
    const db = new Database(':memory:');
    runMigrations(db);
    await ingestSourceAdapter(new FixtureAdapter(), db);
    const changed = new FixtureAdapter();
    changed.parse = async (_artifact, context) => ({
      ...fixtureBatch(context.currentCursor),
      era: { ...fixtureBatch(context.currentCursor).era, capabilities: ['canonical-event', 'hook'] },
    });

    await expect(ingestSourceAdapter(changed, db)).rejects.toThrow(/observation era identity/i);
    expect(db.prepare('SELECT COUNT(*) AS count FROM observation_eras').get()).toEqual({ count: 1 });
    db.close();
  });

  it('closes the historical era when a new continuous collection era starts', async () => {
    const db = new Database(':memory:');
    runMigrations(db);
    await ingestSourceAdapter(new FixtureAdapter(), db);
    const continuousArtifact: SourceArtifact = {
      ...artifact, id: 'fixture:hook-1', sourceKind: 'codex-hook', locatorHash: 'sha256:hook-1',
      observedAt: '2026-07-21T09:00:00.000Z',
    };
    const continuous = new FixtureAdapter();
    continuous.discover = async () => [continuousArtifact];
    continuous.parse = async (_artifact, context) => ({
      ...fixtureBatch(context.currentCursor),
      artifact: continuousArtifact,
      era: {
        id: 'era:continuous-hook-v1', name: 'Continuous hook', mode: 'continuous-observation',
        parserVersion: 'fixture-v1', capabilities: ['canonical-event', 'hook'],
        startsAt: '2026-07-21T09:00:00.000Z',
      },
      events: fixtureBatch(context.currentCursor).events.map((event) => ({
        ...event, id: 'event:hook:0', nativeEventId: 'hook:0', occurredAt: '2026-07-21T09:00:00.000Z',
      })),
      nextCursor: { token: 'hook:1', position: 1 },
    });

    await ingestSourceAdapter(continuous, db);
    expect(db.prepare(`SELECT id, mode, starts_at AS startsAt, ends_at AS endsAt
      FROM observation_eras ORDER BY starts_at`).all()).toEqual([
      {
        id: 'era:historical-fixture-v1', mode: 'historical-backfill',
        startsAt: '2026-07-21T08:00:00.000Z', endsAt: '2026-07-21T09:00:00.000Z',
      },
      {
        id: 'era:continuous-hook-v1', mode: 'continuous-observation',
        startsAt: '2026-07-21T09:00:00.000Z', endsAt: null,
      },
    ]);
    db.close();
  });

  it('rejects an ambiguous empty cursor token', () => {
    const batch = fixtureBatch();
    batch.nextCursor = { token: '', position: 0 };
    expect(() => parseCanonicalBatch(batch)).toThrow(/valid previousCursor and nextCursor/i);
  });

  it('rejects narrative structural values and unregistered diagnostic codes', async () => {
    const db = new Database(':memory:');
    runMigrations(db);
    const narrative = new FixtureAdapter();
    narrative.parse = async (_artifact, context) => {
      const batch = fixtureBatch(context.currentCursor);
      batch.events[0]!.payload = { status: 'score-95' } as never;
      return batch;
    };
    await expect(ingestSourceAdapter(narrative, db)).rejects.toThrow(/allowed structural value/i);

    const diagnostic = new FixtureAdapter();
    diagnostic.parse = async (_artifact, context) => {
      const batch = fixtureBatch(context.currentCursor);
      batch.diagnostics = [{ severity: 'warning', code: 'sensitive-sentinel', count: 1 } as never];
      return batch;
    };
    await expect(ingestSourceAdapter(diagnostic, db)).rejects.toThrow(/diagnostic/i);
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

  it('rejects a conflicting duplicate event without advancing the cursor', async () => {
    const db = new Database(':memory:');
    runMigrations(db);
    await ingestSourceAdapter(new FixtureAdapter(), db);
    const conflicting = new FixtureAdapter();
    conflicting.parse = async (_artifact, context) => {
      const batch = fixtureBatch(context.currentCursor);
      batch.events[0]!.payload = { status: 'running' };
      batch.nextCursor = { token: 'line:2', position: 2 };
      return batch;
    };

    await expect(ingestSourceAdapter(conflicting, db)).rejects.toThrow(/event identity conflict/i);
    expect(db.prepare('SELECT cursor_position AS position FROM source_artifacts').get())
      .toEqual({ position: 1 });
    expect(db.prepare('SELECT payload_json AS payload FROM canonical_events').get())
      .toEqual({ payload: '{"status":"started"}' });
    db.close();
  });

  it('surfaces conflicting task parents as a safe ingestion diagnostic', async () => {
    const db = new Database(':memory:');
    runMigrations(db);
    const adapter = new FixtureAdapter();
    adapter.parse = async (_artifact, context) => {
      const batch = fixtureBatch(context.currentCursor);
      batch.identityEdges = [
        { kind: 'root-child', fromId: 'parent-a', toId: 'child' },
        { kind: 'root-child', fromId: 'parent-b', toId: 'child' },
      ];
      return batch;
    };
    await expect(ingestSourceAdapter(adapter, db)).rejects.toThrow(/more than one parent/i);
    expect(readIngestionHealth(db)).toMatchObject({
      status: 'failed',
      diagnostics: expect.arrayContaining([
        { severity: 'error', code: 'identity-conflict', count: 1 },
      ]),
    });
    db.close();
  });
});
