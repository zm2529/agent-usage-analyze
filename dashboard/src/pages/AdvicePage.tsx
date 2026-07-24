import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { BellRing, ChevronRight, Info } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useAdvice } from '@/hooks/useAdvice';
import { clearAdviceMute, recordAdviceEvent, setAdviceMute } from '@/lib/api';
import { eventAnchorHref } from '@/lib/event-links';
import { Badge } from '@/components/ui/badge';
import { ErrorCard } from '@/components/ErrorCard';
import { Skeleton } from '@/components/ui/skeleton';
import type { AdvisorySuggestion } from '@/lib/types';
import { useLanguage } from '@/i18n/LanguageProvider';
import { localizedAdviceCopy } from '@/lib/advice-copy';

function SuggestionCard({ suggestion, muted, interventionId, onRefresh }: {
  suggestion: AdvisorySuggestion; muted: boolean; interventionId?: string; onRefresh: () => void;
}) {
  const { t } = useLanguage();
  const copy = localizedAdviceCopy(t, suggestion);
  const normalizedTitle = issueLabel(suggestion.issueKey);
  const [accounting, setAccounting] = useState<string | null>(null);
  const record = async (action: 'adopted' | 'ignored' | 'dismissed') => {
    if (!interventionId) return;
    try {
      const result = await recordAdviceEvent({
        taskId: suggestion.taskId, issueKey: suggestion.issueKey, action, interventionId,
      });
      setAccounting(result.recorded ? t('advice.recorded', 'Recorded') : t('advice.notRecorded', 'Not recorded'));
    } catch { setAccounting(t('advice.unavailable', 'Unavailable')); }
  };
  const toggleMute = async () => {
    if (muted) await clearAdviceMute({ scopeKind: 'issue', scopeKey: suggestion.issueKey });
    else await setAdviceMute({ scopeKind: 'issue', scopeKey: suggestion.issueKey, mutedUntil: null });
    onRefresh();
  };
  return (
    <article className="grid border-t py-6 lg:grid-cols-[160px_minmax(0,1fr)_240px] lg:gap-7">
      <div><Badge variant={muted ? 'secondary' : 'outline'}>{muted ? t('advice.muted', 'Muted') : '待处理'}</Badge><p className="mt-3 break-all text-[10px] text-muted-foreground vibe-mono">任务 {suggestion.taskId.slice(0, 18)}…</p></div>
      <div className="mt-4 space-y-3 lg:mt-0"><h3 className="vibe-serif text-xl">{normalizedTitle === '改进建议' ? copy.title : normalizedTitle}</h3><p className="text-sm leading-6">{copy.triggerFact}</p>
        <div className="grid gap-3 text-xs sm:grid-cols-2"><p className="border-l-2 border-[#4F775F] pl-3"><strong className="block">预期收益</strong><span className="mt-1 block leading-5 text-muted-foreground">{copy.expectedBenefit}</span></p><p className="border-l-2 border-[#365D8D] pl-3"><strong className="block">如何验证建议是否有用</strong><span className="mt-1 block leading-5 text-muted-foreground">{copy.verification}</span></p></div>
        <details className="text-xs text-muted-foreground"><summary className="cursor-pointer text-[#365D8D]">证据与适用范围 · {suggestion.evidenceRefs.length} 项</summary><p className="mt-2 leading-5">置信度 {Math.round(suggestion.confidence * 100)}%；观察覆盖 {Math.round(suggestion.coverage * 100)}%，表示当前解析器能判断的预期事件比例，不代表建议正确率。</p><div className="mt-2 flex flex-wrap gap-3">{suggestion.evidenceRefs.map((eventId, index) => (
          <Link key={eventId} className="border-b border-[#365D8D]" to={eventAnchorHref(suggestion.taskId, eventId)}>证据 {index + 1}</Link>
        ))}</div></details>
      </div>
      <div className="mt-5 content-start lg:mt-0">
        <p className="mb-2 text-[10px] font-semibold tracking-wide text-muted-foreground">处理这条建议</p>
        <div className="grid grid-cols-2 border-l border-t text-left">
          {!muted && <>
            <button type="button" disabled={!interventionId} onClick={() => { void record('adopted'); }} className="border-b border-r p-2 text-left disabled:opacity-40"><strong className="block text-xs">采纳</strong><span className="mt-1 block text-[9px] leading-4 text-muted-foreground">记录为准备尝试</span></button>
            <button type="button" disabled={!interventionId} onClick={() => { void record('ignored'); }} className="border-b border-r p-2 text-left disabled:opacity-40"><strong className="block text-xs">忽略</strong><span className="mt-1 block text-[9px] leading-4 text-muted-foreground">本次不采用</span></button>
            <button type="button" disabled={!interventionId} onClick={() => { void record('dismissed'); }} className="border-b border-r p-2 text-left disabled:opacity-40"><strong className="block text-xs">关闭</strong><span className="mt-1 block text-[9px] leading-4 text-muted-foreground">只关闭这一条</span></button>
          </>}
          <button
            type="button"
            aria-label={`${muted ? t('advice.unmute', 'Unmute') : t('advice.mute', 'Mute issue')} ${issueLabel(suggestion.issueKey)}`}
            onClick={() => { void toggleMute(); }}
            className="border-b border-r p-2 text-left"
          >
            <strong className="block text-xs">{muted ? '恢复提示' : '静音同类'}</strong><span className="mt-1 block text-[9px] leading-4 text-muted-foreground">{muted ? '重新显示同类建议' : '后续不再提示同类问题'}</span>
          </button>
        </div>
        {accounting && <span className="mt-2 block text-[10px] text-muted-foreground">{accounting}</span>}
      </div>
    </article>
  );
}

function issueLabel(issueKey: string): string {
  if (issueKey.includes('validation-missing')) return '验证证据尚不可见';
  if (issueKey.includes('late-constraint')) return '关键约束出现较晚';
  if (issueKey.includes('waiting')) return '工具等待时间较长';
  return '改进建议';
}

export default function AdvicePage() {
  const { t } = useLanguage();
  const query = useAdvice();
  const queryClient = useQueryClient();
  const shown = useRef(new Set<string>());
  const shownAttempts = useRef(new Set<string>());
  const [shownAccounting, setShownAccounting] = useState<Record<string, {
    status: 'recording' | 'recorded' | 'degraded' | 'unavailable'; interventionId?: string;
  }>>({});
  const [showAllHistory, setShowAllHistory] = useState(false);
  const refresh = () => { void queryClient.invalidateQueries({ queryKey: ['advice'] }); };
  const recordShown = useCallback((suggestion: AdvisorySuggestion) => {
    const key = `${suggestion.taskId}:${suggestion.issueKey}`;
    if (shown.current.has(key) || shownAttempts.current.has(key)) return;
    shownAttempts.current.add(key);
    setShownAccounting((current) => ({ ...current, [key]: { status: 'recording' } }));
    void recordAdviceEvent({
      taskId: suggestion.taskId, issueKey: suggestion.issueKey, action: 'shown',
    }).then((result) => {
      shownAttempts.current.delete(key);
      if (result.recorded) shown.current.add(key);
      setShownAccounting((current) => ({
        ...current,
        [key]: result.recorded
          ? { status: 'recorded', interventionId: result.interventionId }
          : { status: 'degraded' },
      }));
    }).catch(() => {
      shownAttempts.current.delete(key);
      setShownAccounting((current) => ({ ...current, [key]: { status: 'unavailable' } }));
    });
  }, []);
  useEffect(() => {
    const unique = (query.data?.active ?? []).filter((suggestion, index, all) =>
      all.findIndex((candidate) => candidate.issueKey === suggestion.issueKey) === index);
    for (const suggestion of unique) {
      recordShown(suggestion);
    }
  }, [query.data, recordShown]);
  if (query.isError) return <div className="p-4"><ErrorCard message={t('advice.loadError', 'Failed to load advice')} onRetry={() => { void query.refetch(); }} /></div>;
  if (!query.data) return <div className="p-4"><Skeleton className="h-40 w-full" /></div>;
  const state = query.data;
  const activeSuggestions = state.active.filter((suggestion, index, all) =>
    all.findIndex((candidate) => candidate.issueKey === suggestion.issueKey) === index);
  const mutedSuggestions = state.muted.filter((suggestion, index, all) =>
    all.findIndex((candidate) => candidate.issueKey === suggestion.issueKey) === index);
  const visibleHistory = showAllHistory ? state.history.events : state.history.events.slice(0, 30);
  return (
    <div className="vibe-page">
      <header className="border-b border-foreground py-10"><p className="flex items-center gap-2 text-[10px] tracking-[.15em] text-muted-foreground vibe-mono"><BellRing className="h-4 w-4" />ADVISORY / 行动建议</p><h1 className="vibe-serif mt-5 text-4xl sm:text-6xl">把观察转成可验证的行动</h1><p className="mt-4 max-w-3xl text-sm leading-6 text-muted-foreground">建议只关联本地证据，不会阻塞工作，也不会编辑或发送提示词。采纳后需要用下一项同类任务验证收益。</p></header>
      {state.diagnostics.length > 0 && <p className="text-xs text-amber-700">{t('advice.degraded', 'Limited')}: {state.diagnostics.join(', ')}</p>}
      <section className="border-b py-8"><div className="grid gap-5 sm:grid-cols-4"><div><p className="text-xs text-muted-foreground">当前建议</p><p className="mt-2 vibe-serif text-3xl">{activeSuggestions.length}</p></div><div><p className="text-xs text-muted-foreground">已采纳</p><p className="mt-2 vibe-serif text-3xl">{state.attention.adopted}</p></div><div><p className="text-xs text-muted-foreground">已忽略</p><p className="mt-2 vibe-serif text-3xl">{state.attention.ignored}</p></div><div><p className="text-xs text-muted-foreground">已静音</p><p className="mt-2 vibe-serif text-3xl">{mutedSuggestions.length}</p></div></div></section>
      {state.strategic && <section className="grid border-b py-8 lg:grid-cols-[220px_1fr] lg:gap-8"><div><p className="vibe-mono text-[10px] tracking-[.14em] text-[#28666E]">来自 30 天工程画像</p><h2 className="vibe-serif mt-2 text-2xl">长期行动方向</h2><Link to="/improve" className="mt-3 inline-block border-b text-xs text-[#365D8D]">查看完整画像 →</Link></div><div><h3 className="text-lg font-semibold leading-7">{state.strategic.headline}</h3><p className="mt-2 text-sm leading-6 text-muted-foreground">{state.strategic.northStar}</p><div className="mt-5 grid border-t md:grid-cols-2">{state.strategic.actions.map((action, index) => <article key={`${action.title}-${index}`} className="border-b py-4 md:odd:border-r md:odd:pr-5 md:even:pl-5"><span className="vibe-mono text-[10px] text-[#D86F4B]">ACTION {String(index + 1).padStart(2, '0')}</span><h4 className="mt-2 text-sm font-semibold">{action.title}</h4><p className="mt-2 text-xs leading-5 text-muted-foreground">{action.rationale}</p></article>)}</div></div></section>}
      <section className="py-8"><div className="mb-3 flex items-end justify-between"><div><h2 className="vibe-serif text-2xl">当前建议</h2><p className="mt-1 text-xs text-muted-foreground">按证据解释、行动和验证方式组织。</p></div><span className="vibe-mono text-[10px] text-muted-foreground">{activeSuggestions.length} ACTIVE</span></div><div>{activeSuggestions.map((item) => {
        const accounting = shownAccounting[`${item.taskId}:${item.issueKey}`];
        return <SuggestionCard key={`${item.taskId}:${item.issueKey}`} suggestion={item} muted={false}
          interventionId={accounting?.interventionId} onRefresh={refresh} />;
      })}{activeSuggestions.length === 0 && <p className="text-sm text-muted-foreground">{t('advice.noActive', 'No active suggestions yet.')}</p>}</div></section>
      {mutedSuggestions.length > 0 && <details className="border-y py-5"><summary className="cursor-pointer text-sm font-semibold">已静音建议 · {mutedSuggestions.length}</summary><div className="mt-4">{mutedSuggestions.map((item) => <SuggestionCard key={`${item.taskId}:${item.issueKey}`} suggestion={item} muted onRefresh={refresh} />)}</div></details>}
      <section className="border-b py-8"><div className="mb-4 flex items-center justify-between gap-4"><div className="flex items-center gap-2"><h2 className="vibe-serif text-2xl">交互记录</h2><span title="观察覆盖表示解析器可判断的预期事件比例，不是建议正确率"><Info className="h-4 w-4 text-muted-foreground" /></span></div><span className="vibe-mono text-[10px] text-muted-foreground">{state.history.events.length} EVENTS</span></div><div className="border-t">{visibleHistory.map((event) => <Link key={event.id} to={`/tasks/${encodeURIComponent(event.taskId)}`} className="grid grid-cols-[1fr_auto_18px] items-center gap-4 border-b py-4 text-xs transition-colors hover:bg-primary/[.035]"><div><strong>{issueLabel(event.issueKey)}</strong><p className="mt-1 text-muted-foreground">{new Date(event.occurredAt).toLocaleString()} · 观察覆盖 {Math.round(event.coverage * 100)}%</p></div><span>{event.action === 'shown' ? '已展示' : event.action === 'adopted' ? '已采纳' : event.action === 'ignored' ? '已忽略' : '已关闭'}</span><ChevronRight className="h-3 w-3 text-muted-foreground" /></Link>)}{state.history.events.length === 0 && <p className="border-b py-5 text-sm text-muted-foreground">{t('advice.noHistory', 'No suggestion interactions yet.')}</p>}</div>{!showAllHistory && state.history.events.length > 30 && <button type="button" className="mt-4 min-h-11 border border-foreground px-4 text-xs font-semibold hover:bg-foreground hover:text-background" onClick={() => setShowAllHistory(true)}>显示更早的 {state.history.events.length - 30} 条记录</button>}<p className="mt-3 text-xs text-muted-foreground">点击记录可打开对应任务。观察覆盖只说明当前采集链路是否具备判断条件；它不表示建议正确率，也不证明建议造成了后续变化。</p></section>
      {state.history.comparisons.length > 0 && <section className="py-8"><h2 className="vibe-serif text-2xl">后续观察</h2><div className="mt-4 grid gap-5 md:grid-cols-2">{state.history.comparisons.map((comparison) => <article key={comparison.interventionId} className="border p-4 text-xs"><strong>{issueLabel(comparison.issueKey)}</strong><p className="mt-3">观察覆盖 {Math.round(comparison.baseline.coverage * 100)}% → {Math.round(comparison.followup.coverage * 100)}% · {comparison.followup.outcome}</p><p className="mt-2 text-muted-foreground">{t('advice.observational', 'Observational before/after only; no causal claim.')}</p></article>)}</div></section>}
    </div>
  );
}
