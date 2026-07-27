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

const trustLabels = { official: '官方', high: '高', medium: '中', limited: '有限' };
const breadthLabels = { high: '广', medium: '中', low: '窄', unknown: '未记录' };
const relevanceLabels = { high: '高', medium: '中', low: '低', unknown: '未判断' };
const effectLabels = {
  improved: '有改善',
  'no-clear-improvement': '无明确改善',
  'insufficient-evidence': '证据不足',
  'negative-impact': '产生负面影响',
  'not-reviewed': '未复盘',
};

function date(value: string | null | undefined) {
  if (!value) return '未记录';
  const parsed = new Date(/^\d{4}-\d{2}-\d{2} /.test(value) ? `${value.replace(' ', 'T')}Z` : value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleDateString('zh-CN');
}

export default function PracticeLibraryPage() {
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

  const effectByPractice = useMemo(() => new Map(
    (improvements.data?.plans ?? []).filter((plan) => plan.sourcePracticeId).map((plan) => {
      const outcome = plan.reviews[0]?.outcome ?? 'not-reviewed';
      return [plan.sourcePracticeId as string, outcome] as const;
    }),
  ), [improvements.data?.plans]);

  const tags = useMemo(() => [...new Set((practices.data?.practices ?? []).flatMap((item) => item.tags))].sort(), [practices.data]);
  const filtered = useMemo(() => (practices.data?.practices ?? []).filter((item) => {
    const itemEffect = effectByPractice.get(item.id) ?? 'not-reviewed';
    const isRecent = Date.now() - new Date(item.createdAt).getTime() <= 1000 * 60 * 60 * 24 * 30;
    return (!sourceType || item.sourceRefs.some((source) => source.sourceType === sourceType))
      && (!breadth || item.discussionBreadth === breadth)
      && (!recency || (recency === 'recent' ? isRecent : !isRecent))
      && (!effect || itemEffect === effect);
  }), [breadth, effect, effectByPractice, practices.data, recency, sourceType]);

  if (status.isLoading || practices.isLoading) {
    return <div className="vibe-page pb-16"><header className="border-b border-foreground py-10"><p className="vibe-mono text-[10px] tracking-[.16em] text-[#28666E]">PRACTICE LIBRARY</p><h1 className="vibe-serif mt-3 text-4xl">实践库</h1><p className="mt-3 text-sm text-muted-foreground">正在读取本地实践快照与来源链…</p></header><div className="grid gap-3 border-b py-8" aria-hidden>{[1, 2, 3].map((item) => <i key={item} className="h-28 animate-pulse bg-muted" />)}</div></div>;
  }
  if (status.isError || practices.isError) {
    return <div className="vibe-page pb-16"><header className="border-b border-foreground py-10"><h1 className="vibe-serif text-4xl">实践库</h1><p className="mt-3 text-sm text-destructive">无法读取实践快照。本地活动记录未受影响，请确认服务后重试。</p></header></div>;
  }

  const knowledge = status.data;
  return <div className="vibe-page pb-16">
    <header className="flex flex-col justify-between gap-6 border-b border-foreground py-10 lg:flex-row lg:items-end">
      <div><p className="vibe-mono text-[10px] tracking-[.16em] text-[#28666E]">PUBLIC EVIDENCE / LOCAL REVIEW</p><h1 className="vibe-serif mt-3 text-4xl sm:text-5xl">实践库</h1><p className="mt-3 max-w-3xl text-sm leading-6 text-muted-foreground">按来源链、时效和社区佐证查看当前证据支持的优先实践。公开资料只能提供依据，不能证明你的本地效果。</p></div>
      <form className="flex w-full max-w-xl gap-2" onSubmit={(event) => { event.preventDefault(); refresh.mutate(topic.trim() || undefined); }}>
        <label className="sr-only" htmlFor="practice-topic">研究主题</label>
        <input id="practice-topic" className="h-11 min-w-0 flex-1 border bg-background px-3 text-sm" value={topic} onChange={(event) => setTopic(event.target.value)} placeholder="按主题手动刷新，例如：多 Agent 委派" />
        <button type="submit" disabled={!knowledge?.authorization.enabled || refresh.isPending || knowledge?.generation.running} className="flex h-11 items-center gap-2 border border-foreground bg-foreground px-4 text-xs font-semibold text-background disabled:opacity-50"><RefreshCw className={`h-4 w-4 ${(refresh.isPending || knowledge?.generation.running) ? 'animate-spin' : ''}`} />刷新</button>
      </form>
    </header>

    <div className="flex flex-wrap items-center justify-between gap-2 border-b py-3 text-[10px] text-muted-foreground">
      <span>最近更新：{date(knowledge?.generation.lastCompletedAt ?? knowledge?.latestSnapshot?.createdAt)}</span>
      <span>{knowledge?.topicSource === 'local-analysis' ? '更新主题会结合本地分析关注点；本地分析不依赖实践库。' : '首次更新从通用 Agent 工作流主题开始；不需要先完成本地分析。'}</span>
      {!knowledge?.authorization.enabled && <span>自动更新已关闭，可在设置中开启</span>}
    </div>
    {knowledge?.generation.lastError && <p className="border-b border-amber-500 bg-amber-50 px-4 py-3 text-xs text-amber-900">上次研究失败：{knowledge.generation.lastError}。最近成功快照仍保留。</p>}

    <section className="mt-6 border-y border-foreground bg-card">
      <div className="grid gap-2 border-b p-4 sm:grid-cols-2 lg:grid-cols-6">
        <select aria-label="来源类型" className="h-11 border bg-background px-2 text-xs" value={sourceType} onChange={(event) => setSourceType(event.target.value)}><option value="">全部来源</option><option value="official">官方</option><option value="community">社区</option></select>
        <select aria-label="信任等级" className="h-11 border bg-background px-2 text-xs" value={trust} onChange={(event) => setTrust(event.target.value)}><option value="">全部信任等级</option><option value="official">官方</option><option value="high">高</option><option value="medium">中</option><option value="limited">有限</option></select>
        <select aria-label="讨论广度" className="h-11 border bg-background px-2 text-xs" value={breadth} onChange={(event) => setBreadth(event.target.value)}><option value="">全部讨论广度</option><option value="high">广</option><option value="medium">中</option><option value="low">窄</option><option value="unknown">未记录</option></select>
        <select aria-label="时效性" className="h-11 border bg-background px-2 text-xs" value={recency} onChange={(event) => setRecency(event.target.value)}><option value="">全部时效</option><option value="recent">30 天内</option><option value="older">30 天前</option></select>
        <select aria-label="相关标签" className="h-11 border bg-background px-2 text-xs" value={tag} onChange={(event) => setTag(event.target.value)}><option value="">全部标签</option>{tags.map((value) => <option key={value}>{value}</option>)}</select>
        <select aria-label="本地效果" className="h-11 border bg-background px-2 text-xs" value={effect} onChange={(event) => setEffect(event.target.value)}><option value="">全部本地状态</option>{Object.entries(effectLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
      </div>
      <div className="flex justify-between border-b px-4 py-3 text-[10px] text-muted-foreground"><span>{filtered.length} 条实践</span><span className="vibe-mono">SNAPSHOT {knowledge?.latestSnapshot?.snapshotVersion ?? '未生成'}</span></div>
      {filtered.length === 0 ? <div className="px-4 py-16 text-center"><h2 className="vibe-serif text-2xl">没有匹配的实践</h2><p className="mt-2 text-xs text-muted-foreground">调整筛选条件，或在设置中开启公开实践研究后刷新。</p></div> : filtered.map((item) => {
        const itemEffect = effectByPractice.get(item.id) ?? 'not-reviewed';
        return <article key={item.id} className="grid gap-5 border-b p-5 last:border-b-0 lg:grid-cols-[minmax(0,1.3fr)_minmax(300px,.8fr)_150px]">
          <div><p className="vibe-mono text-[10px] tracking-[.08em] text-muted-foreground">{item.sourceRefs.some((source) => source.sourceType === 'official') ? 'OFFICIAL + COMMUNITY' : 'COMMUNITY'} · 抓取 {date(item.createdAt)}</p><h2 className="vibe-serif mt-2 text-2xl">{item.title}</h2><p className="mt-3 text-sm font-semibold">当前证据支持的优先实践：{item.summary}</p><p className="mt-2 text-xs leading-5 text-muted-foreground"><strong className="text-foreground">适用条件：</strong>{item.applicability}</p><div className="mt-3 flex flex-wrap gap-1.5">{item.tags.map((value) => <span key={value} className="rounded-full border px-2 py-1 text-[10px]">{value}</span>)}<span className="rounded-full border px-2 py-1 text-[10px]">本地：{effectLabels[itemEffect]}</span></div></div>
          <div className="border-l pl-4 text-xs"><div className="grid grid-cols-2">{[['信任等级', trustLabels[item.sourceTrust]], ['讨论广度', breadthLabels[item.discussionBreadth]], ['时效性', item.recency], ['本地相关性', relevanceLabels[item.localRelevance]]].map(([label, value]) => <div key={label} className="border-b py-2"><span className="block text-[9px] text-muted-foreground">{label}</span><strong className="mt-1 block">{value}</strong></div>)}</div><details className="mt-3 border-t"><summary className="min-h-11 cursor-pointer py-3 font-semibold">来源链与冲突观点</summary><div className="space-y-3 pb-3">{item.sourceRefs.map((source) => <a key={source.url} href={source.url} target="_blank" rel="noreferrer" className="block border-l-2 pl-3 hover:text-[#28666E]"><span className="font-semibold">{source.title}</span><span className="mt-1 block text-[10px] text-muted-foreground">{source.author || source.sourceType} · {source.independentEvidence || '独立佐证未记录'}</span></a>)}{item.conflicts.length > 0 && <div className="border p-3"><strong>冲突观点</strong>{item.conflicts.map((value) => <p key={value} className="mt-1 text-[10px] text-muted-foreground">{value}</p>)}</div>}</div></details></div>
          <div className="grid content-start gap-2"><button type="button" disabled={track.isPending || Boolean(effectByPractice.has(item.id))} onClick={() => track.mutate(item.id)} className="h-11 border border-foreground bg-foreground px-3 text-xs font-semibold text-background disabled:opacity-50">{effectByPractice.has(item.id) ? '已加入追踪' : '添加为改进计划'}</button>{item.sourceRefs[0] && <a href={item.sourceRefs[0].url} target="_blank" rel="noreferrer" className="flex h-11 items-center justify-center gap-2 border px-3 text-xs font-semibold">查看首要来源<ExternalLink className="h-3.5 w-3.5" /></a>}</div>
        </article>;
      })}
    </section>

  </div>;
}
