import { describe, expect, it } from 'vitest';
import { NAV_ITEMS } from './Header';

describe('primary navigation', () => {
  it('keeps the primary navigation focused on the four user decisions', () => {
    expect(NAV_ITEMS.map(({ href, label }) => [href, label])).toEqual([
      ['/dashboard', '总览'], ['/improve', '能力'], ['/advice', '行动'],
      ['/sessions', '记录'],
    ]);
  });
});
