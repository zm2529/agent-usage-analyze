import { describe, it, expect } from 'vitest';
import { levenshtein, findSimilarNames } from './fuzzy-match.js';

describe('levenshtein', () => {
  it('returns 0 for identical strings', () => {
    expect(levenshtein('hello', 'hello')).toBe(0);
  });

  it('returns length of other string when one is empty', () => {
    expect(levenshtein('', 'abc')).toBe(3);
    expect(levenshtein('abc', '')).toBe(3);
  });

  it('returns 0 for two empty strings', () => {
    expect(levenshtein('', '')).toBe(0);
  });

  it('returns 1 for a single substitution', () => {
    expect(levenshtein('cat', 'bat')).toBe(1);
  });

  it('returns 1 for a single insertion', () => {
    expect(levenshtein('cat', 'cats')).toBe(1);
  });

  it('returns 1 for a single deletion', () => {
    expect(levenshtein('cats', 'cat')).toBe(1);
  });

  it('handles completely different strings', () => {
    expect(levenshtein('abc', 'xyz')).toBe(3);
  });

  it('handles transposition as two operations', () => {
    // Standard Levenshtein counts transposition as 2 (delete + insert or sub + sub)
    expect(levenshtein('ab', 'ba')).toBe(2);
  });
});

describe('findSimilarNames', () => {
  const candidates = ['agent-analytics', 'my-project', 'dashboard', 'server-api'];

  it('returns exact match first', () => {
    const result = findSimilarNames('dashboard', candidates);
    expect(result[0]).toBe('dashboard');
  });

  it('returns close matches within default maxDistance', () => {
    const result = findSimilarNames('dashbord', candidates);
    expect(result).toContain('dashboard');
  });

  it('returns empty array when no matches within maxDistance', () => {
    const result = findSimilarNames('completely-unrelated-name', candidates, 2);
    expect(result).toEqual([]);
  });

  it('is case-insensitive', () => {
    const result = findSimilarNames('DASHBOARD', candidates);
    expect(result).toContain('dashboard');
  });

  it('respects custom maxDistance', () => {
    // 'dashbord' -> 'dashboard' has distance 1
    const strict = findSimilarNames('dashbord', candidates, 0);
    expect(strict).not.toContain('dashboard');

    const relaxed = findSimilarNames('dashbord', candidates, 1);
    expect(relaxed).toContain('dashboard');
  });

  it('sorts results by distance (closest first)', () => {
    const result = findSimilarNames('server', ['server-api', 'serve', 'observer', 'something-else'], 5);
    // 'serve' (distance 1) should come before 'server-api' (distance 4)
    const serveIdx = result.indexOf('serve');
    const serverApiIdx = result.indexOf('server-api');
    expect(serveIdx).toBeLessThan(serverApiIdx);
  });

  it('returns empty array for empty candidates', () => {
    expect(findSimilarNames('test', [])).toEqual([]);
  });
});
