import { describe, it, expect } from 'vitest';
import { parseIntParam } from './utils.js';

describe('parseIntParam', () => {
  it('returns parsed integer for a valid string', () => {
    expect(parseIntParam('42', 10)).toBe(42);
  });

  it('returns default when value is undefined', () => {
    expect(parseIntParam(undefined, 25)).toBe(25);
  });

  it('returns default when value is NaN', () => {
    expect(parseIntParam('abc', 10)).toBe(10);
  });

  it('returns default when value is negative', () => {
    expect(parseIntParam('-5', 10)).toBe(10);
  });

  it('returns 0 when value is "0"', () => {
    expect(parseIntParam('0', 10)).toBe(0);
  });

  it('returns default for empty string', () => {
    expect(parseIntParam('', 10)).toBe(10);
  });

  it('returns default for Infinity', () => {
    expect(parseIntParam('Infinity', 10)).toBe(10);
  });
});
