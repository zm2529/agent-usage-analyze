import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ImprovePage from './ImprovePage';

const api = vi.hoisted(() => ({ fetchBehaviorReport: vi.fn(), runBehaviorReport: vi.fn() }));
vi.mock('@/lib/api', () => api);
vi.mock('@/components/analysis/AnalysisRunTrace', () => ({ AnalysisRunTrace: () => <div>analysis trace</div> }));

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}><MemoryRouter><ImprovePage /></MemoryRouter></QueryClientProvider>);
}

const eligibleState = {
  dataset: {
    window: { startsAt: '2026-06-23T00:00:00Z', endsAt: '2026-07-23T00:00:00Z', spanDays: 30 },
    basis: { generatedAt: '2026-07-23T00:00:00Z', latestSessionAt: '2026-07-22T00:00:00Z', latestLlmAnalysisAt: null },
    coverage: {
      windowSessions: 620, structurallyAnalyzedSessions: 620, semanticEnrichedSessions: 3,
      structuralRatio: 1, semanticEnrichmentRatio: 0.005,
    },
    activity: { rootTasks: 100, userMessages: 1000, followupMessages: 0 },
    promptSignals: { firstMessages: 100 },
    representativeEpisodes: [],
    leverage: {
      skills: { explicitInvocations: 0, automaticInvocations: 0, agentReadEvents: 0, coveredSessions: 0, items: [] },
      tools: { totalCalls: 0, coveredTasks: 0, families: [], topTools: [] },
    },
  },
  eligibilityReason: null, run: null, report: null, needsRegeneration: false,
};

const profileReport = {
  identity: { title: 'AI 工程编排者', stage: '系统化升级期', rationale: '已形成多代理工作方式。', evidenceRefs: ['codex:session-1'] },
  headline: '从高频操控升级为自主闭环系统设计', summary: '跨会话总结',
  portrait: [{ title: '真实使用画像', finding: '多项目、高强度、善于纠偏。', evidenceRefs: ['codex:session-1'] }],
  strengths: [{ title: '边界意识强', explanation: '会保护工作树。', mechanism: '显式约束。', evidenceRefs: [] }],
  bottlenecks: [{ title: '仍在充当事件循环', explanation: '短授权频繁。', mechanism: '授权边界过细。', counterEvidence: ['高风险任务合理'], evidenceRefs: [] }],
  dimensions: [{
    id: 'orchestration-boundary', label: '编排边界设计', status: 'candidate', observation: '需要按任务类型验证。',
    benefitHypothesis: '减少可逆动作的人为中断。', applicability: ['多阶段任务'], limitations: ['缺少结果对照'], confidence: 'medium', evidenceRefs: [],
  }],
  skillAssessments: [],
  developmentPlan: {
    northStar: '建立能自主闭环的个人工程系统', operatingRules: ['可逆动作一次授权'],
    improvementPlans: [{ title: '授权边界改进', hypothesis: '减少短跟进。', eligibleCohort: '多阶段任务', observableOutcome: '人工介入次数', guardrail: '高风险动作仍询问', reviewAfter: '10 个任务', relationshipToPrevious: 'parallel', sequencingReason: '首个计划', evidenceRefs: [] }],
    taskTemplate: '目标：\n边界：\n完成定义：',
  },
  uncertainty: '样本仍有限。',
};

describe('ImprovePage', () => {
  beforeEach(() => vi.clearAllMocks());

  it('waits for an explicit action instead of starting a report when the page opens', async () => {
    api.fetchBehaviorReport.mockResolvedValue(eligibleState);
    api.runBehaviorReport.mockImplementation(() => new Promise(() => {}));

    renderPage();

    expect(await screen.findByText('尚未生成使用分析')).toBeInTheDocument();
    expect(await screen.findByText('620/620 个会话完成结构分析')).toBeInTheDocument();
    expect(api.runBehaviorReport).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Generate LLM report' })).toBeEnabled();
  });

  it('does not start a report while the structural evidence threshold is unmet', async () => {
    api.fetchBehaviorReport.mockResolvedValue({
      ...eligibleState,
      eligibilityReason: 'insufficient-structural-sessions',
      dataset: { ...eligibleState.dataset, coverage: {
        windowSessions: 9, structurallyAnalyzedSessions: 9, semanticEnrichedSessions: 0,
        structuralRatio: 1, semanticEnrichmentRatio: 0,
      } },
    });

    renderPage();

    expect(await screen.findByText('insufficient-structural-sessions')).toBeInTheDocument();
    expect(api.runBehaviorReport).not.toHaveBeenCalled();
  });

  it('shows the evidence snapshot stored with the report instead of current coverage', async () => {
    api.fetchBehaviorReport.mockResolvedValue({
      ...eligibleState,
      dataset: { ...eligibleState.dataset, coverage: {
        windowSessions: 591, structurallyAnalyzedSessions: 591, semanticEnrichedSessions: 13,
        structuralRatio: 1, semanticEnrichmentRatio: 0.022,
      } },
      run: {
        id: 'run-1',
        status: 'completed',
        analysisType: 'behavior_report',
        createdAt: '2026-07-21 07:56:00',
        inputSummary: {
          window: { startsAt: '2026-06-21T00:00:00Z', endsAt: '2026-07-21T00:00:00Z' },
          coverage: {
            windowSessions: 590, structurallyAnalyzedSessions: 590, semanticEnrichedSessions: 3,
            structuralRatio: 1, semanticEnrichmentRatio: 0.005,
          },
        },
      },
      report: profileReport,
    });

    renderPage();

    expect(await screen.findByText('590/590 个会话完成结构分析')).toBeInTheDocument();
    expect(screen.getByText('3 个会话带语义增强')).toBeInTheDocument();
    expect(screen.getByText('代表性片段')).toBeInTheDocument();
    expect(api.runBehaviorReport).not.toHaveBeenCalled();
  });

  it('renders a dynamic personal profile and sends action items to the advice page', async () => {
    api.fetchBehaviorReport.mockResolvedValue({
      ...eligibleState,
      run: { id: 'run-2', status: 'completed', analysisType: 'behavior_report', promptVersion: 'behavior-report-v4', createdAt: '2026-07-23 10:00:00', inputSummary: {} },
      report: profileReport,
      dataset: {
        ...eligibleState.dataset,
        leverage: {
          skills: { explicitInvocations: 3, automaticInvocations: 1, agentReadEvents: 4, coveredSessions: 2, items: [{
            name: 'diagnose', invocations: 4, userInvocations: 3, automaticInvocations: 1, agentReadEvents: 4, sessions: 2, weeklyInvocations: [1, 0, 2, 1],
            sessionShare: 0.04, coUsedWith: [], lastUsedAt: '2026-07-20T00:00:00Z',
          }] },
          tools: { totalCalls: 10, coveredTasks: 3, families: [], topTools: [] },
        },
      },
    });
    renderPage();

    expect(await screen.findByText('AI 工程编排者')).toBeInTheDocument();
    expect(screen.getAllByText('真实使用画像')).not.toHaveLength(0);
    expect(screen.getByText('值得关注的使用习惯')).toBeInTheDocument();
    expect(screen.getByText('查看改进追踪')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '前往改进追踪 →' })).toHaveAttribute('href', '/improvements');
    expect(screen.getByText('用户指定')).toBeInTheDocument();
    expect(screen.getByText('自动启用')).toBeInTheDocument();
    expect(screen.queryByText('根据本次分析生成，不是固定内容。')).not.toBeInTheDocument();
    expect(screen.queryByText('目前无法确定的部分：')).not.toBeInTheDocument();
    expect(screen.queryByText('工作方式观察')).not.toBeInTheDocument();
    expect(screen.queryByText('验证状态未知')).not.toBeInTheDocument();
    expect(screen.queryByText('验证率')).not.toBeInTheDocument();
  });

  it('explains that an obsolete report waits for manual or scheduled regeneration', async () => {
    api.fetchBehaviorReport.mockResolvedValue({ ...eligibleState, needsRegeneration: true, run: { status: 'completed', promptVersion: 'behavior-report-v3' } });
    api.runBehaviorReport.mockImplementation(() => new Promise(() => {}));

    renderPage();

    expect(await screen.findByText('分析方法已更新')).toBeInTheDocument();
    expect(screen.getByText('现有结果使用旧版分析方法。你可以现在重新生成，或等待下一次自动分析。')).toBeInTheDocument();
    expect(api.runBehaviorReport).not.toHaveBeenCalled();
  });
});
