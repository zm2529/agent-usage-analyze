import { describe, it, expect } from 'vitest';
import {
  formatMoney,
  formatTokens,
  formatDuration,
  formatRelativeDate,
  formatTime,
  formatPercent,
  formatCount,
  formatPeriodLabel,
} from './format.js';

describe('formatMoney', () => {
  it('formats small amounts with 2 decimal places', () => {
    expect(formatMoney(3.50)).toBe('$3.50');
  });

  it('formats zero', () => {
    expect(formatMoney(0)).toBe('$0.00');
  });

  it('formats large amounts with commas', () => {
    // >= 1000 uses toLocaleString('en-US')
    const result = formatMoney(1234.56);
    expect(result).toBe('$1,234.56');
  });

  it('formats amount just under 1000 without commas', () => {
    expect(formatMoney(999.99)).toBe('$999.99');
  });

  it('formats very small amounts', () => {
    expect(formatMoney(0.01)).toBe('$0.01');
  });
});

describe('formatTokens', () => {
  it('formats millions with one decimal', () => {
    expect(formatTokens(1_500_000)).toBe('1.5M');
  });

  it('formats exact million', () => {
    expect(formatTokens(1_000_000)).toBe('1.0M');
  });

  it('formats thousands with K suffix', () => {
    expect(formatTokens(5_000)).toBe('5K');
  });

  it('rounds thousands', () => {
    expect(formatTokens(5_500)).toBe('6K');
  });

  it('formats small numbers with locale string', () => {
    expect(formatTokens(999)).toBe('999');
  });

  it('formats zero', () => {
    expect(formatTokens(0)).toBe('0');
  });
});

describe('formatDuration', () => {
  it('shows "< 1m" for durations less than 1 minute', () => {
    expect(formatDuration(0.5)).toBe('< 1m');
    expect(formatDuration(0)).toBe('< 1m');
  });

  it('shows minutes for durations under an hour', () => {
    expect(formatDuration(30)).toBe('30m');
  });

  it('shows hours and minutes for mixed durations', () => {
    expect(formatDuration(90)).toBe('1h 30m');
  });

  it('shows hours only when minutes remainder is 0', () => {
    expect(formatDuration(120)).toBe('2h');
  });

  it('rounds minutes', () => {
    expect(formatDuration(1.4)).toBe('1m');
    expect(formatDuration(1.6)).toBe('2m');
  });
});

describe('formatRelativeDate', () => {
  it('shows minutes ago for times less than 1 hour ago', () => {
    const date = new Date(Date.now() - 30 * 60 * 1000); // 30 minutes ago
    expect(formatRelativeDate(date)).toBe('30m ago');
  });

  it('shows at least 1m ago for very recent times (< 1 minute)', () => {
    const date = new Date(Date.now() - 10 * 1000); // 10 seconds ago
    expect(formatRelativeDate(date)).toBe('1m ago');
  });

  it('shows hours ago for times between 1 and 24 hours ago', () => {
    const date = new Date(Date.now() - 3 * 60 * 60 * 1000); // 3 hours ago
    expect(formatRelativeDate(date)).toBe('3h ago');
  });

  it('shows "yesterday" for times between 24 and 48 hours ago', () => {
    const date = new Date(Date.now() - 36 * 60 * 60 * 1000); // 36 hours ago
    expect(formatRelativeDate(date)).toBe('yesterday');
  });

  it('shows days ago for times between 2 and 7 days ago', () => {
    const date = new Date(Date.now() - 4 * 24 * 60 * 60 * 1000); // 4 days ago
    expect(formatRelativeDate(date)).toBe('4d ago');
  });

  it('shows formatted date for times 7 or more days ago', () => {
    // Use a fixed date so we know the expected output
    const date = new Date(2026, 0, 1); // Jan 1, 2026
    const result = formatRelativeDate(date);
    expect(result).toBe('Jan 1');
  });
});

describe('formatTime', () => {
  it('formats a time in 12-hour format with hours and minutes', () => {
    const date = new Date(2026, 0, 1, 14, 30); // 2:30 PM
    const result = formatTime(date);
    expect(result).toBe('2:30 PM');
  });

  it('formats midnight correctly', () => {
    const date = new Date(2026, 0, 1, 0, 0); // 12:00 AM
    const result = formatTime(date);
    expect(result).toBe('12:00 AM');
  });

  it('formats noon correctly', () => {
    const date = new Date(2026, 0, 1, 12, 0); // 12:00 PM
    const result = formatTime(date);
    expect(result).toBe('12:00 PM');
  });
});

describe('formatPercent', () => {
  it('shows one decimal for values < 10', () => {
    // 5.55.toFixed(1) = '5.5' in JS (IEEE 754 rounding)
    expect(formatPercent(5.55)).toBe('5.5%');
    expect(formatPercent(5.56)).toBe('5.6%');
    expect(formatPercent(0.1)).toBe('0.1%');
  });

  it('rounds for values >= 10', () => {
    expect(formatPercent(10)).toBe('10%');
    expect(formatPercent(55.5)).toBe('56%');
    expect(formatPercent(99.9)).toBe('100%');
  });
});

describe('formatCount', () => {
  it('formats with locale-specific separators', () => {
    const result = formatCount(1234);
    expect(result).toBe('1,234');
  });

  it('formats zero', () => {
    expect(formatCount(0)).toBe('0');
  });
});

describe('formatPeriodLabel', () => {
  it('maps 7d to "Last 7 days"', () => {
    expect(formatPeriodLabel('7d')).toBe('Last 7 days');
  });

  it('maps 30d to "Last 30 days"', () => {
    expect(formatPeriodLabel('30d')).toBe('Last 30 days');
  });

  it('maps 90d to "Last 90 days"', () => {
    expect(formatPeriodLabel('90d')).toBe('Last 90 days');
  });

  it('maps all to "All time"', () => {
    expect(formatPeriodLabel('all')).toBe('All time');
  });
});
