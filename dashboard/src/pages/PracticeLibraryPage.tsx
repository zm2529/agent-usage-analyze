import { useMemo, useState } from 'react';
import { ExternalLink, RefreshCw } from 'lucide-react';
import { useImprovements } from '@/hooks/useImprovements';
import {
  useKnowledgePractices,
  useKnowledgeStatus,
  useRefreshKnowledgeResearch,
  useTrackKnowledgePractice,
} from '@/hooks/usePractices';
import type { KnowledgePractice } from '@/lib/api';
import { useLanguage } from '@/i18n/LanguageProvider';
import { useLocalizedGeneratedContent } from '@/hooks/useLocalizedGeneratedContent';

function date(value: string | null | undefined, language: 'en' | 'zh-CN') {
  if (!value) return language === 'zh-CN' ? '未记录' : 'Not recorded';
  const parsed = new Date(/^\d{4}-\d{2}-\d{2} /.test(value) ? `${value.replace(' ', 'T')}Z` : value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleDateString(language === 'zh-CN' ? 'zh-CN' : 'en-US');
}

export default function PracticeLibraryPage() {
  const { language } = useLanguage();
  const cn = language === 'zh-CN';
  const trustLabels = cn ? { official: '官方', high: '高', medium: '中', limited: '有限' }
    : { official: 'Official', high: 'High', medium: 'Medium', limited: 'Limited' };
  const breadthLabels = cn ? { high: '广', medium: '中', low: '窄', unknown: '未记录' }
    : { high: 'Broad', medium: 'Medium', low: 'Narrow', unknown: 'Unknown' };
  const relevanceLabels = cn ? { high: '高', medium: '中', low: '低', unknown: '未判断' }
    : { high: 'High', medium: 'Medium', low: 'Low', unknown: 'Unknown' };
  const effectLabels = cn ? {
    improved: '有改善', 'no-clear-improvement': '无明确改善', 'insufficient-evidence': '证据不足',
    'negative-impact': '产生负面影响', 'not-reviewed': '未复盘',
  } : {
    improved: 'Improved', 'no-clear-improvement': 'No clear improvement', 'insufficient-evidence': 'Insufficient evidence',
    'negative-impact': 'Negative impact', 'not-reviewed': 'Not reviewed',
  };
  const [topic, setTopic] = useState('');
  const [sourceType, setSourceType] = useState('');
  const [trust, setTrust] = useState('');
  const [breadth, setBreadth] = useState('');
  const [recency, setRecency] = useState('');
  const [tag, setTag] = useState('');
  const [effect, setEffect] = useState('');
  const status = useKnowledgeStatus();
  const practices = useKnowledgePractices({
    trust: trust ? trust as KnowledgePractice['sourceTrust'] : undefined,
    tag: tag || undefined,
  });
  const improvements = useImprovements();
  const refresh = useRefreshKnowledgeResearch();
  const track = useTrackKnowledgePractice();
  const localizedPractices = useLocalizedGeneratedContent(practices.data?.practices);

  const effectByPractice = useMemo(() => new Map(
    (improvements.data?.plans ?? []).filter((plan) => plan.sourcePracticeId).map((plan) => {
      const outcome = plan.reviews[0]?.outcome ?? 'not-reviewed';
      return [plan.sourcePracticeId as string, outcome] as const;
    }),
  ), [improvements.data?.plans]);

  const visiblePractices = localizedPractices.data ?? practices.data?.practices ?? [];
  const tags = useMemo(() => [...new Set(visiblePractices.flatMap((item) => item.tags))].sort(), [visiblePractices]);
  const filtered = useMemo(() => visiblePractices.filter((item) => {
    const itemEffect = effectByPractice.get(item.id) ?? 'not-reviewed';
    const isRecent = Date.now() - new Date(item.createdAt).getTime() <= 1000 * 60 * 60 * 24 * 30;
    return (!sourceType || item.sourceRefs.some((source) => source.sourceType === sourceType))
      && (!breadth || item.discussionBreadth === breadth)
      && (!recency || (recency === 'recent' ? isRecent : !isRecent))
      && (!effect || itemEffect === effect);
  }), [breadth, effect, effectByPractice, visiblePractices, recency, sourceType]);

  if (status.isLoading || practices.isLoading) {
    return <div className="vibe-page pb-16"><header className="border-b border-foreground py-10"><p className="vibe-mono text-[10px] tracking-[.16em] text-[#28666E]">PRACTICE LIBRARY</p><h1 className="vibe-serif mt-3 text-4xl">{cn ? '实践库' : 'Practice Library'}</h1><p className="mt-3 text-sm text-muted-foreground">{cn ? '正在读取本地实践快照与来源链…' : 'Loading the local practice snapshot and source chain…'}</p></header><div className="grid gap-3 border-b py-8" aria-hidden>{[1, 2, 3].map((item) => <i key={item} className="h-28 animate-pulse bg-muted" />)}</div></div>;
  }
  if (status.isError || practices.isError) {
    return <div className="vibe-page pb-16"><header className="border-b border-foreground py-10"><h1 className="vibe-serif text-4xl">{cn ? '实践库' : 'Practice Library'}</h1><p className="mt-3 text-sm text-destructive">{cn ? '无法读取实践快照，请确认服务后重试。' : 'Could not load the practice snapshot. Check the service and retry.'}</p></header></div>;
  }

  const knowledge = status.data;
  return <div className="vibe-page pb-16">
    <header className="flex flex-col justify-between gap-6 border-b border-foreground py-10 lg:flex-row lg:items-end">
      <div><p className="vibe-mono text-[10px] tracking-[.16em] text-[#28666E]">PUBLIC EVIDENCE / LOCAL REVIEW</p><h1 className="vibe-serif mt-3 text-4xl sm:text-5xl">{cn ? '实践库' : 'Practice Library'}</h1><p className="mt-3 max-w-3xl text-sm leading-6 text-muted-foreground">{cn ? '按来源链、时效和社区佐证查看当前证据支持的优先实践。' : 'Review current practices by source chain, recency, and community corroboration.'}</p></div>
      <form className="flex w-full max-w-xl gap-2" onSubmit={(event) => { event.preventDefault(); refresh.mutate(topic.trim() || undefined); }}>
        <label className="sr-only" htmlFor="practice-topic">{cn ? '研究主题' : 'Research topic'}</label>
        <input id="practice-topic" className="h-11 min-w-0 flex-1 border bg-background px-3 text-sm" value={topic} onChange={(event) => setTopic(event.target.value)} placeholder={cn ? '按主题刷新，例如：多 Agent 委派' : 'Refresh by topic, e.g. multi-agent delegation'} />
        <button type="submit" disabled={!knowledge?.authorization.enabled || refresh.isPending || knowledge?.generation.running || knowledge?.generation.queued} className="flex h-11 items-center gap-2 border border-foreground bg-foreground px-4 text-xs font-semibold text-background disabled:opacity-50"><RefreshCw className={`h-4 w-4 ${(refresh.isPending || knowledge?.generation.running) ? 'animate-spin' : ''}`} />{cn ? '刷新' : 'Refresh'}</button>
      </form>
    </header>

    <div className="flex flex-wrap items-center justify-between gap-2 border-b py-3 text-[10px] text-muted-foreground">
      <span>{cn ? '最近更新' : 'Last updated'}: {date(knowledge?.generation.lastCompletedAt ?? knowledge?.latestSnapshot?.createdAt, language)}</span>
      <span>{knowledge?.topicSource === 'local-analysis' ? (cn ? '更新主题来自本地分析关注点' : 'Topics reflect local analysis priorities') : (cn ? '首次更新使用通用 Agent 工作流主题' : 'The first refresh uses general Agent workflow topics')}</span>
      {!knowledge?.authorization.enabled && <span>{cn ? '自动更新已关闭，可在设置中开启' : 'Automatic refresh is off; enable it in Settings'}</span>}
    </div>
    {localizedPractices.isFetching && <p className="border-b px-4 py-3 text-xs text-muted-foreground">{cn ? '正在后台准备中文实践内容，完成后自动更新…' : 'Preparing the English practice content in the background; this page will update automatically…'}</p>}
    {localizedPractices.isError && <div className="flex items-center justify-between gap-4 border-b border-amber-500 px-4 py-3 text-xs">
      <span>{cn ? '实践内容暂未完成中文转换。' : 'Practice content could not be translated yet.'}</span>
      <button type="button" className="font-semibold underline" onClick={() => { void localizedPractices.refetch(); }}>{cn ? '重试' : 'Retry'}</button>
    </div>}
    {knowledge?.generation.queued && <p className="border-b px-4 py-3 text-xs text-muted-foreground">{cn ? '本地导入或任务分析正在写入数据；完成后会自动开始公开研究。' : 'Local import or task analysis is writing data. Public research will start automatically when it finishes.'}</p>}
    {knowledge?.generation.lastError && <p className="border-b border-amber-500 bg-amber-50 px-4 py-3 text-xs text-amber-900">{cn ? '上次研究失败' : 'Last research run failed'}: {knowledge.generation.lastError}</p>}

    <section className="mt-6 border-y border-foreground bg-card">
      <div className="grid gap-2 border-b p-4 sm:grid-cols-2 lg:grid-cols-6">
        <select aria-label={cn ? '来源类型' : 'Source type'} className="h-11 border bg-background px-2 text-xs" value={sourceType} onChange={(event) => setSourceType(event.target.value)}><option value="">{cn ? '全部来源' : 'All sources'}</option><option value="official">{cn ? '官方' : 'Official'}</option><option value="community">{cn ? '社区' : 'Community'}</option></select>
        <select aria-label={cn ? '信任等级' : 'Trust level'} className="h-11 border bg-background px-2 text-xs" value={trust} onChange={(event) => setTrust(event.target.value)}><option value="">{cn ? '全部信任等级' : 'All trust levels'}</option>{Object.entries(trustLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
        <select aria-label={cn ? '讨论广度' : 'Discussion breadth'} className="h-11 border bg-background px-2 text-xs" value={breadth} onChange={(event) => setBreadth(event.target.value)}><option value="">{cn ? '全部讨论广度' : 'All breadths'}</option>{Object.entries(breadthLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
        <select aria-label={cn ? '时效性' : 'Recency'} className="h-11 border bg-background px-2 text-xs" value={recency} onChange={(event) => setRecency(event.target.value)}><option value="">{cn ? '全部时效' : 'Any age'}</option><option value="recent">{cn ? '30 天内' : 'Last 30 days'}</option><option value="older">{cn ? '30 天前' : 'Older than 30 days'}</option></select>
        <select aria-label={cn ? '相关标签' : 'Tag'} className="h-11 border bg-background px-2 text-xs" value={tag} onChange={(event) => setTag(event.target.value)}><option value="">{cn ? '全部标签' : 'All tags'}</option>{tags.map((value) => <option key={value}>{value}</option>)}</select>
        <select aria-label={cn ? '本地效果' : 'Local effect'} className="h-11 border bg-background px-2 text-xs" value={effect} onChange={(event) => setEffect(event.target.value)}><option value="">{cn ? '全部本地状态' : 'All local states'}</option>{Object.entries(effectLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
      </div>
      <div className="flex justify-between border-b px-4 py-3 text-[10px] text-muted-foreground"><span>{filtered.length} {cn ? '条实践' : 'practices'}</span><span className="vibe-mono">SNAPSHOT {knowledge?.latestSnapshot?.snapshotVersion ?? (cn ? '未生成' : 'not generated')}</span></div>
      {filtered.length === 0 ? <div className="px-4 py-16 text-center"><h2 className="vibe-serif text-2xl">{cn ? '没有匹配的实践' : 'No matching practices'}</h2><p className="mt-2 text-xs text-muted-foreground">{cn ? '调整筛选条件，或在设置中开启公开实践研究后刷新。' : 'Adjust filters or enable public practice research in Settings.'}</p></div> : filtered.map((item) => {
        const itemEffect = effectByPractice.get(item.id) ?? 'not-reviewed';
        return <article key={item.id} className="grid gap-5 border-b p-5 last:border-b-0 lg:grid-cols-[minmax(0,1.3fr)_minmax(300px,.8fr)_150px]">
          <div><p className="vibe-mono text-[10px] tracking-[.08em] text-muted-foreground">{item.sourceRefs.some((source) => source.sourceType === 'official') ? 'OFFICIAL + COMMUNITY' : 'COMMUNITY'} · {cn ? '抓取' : 'FETCHED'} {date(item.createdAt, language)}</p><h2 className="vibe-serif mt-2 text-2xl">{item.title}</h2><p className="mt-3 text-sm font-semibold">{cn ? '当前证据支持的优先实践' : 'Current evidence-supported practice'}: {item.summary}</p><p className="mt-2 text-xs leading-5 text-muted-foreground"><strong className="text-foreground">{cn ? '适用条件' : 'Applies when'}: </strong>{item.applicability}</p><div className="mt-3 flex flex-wrap gap-1.5">{item.tags.map((value) => <span key={value} className="rounded-full border px-2 py-1 text-[10px]">{value}</span>)}<span className="rounded-full border px-2 py-1 text-[10px]">{cn ? '本地' : 'Local'}: {effectLabels[itemEffect]}</span></div></div>
          <div className="border-l pl-4 text-xs"><div className="grid grid-cols-2">{[[cn ? '信任等级' : 'Trust', trustLabels[item.sourceTrust]], [cn ? '讨论广度' : 'Breadth', breadthLabels[item.discussionBreadth]], [cn ? '时效性' : 'Recency', item.recency], [cn ? '本地相关性' : 'Local relevance', relevanceLabels[item.localRelevance]]].map(([label, value]) => <div key={label} className="border-b py-2"><span className="block text-[9px] text-muted-foreground">{label}</span><strong className="mt-1 block">{value}</strong></div>)}</div><details className="mt-3 border-t"><summary className="min-h-11 cursor-pointer py-3 font-semibold">{cn ? '来源链与冲突观点' : 'Sources and conflicting views'}</summary><div className="space-y-3 pb-3">{item.sourceRefs.map((source) => <a key={source.url} href={source.url} target="_blank" rel="noreferrer" className="block border-l-2 pl-3 hover:text-[#28666E]"><span className="font-semibold">{source.title}</span><span className="mt-1 block text-[10px] text-muted-foreground">{source.author || source.sourceType} · {source.independentEvidence || (cn ? '独立佐证未记录' : 'No independent corroboration recorded')}</span></a>)}{item.conflicts.length > 0 && <div className="border p-3"><strong>{cn ? '冲突观点' : 'Conflicting views'}</strong>{item.conflicts.map((value) => <p key={value} className="mt-1 text-[10px] text-muted-foreground">{value}</p>)}</div>}</div></details></div>
          <div className="grid content-start gap-2"><button type="button" disabled={track.isPending || Boolean(effectByPractice.has(item.id))} onClick={() => track.mutate(item.id)} className="h-11 border border-foreground bg-foreground px-3 text-xs font-semibold text-background disabled:opacity-50">{effectByPractice.has(item.id) ? (cn ? '已加入追踪' : 'Tracking') : (cn ? '添加为改进计划' : 'Add improvement plan')}</button>{item.sourceRefs[0] && <a href={item.sourceRefs[0].url} target="_blank" rel="noreferrer" className="flex h-11 items-center justify-center gap-2 border px-3 text-xs font-semibold">{cn ? '查看首要来源' : 'Open primary source'}<ExternalLink className="h-3.5 w-3.5" /></a>}</div>
        </article>;
      })}
    </section>

  </div>;
}
