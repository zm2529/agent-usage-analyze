import Database from 'better-sqlite3';
import { describe, expect, it, vi } from 'vitest';
import { runMigrations } from '../db/schema.js';
import { processSettledImport, type SettledImportDependencies } from './settled-import.js';
import { recordSettledFrontier } from './settled-frontier.js';

function database(): Database.Database {
  const db = new Database(':memory:');
  runMigrations(db);
  db.prepare(`INSERT INTO analysis_queue (
    source_tool, session_id, status, runner_type, latest_turn_id, generation,
    transcript_locator, source_basis, not_before
  ) VALUES ('codex-cli', 'session', 'processing', 'auto', 'turn-1', 1,
    '/codex/session.jsonl', 'hook-basis', '2026-07-22T03:00:00.000Z')`).run();
  return db;
}

function dependencies(overrides: Partial<SettledImportDependencies> = {}): SettledImportDependencies {
  const commit = vi.fn();
  return {
    now: () => new Date('2026-07-22T03:01:00.000Z'),
    idleSeconds: 90,
    locate: () => ({ path: '/safe/session.jsonl', locatorAccepted: true, diagnostic: null }),
    contentBasis: vi.fn(() => 'rollout-sha256:stable'),
    ingest: vi.fn(async () => ({ complete: true, diagnostic: null })),
    prepareProjection: vi.fn(async () => ({ complete: true, diagnostic: null, commit })),
    invalidateProjection: vi.fn(),
    execution: { effectiveRunner: 'local-only', reason: 'explicit-local-only' },
    ...overrides,
  };
}

describe('processSettledImport', () => {
  it('short-circuits an explicit off policy before touching source data', async () => {
    const db = database();
    const deps = dependencies({ execution: { effectiveRunner: 'off', reason: 'explicit-off' } });

    expect(await processSettledImport(db, {
      sourceTool: 'codex-cli', sessionId: 'session', generation: 1,
      locator: null, sourceBasis: 'hook-basis',
    }, deps)).toEqual({ status: 'completed', diagnostic: 'explicit-off' });
    expect(deps.ingest).not.toHaveBeenCalled();
    expect(deps.prepareProjection).not.toHaveBeenCalled();
    db.close();
  });

  it('imports canonical plus compatibility projections and completes local-only without a model', async () => {
    const db = database();
    const deps = dependencies();
    const result = await processSettledImport(db, {
      sourceTool: 'codex-cli', sessionId: 'session', generation: 1,
      locator: '/codex/session.jsonl', sourceBasis: 'hook-basis',
    }, deps);

    expect(result).toEqual({ status: 'completed', diagnostic: 'explicit-local-only' });
    expect(deps.ingest).toHaveBeenCalledOnce();
    expect(deps.prepareProjection).toHaveBeenCalledWith('/safe/session.jsonl');
    expect((await vi.mocked(deps.prepareProjection).mock.results[0]!.value).commit).toHaveBeenCalledOnce();
    expect(db.prepare(`SELECT status, source_basis, diagnostic FROM analysis_queue`).get()).toEqual({
      status: 'completed', source_basis: 'rollout-sha256:stable', diagnostic: 'explicit-local-only',
    });
    db.close();
  });

  it('re-settles with a new generation when the source grows during import', async () => {
    const db = database();
    db.prepare(`UPDATE analysis_queue SET attempt_count = 2, error_message = 'older failure'`).run();
    const contentBasis = vi.fn()
      .mockReturnValueOnce('rollout-sha256:before')
      .mockReturnValueOnce('rollout-sha256:after');
    const commit = vi.fn();
    const deps = dependencies({
      contentBasis,
      prepareProjection: vi.fn(async () => ({ complete: true, diagnostic: null, commit })),
    });
    const result = await processSettledImport(db, {
      sourceTool: 'codex-cli', sessionId: 'session', generation: 1,
      locator: null, sourceBasis: 'hook-basis',
    }, deps);

    expect(result.status).toBe('settling');
    expect(commit).not.toHaveBeenCalled();
    expect(deps.invalidateProjection).toHaveBeenCalledOnce();
    expect(db.prepare(`SELECT status, generation, source_basis, not_before, diagnostic,
      attempt_count, error_message FROM analysis_queue`).get())
      .toEqual({
        status: 'settling', generation: 2, source_basis: 'rollout-sha256:after',
        not_before: '2026-07-22T03:02:30.000Z', diagnostic: 'source-grew-during-import',
        attempt_count: 0, error_message: null,
      });
    db.close();
  });

  it('does not overwrite a newer turn that arrives while import is running', async () => {
    const db = database();
    const ingest = vi.fn(async () => {
      recordSettledFrontier(db, {
        source: 'codex-cli', sessionId: 'session', turnId: 'turn-2', basis: 'new-hook-basis',
      }, new Date('2026-07-22T03:01:10.000Z'), 90);
      return { complete: true, diagnostic: null };
    });
    const deps = dependencies({ ingest });
    const result = await processSettledImport(db, {
      sourceTool: 'codex-cli', sessionId: 'session', generation: 1,
      locator: null, sourceBasis: 'hook-basis',
    }, deps);

    expect(result.status).toBe('stale');
    expect(deps.invalidateProjection).toHaveBeenCalledOnce();
    expect(db.prepare(`SELECT status, generation, latest_turn_id FROM analysis_queue`).get())
      .toEqual({ status: 'settling', generation: 2, latest_turn_id: 'turn-2' });
    db.close();
  });

  it('does not commit a prepared projection when a newer turn arrives during projection parsing', async () => {
    const db = database();
    const commit = vi.fn();
    const prepareProjection = vi.fn(async () => {
      recordSettledFrontier(db, {
        source: 'codex-cli', sessionId: 'session', turnId: 'turn-2', basis: 'new-hook-basis',
      }, new Date('2026-07-22T03:01:10.000Z'), 90);
      return { complete: true, diagnostic: null, commit };
    });

    const deps = dependencies({ prepareProjection });
    expect((await processSettledImport(db, {
      sourceTool: 'codex-cli', sessionId: 'session', generation: 1,
      locator: null, sourceBasis: 'hook-basis',
    }, deps)).status).toBe('stale');
    expect(commit).not.toHaveBeenCalled();
    expect(deps.invalidateProjection).toHaveBeenCalledOnce();
    db.close();
  });

  it('rolls back projection writes when the source grows during their commit', async () => {
    const db = database();
    db.exec('CREATE TABLE projection_marker (value TEXT NOT NULL)');
    const contentBasis = vi.fn()
      .mockReturnValueOnce('rollout-sha256:before')
      .mockReturnValueOnce('rollout-sha256:before')
      .mockReturnValueOnce('rollout-sha256:after');
    const commit = () => db.prepare(`INSERT INTO projection_marker (value) VALUES ('old')`).run();

    const invalidateProjection = vi.fn();
    expect((await processSettledImport(db, {
      sourceTool: 'codex-cli', sessionId: 'session', generation: 1,
      locator: null, sourceBasis: 'hook-basis',
    }, dependencies({
      contentBasis,
      prepareProjection: vi.fn(async () => ({ complete: true, diagnostic: null, commit })),
      invalidateProjection,
    }))).status).toBe('settling');
    expect(db.prepare('SELECT COUNT(*) AS count FROM projection_marker').get()).toEqual({ count: 0 });
    expect(db.prepare(`SELECT generation, source_basis FROM analysis_queue`).get()).toEqual({
      generation: 2, source_basis: 'rollout-sha256:after',
    });
    expect(invalidateProjection).toHaveBeenCalledOnce();
    db.close();
  });

  it('bounds unavailable-source retries before awaiting manual capability recovery', async () => {
    const db = database();
    db.prepare(`UPDATE analysis_queue SET max_attempts = 2`).run();
    const deps = dependencies({
      locate: () => ({ path: null, locatorAccepted: false, diagnostic: 'source-not-found' }),
    });
    const claim = {
      sourceTool: 'codex-cli', sessionId: 'session', generation: 1,
      locator: null, sourceBasis: 'hook-basis',
    };

    expect(await processSettledImport(db, claim, deps)).toEqual({
      status: 'settling', diagnostic: 'source-not-found',
    });
    expect(db.prepare(`SELECT attempt_count, not_before FROM analysis_queue`).get()).toEqual({
      attempt_count: 1, not_before: '2026-07-22T03:02:30.000Z',
    });
    db.prepare(`UPDATE analysis_queue SET status = 'processing'`).run();
    expect(await processSettledImport(db, claim, deps)).toEqual({
      status: 'awaiting-capability', diagnostic: 'source-not-found',
    });
    expect(db.prepare(`SELECT status, attempt_count FROM analysis_queue`).get()).toEqual({
      status: 'awaiting-capability', attempt_count: 2,
    });
    db.close();
  });

  it('waits with diagnostics and never projects an unavailable or incomplete source', async () => {
    const db = database();
    const missing = dependencies({
      locate: () => ({ path: null, locatorAccepted: false, diagnostic: 'source-not-found' }),
    });
    expect(await processSettledImport(db, {
      sourceTool: 'codex-cli', sessionId: 'session', generation: 1, locator: null, sourceBasis: 'hook-basis',
    }, missing)).toEqual({ status: 'settling', diagnostic: 'source-not-found' });
    expect(missing.ingest).not.toHaveBeenCalled();
    expect(missing.prepareProjection).not.toHaveBeenCalled();
    expect(missing.invalidateProjection).toHaveBeenCalledOnce();

    db.prepare(`UPDATE analysis_queue SET status = 'processing', diagnostic = NULL`).run();
    const incomplete = dependencies({ ingest: vi.fn(async () => ({ complete: false, diagnostic: 'truncated-tail' })) });
    expect(await processSettledImport(db, {
      sourceTool: 'codex-cli', sessionId: 'session', generation: 1, locator: null, sourceBasis: 'hook-basis',
    }, incomplete)).toEqual({ status: 'settling', diagnostic: 'truncated-tail' });
    expect(incomplete.prepareProjection).not.toHaveBeenCalled();
    expect(incomplete.invalidateProjection).toHaveBeenCalledOnce();
    db.close();
  });

  it('retains a rejected locator diagnostic after a successful fallback import', async () => {
    const db = database();
    const result = await processSettledImport(db, {
      sourceTool: 'codex-cli', sessionId: 'session', generation: 1,
      locator: '/unsafe/session.jsonl', sourceBasis: 'hook-basis',
    }, dependencies({
      locate: () => ({
        path: '/safe/session.jsonl', locatorAccepted: false,
        diagnostic: 'locator-outside-supported-roots',
      }),
    }));

    expect(result).toEqual({
      status: 'completed', diagnostic: 'locator-outside-supported-roots;explicit-local-only',
    });
    expect(db.prepare(`SELECT diagnostic FROM analysis_queue`).get()).toEqual({
      diagnostic: 'locator-outside-supported-roots;explicit-local-only',
    });
    db.close();
  });
});
