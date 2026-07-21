import { describe, expect, it } from 'vitest';
import { NAV_ITEMS } from './Header';

describe('primary navigation', () => {
  it('exposes exactly the seven product-spec destinations in order', () => {
    expect(NAV_ITEMS.map(({ href, label }) => [href, label])).toEqual([
      ['/dashboard', 'Overview'], ['/tasks', 'Tasks'], ['/deliveries', 'Deliveries'],
      ['/patterns', 'Patterns'], ['/advice', 'Advice'], ['/scorecards', 'Scorecards'],
      ['/settings', 'Settings'],
    ]);
  });
});
