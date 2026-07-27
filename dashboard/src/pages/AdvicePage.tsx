import { Link } from 'react-router';
import { BellRing } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useAdvice } from '@/hooks/useAdvice';
import { clearAdviceMute, setAdviceMute } from '@/lib/api';
import { eventAnchorHref } from '@/lib/event-links';
import { Badge } from '@/components/ui/badge';
import { ErrorCard } from '@/components/ErrorCard';
import { Skeleton } from '@/components/ui/skeleton';
import type { AdvisorySuggestion } from '@/lib/types';
import { useLanguage } from '@/i18n/LanguageProvider';
import { localizedAdviceCopy } from '@/lib/advice-copy';

function SuggestionCard({ suggestion, muted, onRefresh }: {
  suggestion: AdvisorySuggestion; muted: boolean; onRefresh: () => void;
}) {
  const { t } = useLanguage();
  const copy = localizedAdviceCopy(t, suggestion);
  const normalizedTitle = issueLabel(suggestion.issueKey);
  const toggleMute = async () => {
    if (muted) await clearAdviceMute({ scopeKind: 'issue', scopeKey: suggestion.issueKey });
    else await setAdviceMute({ scopeKind: 'issue', scopeKey: suggestion.issueKey, mutedUntil: null });
    onRefresh();
  };
  return (
    <article className="grid border-t py-6 lg:grid-cols-[160px_minmax(0,1fr)] lg:gap-7">
      <div><Badge variant={muted ? 'secondary' : 'outline'}>{muted ? t('advice.muted', 'Muted') : '近期会话'}</Badge></div>
      <div className="mt-4 space-y-3 lg:mt-0"><h3 className="vibe-serif text-xl">{normalizedTitle === '改进建议' ? copy.title : normalizedTitle}</h3><p className="text-sm leading-6">{copy.triggerFact}</p>
        <div className="grid gap-3 text-xs sm:grid-cols-2"><p className="border-l-2 border-[#4F775F] pl-3"><strong className="block">预期收益</strong><span className="mt-1 block leading-5 text-muted-foreground">{copy.expectedBenefit}</span></p><p className="border-l-2 border-[#365D8D] pl-3"><strong className="block">如何验证建议是否有用</strong><span className="mt-1 block leading-5 text-muted-foreground">{copy.verification}</span></p></div>
        <details className="text-xs text-muted-foreground"><summary className="cursor-pointer text-[#365D8D]">证据与适用范围 · {suggestion.evidenceRefs.length} 项</summary><p className="mt-2 leading-5">置信度 {Math.round(suggestion.confidence * 100)}%；观察覆盖 {Math.round(suggestion.coverage * 100)}%，表示当前解析器能判断的预期事件比例，不代表建议正确率。</p><div className="mt-2 flex flex-wrap gap-3">{suggestion.evidenceRefs.map((eventId, index) => (
          <Link key={eventId} className="border-b border-[#365D8D]" to={eventAnchorHref(suggestion.taskId, eventId)}>证据 {index + 1}</Link>
        ))}</div></details>
      </div>
      <button
        type="button"
        aria-label={`${muted ? t('advice.unmute', 'Unmute') : t('advice.mute', 'Mute issue')} ${issueLabel(suggestion.issueKey)}`}
        onClick={() => { void toggleMute(); }}
        className="mt-4 w-fit border-b text-xs text-muted-foreground hover:text-foreground lg:col-start-2"
      >
        {muted ? '重新显示此类建议' : '不再显示此类建议'}
      </button>
    </article>
  );
}

function issueLabel(issueKey: string): string {
  if (issueKey.includes('validation-missing')) return '记录明确显示未进行验证';
  if (issueKey.includes('late-constraint')) return '关键约束出现较晚';
  if (issueKey.includes('waiting')) return '工具等待时间较长';
  return '改进建议';
}

function strategicCategoryLabel(category: 'overall' | 'skill' | 'model' | 'reasoning'): string {
  if (category === 'skill') return 'Skill';
  if (category === 'model') return '模型';
  if (category === 'reasoning') return '推理强度';
  return '整体使用';
}

export default function AdvicePage() {
  const { t } = useLanguage();
  const query = useAdvice();
  const queryClient = useQueryClient();
  const refresh = () => { void queryClient.invalidateQueries({ queryKey: ['advice'] }); };
  if (query.isError) return <div className="p-4"><ErrorCard message={t('advice.loadError', 'Failed to load advice')} onRetry={() => { void query.refetch(); }} /></div>;
  if (!query.data) return <div className="p-4"><Skeleton className="h-40 w-full" /></div>;
  const state = query.data;
  const activeSuggestions = state.active.filter((suggestion, index, all) =>
    all.findIndex((candidate) => candidate.issueKey === suggestion.issueKey) === index);
  const mutedSuggestions = state.muted.filter((suggestion, index, all) =>
    all.findIndex((candidate) => candidate.issueKey === suggestion.issueKey) === index);
  const strategicActions = state.strategic?.actions ?? [];
  const suggestionCount = strategicActions.length + activeSuggestions.length;
  return (
    <div className="vibe-page">
      <header className="border-b border-foreground py-10"><p className="flex items-center gap-2 text-[10px] tracking-[.15em] text-muted-foreground vibe-mono"><BellRing className="h-4 w-4" />ADVISORY / 行动建议</p><div className="mt-5 flex flex-wrap items-end justify-between gap-5"><div><h1 className="vibe-serif text-4xl sm:text-6xl">看看哪些地方可以改进</h1><p className="mt-4 max-w-3xl text-sm leading-6 text-muted-foreground">结合近期会话与整体使用分析，整理出值得优先尝试的改进方向。</p></div><div className="text-right"><strong className="vibe-serif text-4xl">{suggestionCount}</strong><span className="ml-2 text-xs text-muted-foreground">条建议</span></div></div></header>
      {state.diagnostics.length > 0 && <p className="text-xs text-amber-700">{t('advice.degraded', 'Limited')}: {state.diagnostics.join(', ')}</p>}
      <section className="py-8">
        <div className="mb-3 flex items-end justify-between"><div><h2 className="vibe-serif text-2xl">建议清单</h2><p className="mt-1 text-xs text-muted-foreground">每条建议都说明它关注的问题，以及可能带来的帮助。</p></div>{state.strategic && <Link to="/improve" className="border-b text-xs text-[#365D8D]">查看完整分析 →</Link>}</div>
        <div>
          {strategicActions.map((action, index) => <article key={`${action.title}-${index}`} className="grid border-t py-6 lg:grid-cols-[160px_minmax(0,1fr)] lg:gap-7"><div><Badge variant="outline">{strategicCategoryLabel(action.category)}</Badge></div><div className="mt-4 lg:mt-0"><h3 className="vibe-serif text-xl">{action.title}</h3><p className="mt-3 text-sm leading-6 text-muted-foreground">{action.rationale}</p>{(action.recommendation || action.applicability) && <div className="mt-4 grid gap-3 text-xs sm:grid-cols-2">{action.recommendation && <p className="border-l-2 border-[#4F775F] pl-3"><strong className="block">可以怎么做</strong><span className="mt-1 block leading-5 text-muted-foreground">{action.recommendation}</span></p>}{action.applicability && <p className="border-l-2 border-[#365D8D] pl-3"><strong className="block">适用任务</strong><span className="mt-1 block leading-5 text-muted-foreground">{action.applicability}</span></p>}</div>}</div></article>)}
          {activeSuggestions.map((item) => <SuggestionCard key={`${item.taskId}:${item.issueKey}`} suggestion={item} muted={false} onRefresh={refresh} />)}
          {suggestionCount === 0 && <p className="border-t py-10 text-sm text-muted-foreground">{t('advice.noActive', 'No active suggestions yet.')}</p>}
        </div>
      </section>
      {mutedSuggestions.length > 0 && <details className="border-y py-5"><summary className="cursor-pointer text-sm font-semibold">已静音建议 · {mutedSuggestions.length}</summary><div className="mt-4">{mutedSuggestions.map((item) => <SuggestionCard key={`${item.taskId}:${item.issueKey}`} suggestion={item} muted onRefresh={refresh} />)}</div></details>}
    </div>
  );
}
