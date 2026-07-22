import Database from 'better-sqlite3';
import { describe, expect, it, vi } from 'vitest';
import { StaleAnalysisGenerationError } from '../commands/insights.js';
import { runMigrations } from '../db/schema.js';
import type { AnalysisRunner } from './runner-types.js';
import { processSettledAnalysis, type SettledAnalysisDependencies } from './settled-analysis.js';

function setup(): Database.Database {
  const db = new Database(':memory:');
  runMigrations(db);
  db.prepare(`INSERT INTO analysis_queue
    (source_tool, session_id, status, runner_type, generation, diagnostic)
    VALUES ('codex-cli', 'native-session', 'awaiting-capability', 'auto', 4, 'codex-chatgpt-auth')`).run();
  return db;
}

const runner: AnalysisRunner = { name: 'codex-native', runAnalysis: vi.fn() };

describe('processSettledAnalysis', () => {
  it('claims the imported generation, analyzes its compatibility session, and completes it', async () => {
    const db = setup();
    const analyze = vi.fn(async (
      sessionId: string, selected: AnalysisRunner, guard: () => boolean, finalize: () => boolean,
    ) => {
      expect(sessionId).toBe('codex:native-session');
      expect(selected).toBe(runner);
      expect(guard()).toBe(true);
      expect(finalize()).toBe(true);
    });
    const deps: SettledAnalysisDependencies = {
      now: () => new Date('2026-07-22T06:00:00.000Z'),
      buildRunner: () => runner,
      analyze,
    };

    await expect(processSettledAnalysis(db, {
      sourceTool: 'codex-cli', sessionId: 'native-session', generation: 4,
      locator: null, sourceBasis: null,
    }, { effectiveRunner: 'codex-native', reason: 'codex-chatgpt-auth' }, deps))
      .resolves.toEqual({ status: 'completed', diagnostic: 'codex-chatgpt-auth' });
    expect(analyze).toHaveBeenCalledOnce();
    expect(db.prepare(`SELECT status, completed_at AS completedAt, diagnostic
      FROM analysis_queue`).get()).toEqual({
      status: 'completed', completedAt: '2026-07-22T06:00:00.000Z', diagnostic: 'codex-chatgpt-auth',
    });
    db.close();
  });

  it('lets a newer Stop generation win without persisting or retrying the stale result', async () => {
    const db = setup();
    const deps: SettledAnalysisDependencies = {
      now: () => new Date('2026-07-22T06:00:00.000Z'),
      buildRunner: () => runner,
      analyze: async (_sessionId, _runner, guard, _finalize) => {
        db.prepare(`UPDATE analysis_queue SET generation = 5, status = 'settling',
          not_before = '2026-07-22T06:01:30.000Z' WHERE session_id = 'native-session'`).run();
        expect(guard()).toBe(false);
        throw new StaleAnalysisGenerationError();
      },
    };

    await expect(processSettledAnalysis(db, {
      sourceTool: 'codex-cli', sessionId: 'native-session', generation: 4,
      locator: null, sourceBasis: null,
    }, { effectiveRunner: 'codex-native', reason: 'codex-chatgpt-auth' }, deps))
      .resolves.toEqual({ status: 'stale', diagnostic: null });
    expect(db.prepare(`SELECT generation, status FROM analysis_queue`).get())
      .toEqual({ generation: 5, status: 'settling' });
    db.close();
  });

  it('rolls back old-generation insights when completion loses its compare-and-swap', async () => {
    const db = setup();
    db.exec('CREATE TABLE result_marker (value TEXT NOT NULL)');
    const deps: SettledAnalysisDependencies = {
      now: () => new Date('2026-07-22T06:00:00.000Z'),
      buildRunner: () => runner,
      analyze: async (_sessionId, _runner, _guard, finalize) => {
        db.transaction(() => {
          db.prepare(`INSERT INTO result_marker (value) VALUES ('old-result')`).run();
          db.prepare(`UPDATE analysis_queue SET generation = 5, status = 'settling'
            WHERE session_id = 'native-session'`).run();
          if (!finalize()) throw new StaleAnalysisGenerationError();
        }).immediate();
      },
    };

    await expect(processSettledAnalysis(db, {
      sourceTool: 'codex-cli', sessionId: 'native-session', generation: 4,
      locator: null, sourceBasis: null,
    }, { effectiveRunner: 'codex-native', reason: 'codex-chatgpt-auth' }, deps))
      .resolves.toEqual({ status: 'stale', diagnostic: null });
    expect(db.prepare(`SELECT COUNT(*) AS count FROM result_marker WHERE value = 'old-result'`).get())
      .toEqual({ count: 0 });
    db.close();
  });

  it('leaves unavailable capability awaiting without constructing a runner', async () => {
    const db = setup();
    const buildRunner = vi.fn();
    const analyze = vi.fn();
    await expect(processSettledAnalysis(db, {
      sourceTool: 'codex-cli', sessionId: 'native-session', generation: 4,
      locator: null, sourceBasis: null,
    }, { effectiveRunner: 'unavailable', reason: 'codex-not-logged-in' }, {
      now: () => new Date(), buildRunner, analyze,
    })).resolves.toEqual({ status: 'awaiting-capability', diagnostic: 'codex-not-logged-in' });
    await expect(processSettledAnalysis(db, {
      sourceTool: 'codex-cli', sessionId: 'native-session', generation: 4,
      locator: null, sourceBasis: null,
    }, { effectiveRunner: 'unavailable', reason: 'codex-not-logged-in' }, {
      now: () => new Date(), buildRunner, analyze,
    })).resolves.toEqual({ status: 'awaiting-capability', diagnostic: 'codex-not-logged-in' });
    expect(buildRunner).not.toHaveBeenCalled();
    expect(analyze).not.toHaveBeenCalled();
    expect(db.prepare(`SELECT status FROM analysis_queue`).get()).toEqual({ status: 'awaiting-capability' });
    db.close();
  });
});
