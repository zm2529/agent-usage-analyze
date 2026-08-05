import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import WeeklyReportPage from './WeeklyReportPage';

const api = vi.hoisted(() => ({ fetchWeeklyReport: vi.fn() }));
vi.mock('@/lib/api', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/api')>(),
  fetchWeeklyReport: api.fetchWeeklyReport,
}));
vi.mock('@/i18n/LanguageProvider', () => ({
  useLanguage: () => ({ language: 'zh-CN' }),
}));

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><WeeklyReportPage /></QueryClientProvider>);
}

describe('WeeklyReportPage', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows totals, brief analysis, and each agent breakdown', async () => {
    api.fetchWeeklyReport.mockResolvedValue({
      generatedAt: '2026-08-04T08:00:00.000Z',
      week: { startsAt: '2026-08-02T16:00:00.000Z', endsAt: '2026-08-04T08:00:00.000Z' },
      previousWeek: { startsAt: '2026-07-26T16:00:00.000Z', endsAt: '2026-07-28T08:00:00.000Z' },
      totals: {
        sessions: 12, projects: 3, messages: 240, toolCalls: 80, durationMinutes: 360,
        totalTokens: 120_000, analyzedSessions: 9, analysisCoverage: 75,
        previousSessions: 8, previousTokens: 90_000, sessionDeltaPercent: 50, tokenDeltaPercent: 33,
      },
      agents: [{
        sourceTool: 'codex-cli', sessions: 9, projects: 3, messages: 180, toolCalls: 70,
        durationMinutes: 300, inputTokens: 90_000, outputTokens: 15_000,
        cacheCreationTokens: 0, cacheReadTokens: 0, totalTokens: 105_000,
        analyzedSessions: 8, analysisCoverage: 89, sharePercent: 75,
        previousSessions: 6, previousTokens: 75_000, sessionDeltaPercent: 50, tokenDeltaPercent: 40,
      }, {
        sourceTool: 'claude-code', sessions: 3, projects: 1, messages: 60, toolCalls: 10,
        durationMinutes: 60, inputTokens: 12_000, outputTokens: 3_000,
        cacheCreationTokens: 0, cacheReadTokens: 0, totalTokens: 15_000,
        analyzedSessions: 1, analysisCoverage: 33, sharePercent: 25,
        previousSessions: 2, previousTokens: 15_000, sessionDeltaPercent: 50, tokenDeltaPercent: 0,
      }],
      highlights: [{
        kind: 'primary', title: 'Codex 是本周主力 Agent', detail: '9 个会话，占本周记录的 75%。',
        titleEn: 'Codex is primary', detailEn: '9 sessions.',
      }],
    });

    renderPage();

    expect(await screen.findByText('本周 Agent 周报')).toBeInTheDocument();
    expect(screen.getByText('Codex 是本周主力 Agent')).toBeInTheDocument();
    expect(screen.getByText('Codex')).toBeInTheDocument();
    expect(screen.getByText('Claude Code')).toBeInTheDocument();
    expect(screen.getAllByText('75%').length).toBeGreaterThan(0);
    expect(screen.getAllByText('+50% 较上周同期').length).toBeGreaterThan(0);
  });

  it('renders an explicit empty state', async () => {
    api.fetchWeeklyReport.mockResolvedValue({
      generatedAt: '2026-08-04T08:00:00.000Z',
      week: { startsAt: '2026-08-02T16:00:00.000Z', endsAt: '2026-08-04T08:00:00.000Z' },
      previousWeek: { startsAt: '2026-07-26T16:00:00.000Z', endsAt: '2026-07-28T08:00:00.000Z' },
      totals: { sessions: 0, projects: 0, messages: 0, toolCalls: 0, durationMinutes: 0, totalTokens: 0, analyzedSessions: 0, analysisCoverage: 0, previousSessions: 0, previousTokens: 0, sessionDeltaPercent: 0, tokenDeltaPercent: 0 },
      agents: [],
      highlights: [{ kind: 'attention', title: '本周暂无可用记录', detail: '完成导入后自动汇总。', titleEn: 'No records', detailEn: 'Import first.' }],
    });

    renderPage();

    expect(await screen.findByText('本周还没有会话记录。')).toBeInTheDocument();
    expect(screen.getByText('本周暂无可用记录')).toBeInTheDocument();
  });
});
