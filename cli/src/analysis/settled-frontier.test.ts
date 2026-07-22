import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import { runMigrations } from '../db/schema.js';
import { recordSettledFrontier } from './settled-frontier.js';

describe('recordSettledFrontier', () => {
  it('deduplicates one turn and advances a later turn for the same source session', () => {
    const db = new Database(':memory:');
    runMigrations(db);
    const event = { source: 'codex-cli', sessionId: 'session-1', turnId: 'turn-1', locator: '/codex/session.jsonl' };
    const first = recordSettledFrontier(db, event, new Date('2026-07-22T03:00:00Z'), 90);
    const duplicate = recordSettledFrontier(db, event, new Date('2026-07-22T03:00:10Z'), 90);
    const next = recordSettledFrontier(db, { ...event, turnId: 'turn-2' }, new Date('2026-07-22T03:00:20Z'), 90);

    expect(first).toMatchObject({ generation: 1, status: 'settling' });
    expect(duplicate).toMatchObject({ generation: 1, notBefore: first.notBefore });
    expect(next).toMatchObject({ generation: 2, latestTurnId: 'turn-2', notBefore: '2026-07-22T03:01:50.000Z' });
    db.close();
  });

  it('isolates identical session ids from different sources', () => {
    const db = new Database(':memory:');
    runMigrations(db);
    recordSettledFrontier(db, { source: 'codex-cli', sessionId: 'same', turnId: 'c1' }, new Date(0), 90);
    recordSettledFrontier(db, { source: 'claude-code', sessionId: 'same', turnId: 'a1' }, new Date(0), 90);
    expect(db.prepare('SELECT COUNT(*) AS count FROM analysis_queue').get()).toEqual({ count: 2 });
    db.close();
  });

  it('advances the same turn only when its source basis changes', () => {
    const db = new Database(':memory:');
    runMigrations(db);
    const event = { source: 'codex-cli', sessionId: 'session', turnId: 'turn', basis: 'basis-1' };
    recordSettledFrontier(db, event, new Date(0), 90);
    expect(recordSettledFrontier(db, event, new Date(1_000), 90).generation).toBe(1);
    expect(recordSettledFrontier(db, { ...event, basis: 'basis-2' }, new Date(2_000), 90))
      .toMatchObject({ generation: 2, notBefore: '1970-01-01T00:01:32.000Z' });
    db.close();
  });

  it('ignores an exact replay even after a newer turn became current', () => {
    const db = new Database(':memory:');
    runMigrations(db);
    const first = { source: 'codex-cli', sessionId: 'session', turnId: 'turn-1', basis: 'basis-1' };
    recordSettledFrontier(db, first, new Date(0), 90);
    recordSettledFrontier(db, { ...first, turnId: 'turn-2', basis: 'basis-2' }, new Date(1_000), 90);
    expect(recordSettledFrontier(db, first, new Date(2_000), 90)).toMatchObject({
      latestTurnId: 'turn-2', generation: 2, notBefore: '1970-01-01T00:01:31.000Z',
    });
    db.close();
  });

  it('increments from the database current generation when another writer wins the race', () => {
    const dir = mkdtempSync(join(tmpdir(), 'agent-analytics-frontier-race-'));
    const file = join(dir, 'data.db');
    const primary = new Database(file);
    const concurrent = new Database(file);
    primary.pragma('busy_timeout = 5000');
    concurrent.pragma('busy_timeout = 5000');
    runMigrations(primary);
    recordSettledFrontier(primary, { source: 'codex-cli', sessionId: 'race', turnId: 't1', basis: 'b1' }, new Date(0), 90);
    const stale = primary.prepare(`SELECT source_tool, session_id, latest_turn_id, generation, status, not_before
      FROM analysis_queue WHERE source_tool = 'codex-cli' AND session_id = 'race'`).get();
    let injected = false;
    const racingDb = new Proxy(primary, {
      get(target, property, receiver) {
        if (property === 'transaction') {
          return (callback: (...args: unknown[]) => unknown) => (...args: unknown[]) => callback(...args);
        }
        if (property !== 'prepare') return Reflect.get(target, property, receiver);
        return (sql: string) => {
          const statement = target.prepare(sql);
          if (!injected && sql.startsWith('SELECT source_tool')) {
            return {
              get: () => {
                injected = true;
                recordSettledFrontier(concurrent,
                  { source: 'codex-cli', sessionId: 'race', turnId: 't2', basis: 'b2' }, new Date(1_000), 90);
                return stale;
              },
            };
          }
          if (!injected && sql.startsWith('INSERT INTO analysis_queue')) {
            return {
              get: (...args: unknown[]) => {
                injected = true;
                recordSettledFrontier(concurrent,
                  { source: 'codex-cli', sessionId: 'race', turnId: 't2', basis: 'b2' }, new Date(1_000), 90);
                return statement.get(...args);
              },
            };
          }
          if (!injected && sql.startsWith('INSERT OR IGNORE INTO analysis_frontier_events')) {
            return {
              run: (...args: unknown[]) => {
                injected = true;
                recordSettledFrontier(concurrent,
                  { source: 'codex-cli', sessionId: 'race', turnId: 't2', basis: 'b2' }, new Date(1_000), 90);
                return statement.run(...args);
              },
            };
          }
          return statement;
        };
      },
    });

    recordSettledFrontier(racingDb as unknown as Database.Database,
      { source: 'codex-cli', sessionId: 'race', turnId: 't3', basis: 'b3' }, new Date(2_000), 90);
    expect(primary.prepare(`SELECT generation FROM analysis_queue WHERE session_id = 'race'`).get())
      .toEqual({ generation: 3 });
    concurrent.close();
    primary.close();
    rmSync(dir, { recursive: true, force: true });
  });
});
