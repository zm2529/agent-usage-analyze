import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { PriorityDecision, skillTooltipEntries } from './DashboardPage';

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

describe('PriorityDecision loading state', () => {
  it('uses neutral local placeholders instead of a fabricated analysis conclusion', () => {
    render(<MemoryRouter><PriorityDecision
      headline={null}
      plans={[]}
      healthState={undefined}
      reportState={undefined}
      headlineLoading
      plansLoading
      healthLoading
    /></MemoryRouter>);

    expect(screen.getAllByText('正在整理最近记录').length).toBeGreaterThan(0);
    expect(screen.queryByText('正在准备最近的使用分析')).not.toBeInTheDocument();
    expect(screen.queryByText('最近还没有可展示的分析')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: '进入分析证据' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '查看改进追踪' })).toBeInTheDocument();
  });

  it('keeps available data visible while another section is still loading', () => {
    render(<MemoryRouter><PriorityDecision
      headline="复杂任务的交付边界更清晰"
      plans={[{
        id: 'plan-1',
        title: '交付前引用验证结果',
        status: 'observing',
        matchedTaskCount: 8,
        maxTaskCount: 12,
        basisChanged: false,
      }]}
      healthState="completed"
      reportState="已完成"
      plansLoading
    /></MemoryRouter>);

    expect(screen.getByText('复杂任务的交付边界更清晰')).toBeInTheDocument();
    expect(screen.getByText('交付前引用验证结果')).toBeInTheDocument();
    expect(screen.getByText('最近完成')).toBeInTheDocument();
  });
});
