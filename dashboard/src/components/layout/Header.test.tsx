import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { LanguageProvider } from '@/i18n/LanguageProvider';
import { Header, NAV_ITEMS } from './Header';

vi.mock('@/hooks/useIngestionHealth', () => ({
  useIngestionHealth: () => ({
    data: {
      status: 'running',
      diagnostics: [],
      coverage: { discovered: 8, parsed: 4, skipped: 0, failed: 0, unknown: 0 },
      eventCount: 10,
      sourceCount: 8,
      processedSources: 4,
      startedAt: '2026-07-26T00:00:00.000Z',
      completedAt: null,
      eras: [],
    },
  }),
}));

vi.mock('@/hooks/useBehaviorReport', () => ({
  useBehaviorReport: () => ({ data: { generation: { running: false }, report: null } }),
}));

vi.mock('./ThemeToggle', () => ({ ThemeToggle: () => null }));
vi.mock('./LanguageToggle', () => ({ LanguageToggle: () => null }));

describe('primary navigation', () => {
  it('keeps the primary navigation focused on the four user decisions', () => {
    expect(NAV_ITEMS.map(({ href, label }) => [href, label])).toEqual([
      ['/dashboard', '总览'], ['/improve', '分析'], ['/advice', '建议'],
      ['/sessions', '记录'],
    ]);
  });

  it('shows real file progress in the running import stage', () => {
    render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <LanguageProvider>
          <Header />
        </LanguageProvider>
      </MemoryRouter>,
    );

    const status = screen.getByRole('status', { name: /导入进度 50%/ });
    expect(within(status).getByText('50% · 4/8')).toBeInTheDocument();
    expect(status.querySelector('.vibe-stage-progress > span')).toHaveStyle({ width: '50%' });
  });
});
