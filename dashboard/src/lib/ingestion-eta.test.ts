import { describe, expect, it } from 'vitest';
import { estimateRemainingMs } from './ingestion-eta';

describe('estimateRemainingMs', () => {
  it('does not publish a volatile estimate during warmup', () => {
    expect(estimateRemainingMs([{ completed: 1, at: 0 }, { completed: 5, at: 60_000 }], 1_800)).toBeNull();
  });

  it('uses recent throughput instead of the slow startup average', () => {
    expect(estimateRemainingMs([
      { completed: 5, at: 60_000 },
      { completed: 105, at: 70_000 },
      { completed: 205, at: 80_000 },
    ], 1_805)).toBe(160_000);
  });
});
