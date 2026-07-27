import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { startBehaviorReportWithLease } from './behavior-report-scheduler.js';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('behavior report cross-process lease', () => {
  it('ignores a duplicate job instead of queueing it', async () => {
    const root = mkdtempSync(join(tmpdir(), 'behavior-report-lease-'));
    roots.push(root);
    const databasePath = join(root, 'data.db');
    let finish!: () => void;
    const first = startBehaviorReportWithLease(
      () => new Promise<void>((resolve) => { finish = resolve; }),
      databasePath,
    );

    expect(first).not.toBeNull();
    expect(startBehaviorReportWithLease(async () => {}, databasePath)).toBeNull();

    await Promise.resolve();
    finish();
    await first;
    const afterRelease = startBehaviorReportWithLease(async () => {}, databasePath);
    expect(afterRelease).not.toBeNull();
    await afterRelease;
  });
});
