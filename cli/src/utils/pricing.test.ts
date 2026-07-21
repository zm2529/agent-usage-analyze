import { describe, it, expect } from 'vitest';
import { getModelPricing, calculateCost } from './pricing.js';
import type { UsageEntry } from './pricing.js';

describe('getModelPricing', () => {
  it('returns exact match for known model', () => {
    const pricing = getModelPricing('claude-sonnet-4');
    expect(pricing).toEqual({ input: 3, output: 15 });
  });

  it('returns exact match for opus model', () => {
    const pricing = getModelPricing('claude-opus-4-5');
    expect(pricing).toEqual({ input: 5, output: 25 });
  });

  it('returns prefix match for date-suffixed model', () => {
    const pricing = getModelPricing('claude-sonnet-4-5-20250929');
    expect(pricing).toEqual({ input: 3, output: 15 });
  });

  it('returns prefix match for opus with date suffix', () => {
    const pricing = getModelPricing('claude-opus-4-6-20260101');
    expect(pricing).toEqual({ input: 5, output: 25 });
  });

  it('returns default pricing for unknown model', () => {
    const pricing = getModelPricing('gpt-4o-mini');
    expect(pricing).toEqual({ input: 3, output: 15 });
  });

  it('returns default pricing for empty string', () => {
    const pricing = getModelPricing('');
    expect(pricing).toEqual({ input: 3, output: 15 });
  });

  it('returns correct pricing for Claude 3.5 haiku', () => {
    const pricing = getModelPricing('claude-3-5-haiku-20241022');
    expect(pricing).toEqual({ input: 0.8, output: 4 });
  });
});

describe('calculateCost', () => {
  it('returns 0 for empty entries', () => {
    expect(calculateCost([])).toBe(0);
  });

  it('calculates cost for input tokens', () => {
    const entries: UsageEntry[] = [
      { model: 'claude-sonnet-4', usage: { input_tokens: 1_000_000 } },
    ];
    // 1M tokens * $3/1M = $3.00
    expect(calculateCost(entries)).toBe(3);
  });

  it('calculates cost for output tokens', () => {
    const entries: UsageEntry[] = [
      { model: 'claude-sonnet-4', usage: { output_tokens: 1_000_000 } },
    ];
    // 1M tokens * $15/1M = $15.00
    expect(calculateCost(entries)).toBe(15);
  });

  it('calculates cache creation tokens at 1.25x input price', () => {
    const entries: UsageEntry[] = [
      {
        model: 'claude-sonnet-4',
        usage: { cache_creation_input_tokens: 1_000_000 },
      },
    ];
    // 1M tokens * $3/1M * 1.25 = $3.75
    expect(calculateCost(entries)).toBe(3.75);
  });

  it('calculates cache read tokens at 0.1x input price', () => {
    const entries: UsageEntry[] = [
      {
        model: 'claude-sonnet-4',
        usage: { cache_read_input_tokens: 1_000_000 },
      },
    ];
    // 1M tokens * $3/1M * 0.1 = $0.30
    expect(calculateCost(entries)).toBe(0.3);
  });

  it('sums costs from multiple entries', () => {
    const entries: UsageEntry[] = [
      { model: 'claude-sonnet-4', usage: { input_tokens: 500_000 } },
      { model: 'claude-sonnet-4', usage: { output_tokens: 500_000 } },
    ];
    // 500K * $3/1M + 500K * $15/1M = $1.50 + $7.50 = $9.00
    expect(calculateCost(entries)).toBe(9);
  });

  it('treats missing usage fields as 0', () => {
    const entries: UsageEntry[] = [
      { model: 'claude-sonnet-4', usage: {} },
    ];
    expect(calculateCost(entries)).toBe(0);
  });

  it('rounds to 4 decimal places', () => {
    const entries: UsageEntry[] = [
      { model: 'claude-sonnet-4', usage: { input_tokens: 1 } },
    ];
    // 1 token * $3/1M = $0.000003 -> rounded to 4dp = 0
    expect(calculateCost(entries)).toBe(0);
  });

  it('combines all token types in a single entry', () => {
    const entries: UsageEntry[] = [
      {
        model: 'claude-sonnet-4',
        usage: {
          input_tokens: 1_000_000,
          output_tokens: 100_000,
          cache_creation_input_tokens: 200_000,
          cache_read_input_tokens: 500_000,
        },
      },
    ];
    // input:  1M   * $3/1M        = $3.00
    // output: 100K * $15/1M       = $1.50
    // cache_create: 200K * $3/1M * 1.25 = $0.75
    // cache_read:   500K * $3/1M * 0.1  = $0.15
    // total = $5.40
    expect(calculateCost(entries)).toBe(5.4);
  });
});
