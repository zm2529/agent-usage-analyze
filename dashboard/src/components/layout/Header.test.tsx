import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { LanguageProvider } from '@/i18n/LanguageProvider';
import { Header, NAV_ITEMS } from './Header';

vi.mock('@/hooks/useRuntimeStatus', () => ({
  useRuntimeStatus: () => ({
    data: {
      generatedAt: '2026-07-26T00:00:00.000Z',
      stages: {
        hook: { state: 'healthy', label: '最近事件已收到', lastSuccessAt: '2026-07-26T00:00:00.000Z', backlog: 0, failures: 0, action: { label: '查看记录', href: '/sessions' }, detail: '' },
        ingestion: { state: 'running', label: '正在导入', lastSuccessAt: null, backlog: 4, failures: 0, action: { label: '查看导入', href: '/settings' }, detail: '已处理 4/8 个来源' },
        semanticAnalysis: { state: 'waiting', label: '等待分析能力', lastSuccessAt: null, backlog: 1, failures: 0, action: { label: '查看队列', href: '/settings' }, detail: '' },
        behaviorReport: { state: 'healthy', label: '当前报告可用', lastSuccessAt: '2026-07-26T00:00:00.000Z', backlog: 0, failures: 0, action: { label: '查看分析', href: '/analysis' }, detail: '' },
        knowledgeResearch: { state: 'healthy', label: '实践快照已更新', lastSuccessAt: '2026-07-26T00:00:00.000Z', backlog: 0, failures: 0, action: { label: '查看实践库', href: '/practices' }, detail: '' },
      },
    },
  }),
}));

vi.mock('./ThemeToggle', () => ({ ThemeToggle: () => null }));
vi.mock('./LanguageToggle', () => ({ LanguageToggle: () => null }));

describe('primary navigation', () => {
  it('keeps the primary navigation focused on the five product areas', () => {
    expect(NAV_ITEMS.map(({ href, label }) => [href, label])).toEqual([
      ['/dashboard', '总览'], ['/analysis', '分析'], ['/improvements', '改进追踪'],
      ['/practices', '实践库'], ['/sessions', '活动记录'],
    ]);
  });

  it('shows each real pipeline stage independently', () => {
    render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <LanguageProvider>
          <Header />
        </LanguageProvider>
      </MemoryRouter>,
    );

    expect(screen.getByText('最近事件已收到')).toBeInTheDocument();
    expect(screen.getByText('已处理 4/8 个来源')).toBeInTheDocument();
    expect(screen.getByText('等待分析能力')).toBeInTheDocument();
    expect(screen.getByText('当前报告可用')).toBeInTheDocument();
  });
});
