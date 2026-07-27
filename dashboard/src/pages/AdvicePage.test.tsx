import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router';
import AdvicePage from './AdvicePage';

const api = vi.hoisted(() => ({
  fetchAdvice: vi.fn(), recordAdviceEvent: vi.fn(),
  setAdviceMute: vi.fn(), clearAdviceMute: vi.fn(),
}));
vi.mock('@/lib/api', () => api);

beforeEach(() => {
  api.recordAdviceEvent.mockResolvedValue({
    recorded: true, degraded: false, interventionId: 'advisory-intervention:one',
  });
  api.setAdviceMute.mockResolvedValue(undefined);
  api.clearAdviceMute.mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><MemoryRouter><AdvicePage /></MemoryRouter></QueryClientProvider>);
}

describe('AdvicePage', () => {
  it('shows evidence and keeps only the plain-language hide controls', async () => {
    api.fetchAdvice.mockResolvedValue({
      status: 'ok', diagnostics: [],
      active: [{
        taskId: 'task:root', issueKey: 'pattern:validation-missing', sourceCategory: 'deterministic',
        triggerFact: 'Validation was not observed.', expectedBenefit: 'Earlier feedback may reduce rework.',
        confidence: 0.9, coverage: 0.8, evidenceRefs: ['event:one'],
        verification: 'Run the smallest relevant validation.', muted: false,
      }],
      muted: [{
        taskId: 'task:muted', issueKey: 'pattern:waiting', sourceCategory: 'deterministic',
        triggerFact: 'A tool call waited.', expectedBenefit: 'A narrower query may return sooner.',
        confidence: 0.75, coverage: 0.85, evidenceRefs: ['event:two'],
        verification: 'Compare the next similar task.', muted: true,
      }],
      history: {
        events: [{
          id: 'advisory-event:one', interventionId: 'advisory-intervention:one',
          issueKey: 'pattern:validation-missing', taskId: 'task:root',
          action: 'shown', outcome: null, observationEraId: 'era:one', coverage: 0.8,
          evidenceRefs: ['event:one'], occurredAt: '2026-07-21T00:00:00.000Z',
        }],
        comparisons: [{
          interventionId: 'advisory-intervention:one',
          issueKey: 'pattern:validation-missing', kind: 'observational-before-after', causal: false,
          baseline: { observationEraId: 'era:one', coverage: 0.8, occurredAt: '2026-07-21T00:00:00.000Z' },
          followup: { observationEraId: 'era:two', coverage: 0.9, outcome: 'improved', occurredAt: '2026-07-28T00:00:00.000Z' },
        }, {
          interventionId: 'advisory-intervention:two',
          issueKey: 'pattern:validation-missing', kind: 'observational-before-after', causal: false,
          baseline: { observationEraId: 'era:two', coverage: 0.9, occurredAt: '2026-08-01T00:00:00.000Z' },
          followup: { observationEraId: 'era:three', coverage: 0.7, outcome: 'not-improved', occurredAt: '2026-08-08T00:00:00.000Z' },
        }],
      },
      attention: { shown: 4, adopted: 2, ignored: 1, dismissed: 1 },
    });
    renderPage();

    expect(await screen.findByRole('heading', { name: '看看哪些地方可以改进' })).toBeInTheDocument();
    expect(screen.getByText('Validation was not observed.')).toBeInTheDocument();
    expect(screen.getByText(/置信度 90%；观察覆盖 80%/i)).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: '证据 1' })[0])
      .toHaveAttribute('href', '/tasks/task%3Aroot#event-event%3Aone');
    expect(screen.getByText(/已静音建议/)).toBeInTheDocument();
    expect(screen.queryByText(/observational before\/after only; no causal claim/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /采纳|忽略|关闭/ })).not.toBeInTheDocument();
    expect(api.recordAdviceEvent).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Mute issue 记录明确显示未进行验证' }));
    expect(api.setAdviceMute).toHaveBeenCalledWith({
      scopeKind: 'issue', scopeKey: 'pattern:validation-missing', mutedUntil: null,
    });
    fireEvent.click(screen.getByRole('button', { name: 'Unmute 工具等待时间较长' }));
    expect(api.clearAdviceMute).toHaveBeenCalledWith({ scopeKind: 'issue', scopeKey: 'pattern:waiting' });
  });

  it('shows a request failure instead of an empty advice state', async () => {
    api.fetchAdvice.mockRejectedValue(new Error('offline'));
    renderPage();

    expect(await screen.findByText('Failed to load advice')).toBeInTheDocument();
    expect(screen.queryByText('No active suggestions.')).not.toBeInTheDocument();
  });

  it('does not create implicit interaction records when suggestions render', async () => {
    api.fetchAdvice.mockResolvedValue({
      status: 'ok', diagnostics: [],
      active: [{
        taskId: 'task:retry', issueKey: 'pattern:waiting', sourceCategory: 'deterministic',
        triggerFact: 'A tool call waited.', expectedBenefit: 'A staged operation may return sooner.',
        confidence: 0.8, coverage: 0.9, evidenceRefs: ['event:retry'],
        verification: 'Compare the next task.', muted: false,
      }],
      muted: [], history: { events: [], comparisons: [] },
      attention: { shown: 0, adopted: 0, ignored: 0, dismissed: 0 },
    });
    renderPage();

    expect(await screen.findByText('A tool call waited.')).toBeInTheDocument();
    expect(api.recordAdviceEvent).not.toHaveBeenCalled();
  });

  it('shows one combined count and one suggestion list for report and recent-session advice', async () => {
    api.fetchAdvice.mockResolvedValue({
      status: 'ok', diagnostics: [],
      active: [{
        taskId: 'task:recent', issueKey: 'pattern:late-constraint', sourceCategory: 'deterministic',
        triggerFact: 'A constraint arrived after work began.', expectedBenefit: 'Earlier context can reduce rework.',
        confidence: 0.8, coverage: 0.9, evidenceRefs: ['event:recent'],
        verification: 'Compare the next similar task.', muted: false,
      }],
      muted: [], history: { events: [], comparisons: [] },
      attention: { shown: 0, adopted: 0, ignored: 0, dismissed: 0 },
      strategic: {
        generatedAt: '2026-07-26T00:00:00.000Z',
        headline: '整体使用分析',
        northStar: '更早说明边界',
        actions: [
          { category: 'overall', title: '先说明完成标准', rationale: '减少来回补充。' },
          { category: 'skill', title: '$diagnose', rationale: '简单查询的流程偏重。', recommendation: '仅在需要排查原因时使用。' },
          { category: 'model', title: 'gpt-5.6-sol', rationale: '简单任务可能等待更久。', applicability: '简单查询' },
        ],
      },
    });
    renderPage();

    expect(await screen.findByText('4')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '建议清单' })).toBeInTheDocument();
    expect(screen.getByText('整体使用')).toBeInTheDocument();
    expect(screen.getByText('Skill')).toBeInTheDocument();
    expect(screen.getByText('模型')).toBeInTheDocument();
    expect(screen.getByText('近期会话')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '长期改进方向' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '当前建议' })).not.toBeInTheDocument();
  });
});
