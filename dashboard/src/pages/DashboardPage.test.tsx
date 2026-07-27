import { describe, expect, it } from 'vitest';
import { skillTooltipEntries } from './DashboardPage';

describe('skillTooltipEntries', () => {
  it('lists stacked areas from the visible top layer to the bottom layer', () => {
    const renderOrder = [
      { dataKey: 'skill_0', name: '$worker', value: 62 },
      { dataKey: 'skill_1', name: '$verification-before-completion', value: 5 },
      { dataKey: 'skill_2', name: '$using-superpowers', value: 7 },
      { dataKey: 'skill_3', name: '其他', value: 34 },
    ];

    expect(skillTooltipEntries(renderOrder).map((entry) => entry.name)).toEqual([
      '其他',
      '$using-superpowers',
      '$verification-before-completion',
      '$worker',
    ]);
  });
});
