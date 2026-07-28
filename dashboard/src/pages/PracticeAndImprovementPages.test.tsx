import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import PracticeLibraryPage from './PracticeLibraryPage';
import ImprovementTrackingPage from './ImprovementTrackingPage';

const practiceHooks = vi.hoisted(() => ({
  useKnowledgeStatus: vi.fn(),
  useKnowledgePractices: vi.fn(),
  useRefreshKnowledgeResearch: vi.fn(),
  useTrackKnowledgePractice: vi.fn(),
}));
const improvementHooks = vi.hoisted(() => ({
  useImprovements: vi.fn(),
  useReviewImprovement: vi.fn(),
  useUpdateImprovementStatus: vi.fn(),
  useImprovementFeedback: vi.fn(),
}));

vi.mock('@/hooks/usePractices', () => practiceHooks);
vi.mock('@/hooks/useImprovements', () => improvementHooks);
vi.mock('@/i18n/LanguageProvider', () => ({
  useLanguage: () => ({
    language: 'zh-CN',
    t: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}));
vi.mock('@/components/analysis/AnalysisRunTrace', () => ({
  AnalysisRunTrace: () => <div>运行轨迹</div>,
  BehaviorAnalysisRunTimeline: () => <div>运行轨迹</div>,
}));

const idleMutation = { isPending: false, mutate: vi.fn() };
const improvementsState = {
  creationAvailability: { analysis: 'requires-refresh', practices: 'available' },
  generation: { running: false, action: null, subjectId: null, startedAt: null, lastError: null },
  limits: {
    maxActivePlans: 3,
    maxEligibleTasksPerPlan: 30,
    maxObservationDays: 45,
    explanation: '到达 30 个合格任务或 45 天时停止观察，以先到者为准。',
  },
  plans: [],
};

function renderWithQueryClient(ui: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

describe('new product areas', () => {
  it('keeps authorization out of the library and points to settings', () => {
    practiceHooks.useKnowledgeStatus.mockReturnValue({
      isLoading: false,
      isError: false,
      data: {
        authorization: { enabled: false, authorizedAt: null },
        generation: { running: false, scope: null, startedAt: null, lastCompletedAt: null, lastError: null },
        latestSnapshot: null,
      },
    });
    practiceHooks.useKnowledgePractices.mockReturnValue({ isLoading: false, isError: false, data: { practices: [] } });
    practiceHooks.useRefreshKnowledgeResearch.mockReturnValue(idleMutation);
    practiceHooks.useTrackKnowledgePractice.mockReturnValue(idleMutation);
    improvementHooks.useImprovements.mockReturnValue({ isLoading: false, isError: false, data: improvementsState });

    renderWithQueryClient(<PracticeLibraryPage />);

    expect(screen.getByText('自动更新已关闭，可在设置中开启')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '确认边界并授权' })).not.toBeInTheDocument();
  });

  it('keeps implementation details out of the empty state', () => {
    improvementHooks.useImprovements.mockReturnValue({ isLoading: false, isError: false, data: improvementsState });

    renderWithQueryClient(<MemoryRouter><ImprovementTrackingPage /></MemoryRouter>);

    expect(screen.queryByText('最大的系统安全限制')).not.toBeInTheDocument();
    expect(screen.queryByText(/LOCAL LEDGER|运行轨迹/)).not.toBeInTheDocument();
    expect(screen.getByText('尚无改进计划')).toBeInTheDocument();
    expect(screen.getByText(/重新分析后会生成/)).toBeInTheDocument();
  });
});
