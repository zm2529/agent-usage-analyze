import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { ChevronRight, Filter, Search, Sparkles, X } from 'lucide-react';
import { useSessionsPage } from '@/hooks/useSessions';
import { useProjects } from '@/hooks/useProjects';
import { useFilterParams } from '@/hooks/useFilterParams';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { SourceToolSelect } from '@/components/filters/SourceToolSelect';
import { getSessionTitle, formatDuration } from '@/lib/utils';
import { useLanguage } from '@/i18n/LanguageProvider';
import { useLocalizedGeneratedContent } from '@/hooks/useLocalizedGeneratedContent';

const SessionDetailPanel = lazy(() => import('@/components/sessions/SessionDetailPanel')
  .then((module) => ({ default: module.SessionDetailPanel })));

function sourceLabel(source: string | null, chinese: boolean): string {
  if (source === 'codex-cli') return 'Codex';
  if (source === 'claude-code') return 'Claude Code';
  return source || (chinese ? '未知来源' : 'Unknown source');
}

export default function SessionsPage() {
  const [visibleCount, setVisibleCount] = useState(100);
  const { language } = useLanguage();
  const chinese = language === 'zh-CN';
  const locale = language === 'zh-CN' ? 'zh-CN' : 'en-US';
  const dateRanges = [
    { value: 'all', label: chinese ? '全部时间' : 'All time' },
    { value: '7d', label: chinese ? '最近 7 天' : 'Last 7 days' },
    { value: '30d', label: chinese ? '最近 30 天' : 'Last 30 days' },
    { value: '90d', label: chinese ? '最近 90 天' : 'Last 90 days' },
  ];
  const [filters, setFilter] = useFilterParams({
    q: '', project: 'all', source: 'all', character: 'all', status: 'all',
    dateRange: 'all', dateFrom: '', dateTo: '', outcome: 'all', session: '',
  });
  const { data: projects = [] } = useProjects();
  const days = filters.dateRange === 'all' ? null : Number(filters.dateRange.replace('d', ''));
  const from = days ? new Date(Date.now() - days * 86_400_000).toISOString() : undefined;
  const sessionPage = useSessionsPage({
    limit: visibleCount,
    projectId: filters.project === 'all' ? undefined : filters.project,
    sourceTool: filters.source === 'all' ? undefined : filters.source,
    q: filters.q.trim() || undefined,
    from,
    analysisStatus: filters.status === 'analyzed' || filters.status === 'unanalyzed'
      ? filters.status
      : undefined,
  });
  const sessions = sessionPage.data?.sessions ?? [];
  const filtered = sessions;

  useEffect(() => {
    setVisibleCount(100);
  }, [filters.dateRange, filters.project, filters.q, filters.source, filters.status]);

  const visible = useMemo(() => [...filtered].sort((left, right) => {
    const activityDifference = new Date(right.ended_at).getTime() - new Date(left.ended_at).getTime();
    if (activityDifference !== 0) return activityDifference;
    return new Date(right.started_at).getTime() - new Date(left.started_at).getTime();
  }), [filtered]);
  const localizedSessionCopy = useLocalizedGeneratedContent(visible.map((session) => ({
    id: session.id,
    generated_title: session.generated_title,
    summary: session.summary,
  })));
  const localizedCopyById = useMemo(() => new Map(
    (localizedSessionCopy.data ?? []).map((item) => [item.id, item]),
  ), [localizedSessionCopy.data]);
  const grouped = useMemo(() => {
    const groups = new Map<string, typeof visible>();
    for (const session of visible) {
      const key = new Date(session.ended_at).toLocaleDateString(locale, {
        year: 'numeric', month: 'long', day: 'numeric', weekday: 'short',
      });
      groups.set(key, [...(groups.get(key) ?? []), session]);
    }
    return [...groups.entries()];
  }, [locale, visible]);

  const analyzedCount = sessions.filter((session) => (session.insight_count ?? 0) > 0).length;
  const hasMore = sessionPage.data?.hasMore ?? false;
  const countLabel = `${sessions.length}${hasMore ? '+' : ''}`;
  const loading = sessionPage.isLoading;

  return <div className="vibe-page pb-16">
    <header className="border-b border-foreground py-10">
      <p className="vibe-mono flex items-center gap-3 text-[11px] tracking-[.15em] text-muted-foreground"><span className="w-6 border-t-2 border-[#365D8D]" />{chinese ? 'ACTIVITY LEDGER / 活动记录' : 'ACTIVITY LEDGER'}</p>
      <div className="mt-5 flex flex-col justify-between gap-6 lg:flex-row lg:items-end"><div><h1 className="vibe-serif text-4xl leading-tight sm:text-6xl">{chinese ? '工程活动账本' : 'Engineering activity ledger'}</h1><p className="mt-4 max-w-3xl text-sm leading-6 text-muted-foreground">{chinese ? '按时间浏览会话、分析与工具活动。记录详情只在需要时打开，主视图保持为可扫描的工作日志。' : 'Browse sessions, analyses, and tool activity over time. Open details only when needed while the main view stays easy to scan.'}</p></div><div className="grid grid-cols-3 border-y text-center text-xs"><div className="px-5 py-3"><strong className="block vibe-serif text-2xl tabular-nums">{countLabel}</strong>{chinese ? '已载入记录' : 'Loaded records'}</div><div className="border-x px-5 py-3"><strong className="block vibe-serif text-2xl tabular-nums">{analyzedCount}</strong>{chinese ? '当前已分析' : 'Analyzed here'}</div><div className="px-5 py-3"><strong className="block vibe-serif text-2xl tabular-nums">{projects.length}</strong>{chinese ? '项目' : 'Projects'}</div></div></div>
    </header>

    <section className="sticky top-14 z-20 -mx-3 border-b bg-background/95 px-3 py-4 backdrop-blur lg:-mx-6 lg:px-6">
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-12">
        <label className="relative col-span-2 lg:col-span-4"><Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" /><Input aria-label={chinese ? '搜索活动记录' : 'Search activity'} placeholder={chinese ? '搜索标题或项目…' : 'Search title or project…'} value={filters.q} onChange={(event) => setFilter('q', event.target.value)} className="pl-9" /></label>
        <div className="col-span-1 lg:col-span-2"><Select value={filters.project} onValueChange={(value) => setFilter('project', value)}><SelectTrigger aria-label={chinese ? '项目筛选' : 'Project filter'}><SelectValue placeholder={chinese ? '全部项目' : 'All projects'} /></SelectTrigger><SelectContent><SelectItem value="all">{chinese ? '全部项目' : 'All projects'}</SelectItem>{projects.map((project) => <SelectItem key={project.id} value={project.id}>{project.name}</SelectItem>)}</SelectContent></Select></div>
        <div className="col-span-1 lg:col-span-2"><Select value={filters.status} onValueChange={(value) => setFilter('status', value)}><SelectTrigger aria-label={chinese ? '分析状态筛选' : 'Analysis status filter'}><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">{chinese ? '全部状态' : 'All statuses'}</SelectItem><SelectItem value="analyzed">{chinese ? '已分析' : 'Analyzed'}</SelectItem><SelectItem value="unanalyzed">{chinese ? '待分析' : 'Pending'}</SelectItem></SelectContent></Select></div>
        <div className="col-span-1 lg:col-span-2"><Select value={filters.dateRange} onValueChange={(value) => setFilter('dateRange', value)}><SelectTrigger aria-label={chinese ? '时间筛选' : 'Date filter'}><SelectValue /></SelectTrigger><SelectContent>{dateRanges.map((range) => <SelectItem key={range.value} value={range.value}>{range.label}</SelectItem>)}</SelectContent></Select></div>
        <div className="col-span-1 lg:col-span-2"><SourceToolSelect value={filters.source} onValueChange={(value) => setFilter('source', value)} /></div>
      </div>
      <div className="mt-3 flex items-center justify-between text-[10px] text-muted-foreground vibe-mono"><span className="flex items-center gap-2"><Filter className="h-3 w-3" />{chinese ? `当前载入 ${countLabel} 条` : `${countLabel} loaded`}{localizedSessionCopy.isFetching ? (chinese ? ' · 正在翻译' : ' · Translating') : ''}</span><span>{chinese ? '选择一条记录打开证据工作区' : 'Select a record to open its evidence workspace'}</span></div>
    </section>

    <section className="min-h-[680px] border-b border-foreground bg-card">
      <div className="min-w-0">
      {loading && <p className="border-b py-12 text-center text-sm text-muted-foreground">{chinese ? '正在读取活动记录…' : 'Loading activity…'}</p>}
      {!loading && grouped.map(([day, records]) => <div key={day}>
        <div className="flex items-center justify-between border-b bg-muted/20 px-4 py-3"><p className="text-xs font-semibold">{day}</p><p className="text-[10px] text-muted-foreground vibe-mono">{records.length} {chinese ? '条记录' : 'RECORDS'}</p></div>
        <div>{records.map((session) => {
          const started = new Date(session.started_at);
          const ended = new Date(session.ended_at);
          const insightCount = session.insight_count ?? 0;
          const translated = localizedCopyById.get(session.id);
          const displayedSession = translated ? {
            ...session,
            generated_title: translated.generated_title,
            summary: translated.summary,
          } : session;
          return <button key={session.id} type="button" aria-selected={filters.session === session.id} onClick={() => setFilter('session', session.id)} className="group grid w-full grid-cols-[56px_minmax(0,1fr)_76px_18px] gap-3 border-b px-4 py-4 text-left hover:bg-muted/30 aria-selected:bg-[#EAF5F3] dark:aria-selected:bg-[#143A3A]">
            <span className="text-[10px] text-muted-foreground vibe-mono">{ended.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })}</span>
            <span><strong className="block text-sm leading-5">{getSessionTitle(displayedSession)}</strong><span className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-muted-foreground vibe-mono"><span>{sourceLabel(session.source_tool, chinese)}</span><span>{session.user_message_count} USER · {session.assistant_message_count} ASST</span>{session.tool_call_count > 0 && <span>{session.tool_call_count} TOOLS</span>}</span></span>
            <span className="text-right"><span className="block text-[10px] text-muted-foreground vibe-mono">{formatDuration(started, ended)}</span><span className="mt-2 block text-[10px] vibe-mono">{insightCount > 0 ? <span className="inline-flex items-center gap-1 text-[#28666E]"><Sparkles className="h-3 w-3" />{chinese ? '已分析' : 'Analyzed'}</span> : <span className="text-muted-foreground">{chinese ? '待分析' : 'Pending'}</span>}</span></span>
            <ChevronRight className="mt-1 h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-1" />
          </button>;
        })}</div>
      </div>)}
      {!loading && filtered.length === 0 && <div className="border-b py-16 text-center"><p className="vibe-serif text-2xl">{chinese ? '没有符合条件的记录' : 'No matching records'}</p><button type="button" className="mt-3 min-h-10 text-xs text-[#365D8D] underline" onClick={() => { setFilter('q', ''); setFilter('project', 'all'); setFilter('source', 'all'); setFilter('status', 'all'); setFilter('dateRange', 'all'); }}>{chinese ? '清除筛选' : 'Clear filters'}</button></div>}
      {!loading && hasMore && <div className="flex items-center justify-between border-b px-4 py-5 text-xs"><span className="text-muted-foreground">{chinese ? `已显示 ${visible.length} 条` : `Showing ${visible.length}`}</span><button type="button" className="min-h-11 border border-foreground px-4 font-semibold hover:bg-foreground hover:text-background" onClick={() => setVisibleCount((count) => count + 100)}>{chinese ? '继续加载 100 条' : 'Load 100 more'}</button></div>}
      </div>
    </section>

    {filters.session && <>
      <button type="button" aria-label={chinese ? '关闭会话档案' : 'Close session dossier'} className="fixed inset-0 z-[60] cursor-default bg-foreground/20 backdrop-blur-[1px]" onClick={() => setFilter('session', '')} />
      <aside className="fixed inset-y-0 right-0 z-[61] w-full max-w-[760px] overflow-hidden border-l border-foreground bg-background shadow-2xl" aria-label={chinese ? '会话档案' : 'Session dossier'}>
        <button type="button" aria-label={chinese ? '关闭会话档案' : 'Close session dossier'} onClick={() => setFilter('session', '')} className="absolute right-4 top-4 z-[62] grid h-11 w-11 place-items-center border bg-background hover:bg-muted">
          <X className="h-4 w-4" />
        </button>
        <Suspense fallback={<div className="grid h-full place-items-center text-sm text-muted-foreground">{chinese ? '正在打开会话…' : 'Opening session…'}</div>}>
          <SessionDetailPanel sessionId={filters.session} onDelete={() => setFilter('session', '')} />
        </Suspense>
      </aside>
    </>}
  </div>;
}
