import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import {
  useImprovementFeedback,
  useImprovements,
  useReviewImprovement,
  useUpdateImprovementStatus,
} from '@/hooks/useImprovements';
import type { ImprovementPlan } from '@/lib/api';

const statusLabels = { queued: '排队', observing: '自动观察', 'review-ready': '待复盘', reviewed: '已复盘', paused: '已暂停', ended: '已结束' };
const signalLabels = { eligible: '匹配适用任务', 'adoption-observed': '观察到采用信号', 'adoption-not-observed': '尚未观察到', 'counter-evidence': '出现反证', 'negative-impact': '出现负面影响' };
const outcomeLabels = { improved: '有改善', 'no-clear-improvement': '无明确改善', 'insufficient-evidence': '证据不足', 'negative-impact': '产生负面影响' };

function elapsedDays(value: string) {
  return Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 86_400_000));
}

function PlanRow({ plan, busy }: { plan: ImprovementPlan; busy: boolean }) {
  const [note, setNote] = useState('');
  const [kind, setKind] = useState<'judgment-wrong' | 'not-applicable' | 'continue-observing' | 'end-tracking'>('judgment-wrong');
  const review = useReviewImprovement();
  const update = useUpdateImprovementStatus();
  const feedback = useImprovementFeedback();
  const latestReview = plan.reviews[0];
  const llm = plan.reviewPlan.llmDefined;
  const days = elapsedDays(plan.createdAt);
  const taskProgress = Math.min(100, Math.round(plan.matchedTaskCount / Math.max(1, plan.maxTaskCount) * 100));

  return <article className="grid gap-5 border-b p-5 last:border-b-0 xl:grid-cols-[48px_minmax(0,1.2fr)_minmax(300px,.8fr)_160px]">
    <span className="vibe-mono text-xs text-muted-foreground">{String(plan.sequence).padStart(2, '0')}</span>
    <div><div className="flex flex-wrap gap-2"><span className="rounded-full border px-2 py-1 text-[10px]">{statusLabels[plan.status]}</span>{plan.basisChanged && <span className="rounded-full border border-amber-500 bg-amber-500/10 px-2 py-1 text-[10px] text-amber-700 dark:text-amber-300">建议提前复盘</span>}</div><h2 className="vibe-serif mt-3 text-2xl">{plan.title}</h2><p className="mt-2 text-xs leading-5 text-muted-foreground"><strong className="text-foreground">希望改善：</strong>{plan.hypothesis}</p><p className="mt-2 text-xs leading-5 text-muted-foreground"><strong className="text-foreground">适用任务：</strong>{plan.applicability}</p>{plan.sourcePracticeTitle && <p className="mt-2 text-[10px] text-muted-foreground">参考实践：{plan.sourcePracticeTitle}</p>}{plan.earlyReviewRecommended && <p className="mt-3 border-l-2 border-amber-500 pl-3 text-xs text-amber-700 dark:text-amber-300">参考依据已有更新，建议提前检查这项改进是否仍然适用。</p>}{latestReview && <div className="mt-4 border-y py-3"><strong className="text-sm">{outcomeLabels[latestReview.outcome]}</strong><p className="mt-1 text-xs leading-5 text-muted-foreground">{latestReview.rationale}</p>{latestReview.limitations.length > 0 && <p className="mt-1 text-[10px] text-muted-foreground">限制：{latestReview.limitations.join('；')}</p>}</div>}</div>
    <div className="border-l pl-4"><p className="text-[10px] text-muted-foreground">观察条件</p><dl className="mt-2 text-xs"><div className="border-t py-2"><dt className="text-[10px] text-muted-foreground">适用范围</dt><dd className="mt-1">{llm?.eligibleTasks ?? '正在准备'}</dd></div><div className="border-t py-2"><dt className="text-[10px] text-muted-foreground">关注变化</dt><dd className="mt-1">{llm?.observableOutcome ?? '正在准备'}</dd></div><div className="border-t py-2"><dt className="text-[10px] text-muted-foreground">注意事项</dt><dd className="mt-1">{llm?.guardrail ?? '正在准备'}</dd></div><div className="border-t py-2"><dt className="text-[10px] text-muted-foreground">何时复盘</dt><dd className="mt-1">{llm?.reviewWhen ?? '正在准备'}</dd></div></dl><div className="mt-3 h-1.5 bg-muted"><i className="block h-full bg-[#28666E]" style={{ width: `${taskProgress}%` }} /></div><div className="mt-2 flex justify-between text-[10px] text-muted-foreground"><span>已观察 {plan.matchedTaskCount} / {plan.maxTaskCount} 项任务</span><span>{days} / {plan.maxObservationDays} 天</span></div><details className="mt-3 border-t"><summary className="min-h-11 cursor-pointer py-3 text-xs font-semibold">观察记录 · {plan.observations.length}</summary><div className="space-y-2 pb-3">{plan.observations.length === 0 ? <p className="text-[10px] text-muted-foreground">暂时还没有符合条件的新任务。</p> : plan.observations.map((item) => <div key={item.id} className="border-l-2 pl-3 text-[10px]"><strong>{signalLabels[item.signal]}</strong><p className="mt-1 text-muted-foreground">{item.rationale}</p></div>)}</div></details></div>
    <div className="grid content-start gap-2"><button type="button" disabled={busy || update.isPending || plan.status === 'reviewed' || plan.status === 'ended'} onClick={() => update.mutate({ planId: plan.id, status: plan.status === 'paused' ? 'observing' : 'paused' })} className="h-11 border px-3 text-xs font-semibold">{plan.status === 'paused' ? '继续观察' : '暂停观察'}</button><button type="button" disabled={busy || review.isPending || plan.status === 'reviewed' || plan.status === 'ended'} onClick={() => review.mutate(plan.id)} className="h-11 border border-foreground bg-foreground px-3 text-xs font-semibold text-background">{plan.status === 'review-ready' || plan.earlyReviewRecommended ? '进入复盘' : '提前复盘'}</button><details className="border"><summary className="min-h-11 cursor-pointer px-3 py-3 text-xs font-semibold">纠正系统判断</summary><form className="space-y-2 border-t p-3" onSubmit={(event) => { event.preventDefault(); feedback.mutate({ planId: plan.id, kind, note: note.trim() || undefined }); }}><select aria-label="纠正类型" className="h-11 w-full border bg-background px-2 text-xs" value={kind} onChange={(event) => setKind(event.target.value as typeof kind)}><option value="judgment-wrong">系统判断有误</option><option value="not-applicable">这类任务不适用</option><option value="continue-observing">继续观察</option><option value="end-tracking">结束追踪</option></select><textarea aria-label="纠正说明" className="min-h-20 w-full border bg-background p-2 text-xs" value={note} onChange={(event) => setNote(event.target.value)} placeholder="可选说明，只保存在本地" /><button type="submit" disabled={feedback.isPending} className="h-11 w-full border px-3 text-xs font-semibold">保存本地纠正</button></form></details></div>
  </article>;
}

export default function ImprovementTrackingPage() {
  const state = useImprovements();
  const plans = state.data?.plans ?? [];
  const creationAvailability = state.data?.creationAvailability;
  const counts = useMemo(() => ({
    observing: plans.filter((plan) => plan.status === 'observing').length,
    queued: plans.filter((plan) => plan.status === 'queued').length,
    ready: plans.filter((plan) => plan.status === 'review-ready').length,
    reviewed: plans.filter((plan) => plan.status === 'reviewed').length,
  }), [plans]);

  if (state.isLoading) return <div className="vibe-page pb-16"><header className="border-b border-foreground py-10"><p className="vibe-mono text-[10px] tracking-[.16em] text-[#28666E]">IMPROVEMENT TRACKING</p><h1 className="vibe-serif mt-3 text-4xl">改进追踪</h1><p className="mt-3 text-sm text-muted-foreground">正在读取改进计划…</p></header><div className="grid gap-3 border-b py-8" aria-hidden>{[1, 2, 3].map((item) => <i key={item} className="h-32 animate-pulse bg-muted" />)}</div></div>;
  if (state.isError) return <div className="vibe-page pb-16"><header className="border-b border-foreground py-10"><h1 className="vibe-serif text-4xl">改进追踪</h1><p className="mt-3 text-sm text-destructive">无法读取改进计划。本地会话记录未受影响。</p></header></div>;

  return <div className="vibe-page pb-16">
    <header className="border-b border-foreground py-10"><p className="vibe-mono text-[10px] tracking-[.16em] text-[#28666E]">AUTOMATIC OBSERVATION / LOCAL REVIEW</p><h1 className="vibe-serif mt-3 text-4xl sm:text-5xl">改进追踪</h1><p className="mt-3 max-w-3xl text-sm leading-6 text-muted-foreground">自动找到适用任务并记录变化；判断不准确时可以随时纠正。有依赖的计划会依次开始，其余计划可以同时观察。</p></header>
    <section className="grid border-b border-foreground bg-card sm:grid-cols-4">{[['自动观察', counts.observing], ['排队', counts.queued], ['待复盘', counts.ready], ['已复盘', counts.reviewed]].map(([label, value]) => <div key={label} className="border-b p-4 last:border-b-0 sm:border-b-0 sm:border-r sm:last:border-r-0"><span className="text-[10px] text-muted-foreground">{label}</span><strong className="vibe-mono mt-2 block text-2xl">{value}</strong></div>)}</section>
    {state.data?.generation.lastError && <p className="border-b border-amber-500 bg-amber-50 px-4 py-3 text-xs text-amber-900">上次操作失败：{state.data.generation.lastError}</p>}
    <section className="mt-6 border-y border-foreground bg-card">{plans.length === 0 ? <div className="px-4 py-16 text-center"><h2 className="vibe-serif text-2xl">尚无改进计划</h2><p className="mx-auto mt-2 max-w-2xl text-xs leading-5 text-muted-foreground">{creationAvailability?.analysis === 'requires-refresh' ? '重新分析后会生成适合追踪的改进计划。' : creationAvailability?.analysis === 'available' ? '当前分析没有生成适合追踪的计划，也可以从实践库选择一条实践。' : '完成首次分析后会生成适合追踪的改进计划，也可以从实践库选择一条实践。'}</p><div className="mt-5 flex justify-center gap-3"><Link to="/analysis" className="border border-foreground bg-foreground px-4 py-2.5 text-xs font-semibold text-background">{creationAvailability?.analysis === 'requires-refresh' ? '重新分析' : '前往分析'}</Link><Link to="/practices" className="border px-4 py-2.5 text-xs font-semibold">打开实践库</Link></div></div> : plans.map((plan) => <PlanRow key={plan.id} plan={plan} busy={Boolean(state.data?.generation.running)} />)}</section>
  </div>;
}
