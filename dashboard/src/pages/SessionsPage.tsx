import { useEffect, useMemo, useState } from 'react';
import { ChevronRight, Filter, Search, Sparkles, X } from 'lucide-react';
import { useSessions } from '@/hooks/useSessions';
import { useProjects } from '@/hooks/useProjects';
import { useInsights } from '@/hooks/useInsights';
import { useFilterParams } from '@/hooks/useFilterParams';
import { SessionDetailPanel } from '@/components/sessions/SessionDetailPanel';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { SourceToolSelect } from '@/components/filters/SourceToolSelect';
import { getSessionTitle, formatDuration } from '@/lib/utils';
import { useLanguage } from '@/i18n/LanguageProvider';

const DATE_RANGES = [
  { value: 'all', label: '全部时间' },
  { value: '7d', label: '最近 7 天' },
  { value: '30d', label: '最近 30 天' },
  { value: '90d', label: '最近 90 天' },
];

function sourceLabel(source: string | null): string {
  if (source === 'codex-cli') return 'Codex';
  if (source === 'claude-code') return 'Claude Code';
  return source || '未知来源';
}

export default function SessionsPage() {
  const [visibleCount, setVisibleCount] = useState(100);
  const { language } = useLanguage();
  const locale = language === 'zh-CN' ? 'zh-CN' : 'en-US';
  const [filters, setFilter] = useFilterParams({
    q: '', project: 'all', source: 'all', character: 'all', status: 'all',
    dateRange: 'all', dateFrom: '', dateTo: '', outcome: 'all', session: '',
  });
  const { data: projects = [] } = useProjects();
  const { data: insights = [], isLoading: insightsLoading } = useInsights();
  const { data: sessions = [], isLoading: sessionsLoading } = useSessions({ limit: 500 });

  const analysisBySession = useMemo(() => {
    const counts = new Map<string, number>();
    for (const insight of insights) counts.set(insight.session_id, (counts.get(insight.session_id) ?? 0) + 1);
    return counts;
  }, [insights]);

  const filtered = useMemo(() => {
    const now = Date.now();
    const days = filters.dateRange === 'all' ? null : Number(filters.dateRange.replace('d', ''));
    return [...sessions]
      .filter((session) => filters.project === 'all' || session.project_id === filters.project)
      .filter((session) => filters.source === 'all' || session.source_tool === filters.source)
      .filter((session) => filters.status === 'all'
        || (filters.status === 'analyzed' ? analysisBySession.has(session.id) : !analysisBySession.has(session.id)))
      .filter((session) => !days || now - Date.parse(session.started_at) <= days * 86_400_000)
      .filter((session) => {
        const query = filters.q.trim().toLowerCase();
        return !query || getSessionTitle(session).toLowerCase().includes(query)
          || session.project_name.toLowerCase().includes(query);
      })
      .sort((a, b) => Date.parse(b.started_at) - Date.parse(a.started_at));
  }, [analysisBySession, filters.dateRange, filters.project, filters.q, filters.source, filters.status, sessions]);

  useEffect(() => {
    setVisibleCount(100);
  }, [filters.dateRange, filters.project, filters.q, filters.source, filters.status]);

  const visible = useMemo(() => filtered.slice(0, visibleCount), [filtered, visibleCount]);
  const grouped = useMemo(() => {
    const groups = new Map<string, typeof visible>();
    for (const session of visible) {
      const key = new Date(session.started_at).toLocaleDateString(locale, {
        year: 'numeric', month: 'long', day: 'numeric', weekday: 'short',
      });
      groups.set(key, [...(groups.get(key) ?? []), session]);
    }
    return [...groups.entries()];
  }, [locale, visible]);

  const analyzedCount = sessions.filter((session) => analysisBySession.has(session.id)).length;
  const loading = sessionsLoading || insightsLoading;

  return <div className="vibe-page pb-16">
    <header className="border-b border-foreground py-10">
      <p className="vibe-mono flex items-center gap-3 text-[11px] tracking-[.15em] text-muted-foreground"><span className="w-6 border-t-2 border-[#365D8D]" />ACTIVITY LEDGER / 活动记录</p>
      <div className="mt-5 flex flex-col justify-between gap-6 lg:flex-row lg:items-end"><div><h1 className="vibe-serif text-4xl leading-tight sm:text-6xl">工程活动账本</h1><p className="mt-4 max-w-3xl text-sm leading-6 text-muted-foreground">按时间浏览会话、分析与工具活动。记录详情只在需要时打开，主视图保持为可扫描的工作日志。</p></div><div className="grid grid-cols-3 border-y text-center text-xs"><div className="px-5 py-3"><strong className="block vibe-serif text-2xl">{sessions.length}</strong>全部记录</div><div className="border-x px-5 py-3"><strong className="block vibe-serif text-2xl">{analyzedCount}</strong>已分析</div><div className="px-5 py-3"><strong className="block vibe-serif text-2xl">{projects.length}</strong>项目</div></div></div>
    </header>

    <section className="sticky top-14 z-20 -mx-3 border-b bg-background/95 px-3 py-4 backdrop-blur lg:-mx-6 lg:px-6">
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-12">
        <label className="relative col-span-2 lg:col-span-4"><Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" /><Input aria-label="搜索活动记录" placeholder="搜索标题或项目…" value={filters.q} onChange={(event) => setFilter('q', event.target.value)} className="pl-9" /></label>
        <div className="col-span-1 lg:col-span-2"><Select value={filters.project} onValueChange={(value) => setFilter('project', value)}><SelectTrigger aria-label="项目筛选"><SelectValue placeholder="全部项目" /></SelectTrigger><SelectContent><SelectItem value="all">全部项目</SelectItem>{projects.map((project) => <SelectItem key={project.id} value={project.id}>{project.name}</SelectItem>)}</SelectContent></Select></div>
        <div className="col-span-1 lg:col-span-2"><Select value={filters.status} onValueChange={(value) => setFilter('status', value)}><SelectTrigger aria-label="分析状态筛选"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">全部状态</SelectItem><SelectItem value="analyzed">已分析</SelectItem><SelectItem value="unanalyzed">待分析</SelectItem></SelectContent></Select></div>
        <div className="col-span-1 lg:col-span-2"><Select value={filters.dateRange} onValueChange={(value) => setFilter('dateRange', value)}><SelectTrigger aria-label="时间筛选"><SelectValue /></SelectTrigger><SelectContent>{DATE_RANGES.map((range) => <SelectItem key={range.value} value={range.value}>{range.label}</SelectItem>)}</SelectContent></Select></div>
        <div className="col-span-1 lg:col-span-2"><SourceToolSelect value={filters.source} onValueChange={(value) => setFilter('source', value)} /></div>
      </div>
      <div className="mt-3 flex items-center justify-between text-[10px] text-muted-foreground vibe-mono"><span className="flex items-center gap-2"><Filter className="h-3 w-3" />当前结果 {filtered.length} 条</span><span>选择一条记录打开证据工作区</span></div>
    </section>

    <section className="min-h-[680px] border-b border-foreground bg-card">
      <div className="min-w-0">
      {loading && <p className="border-b py-12 text-center text-sm text-muted-foreground">正在读取活动记录…</p>}
      {!loading && grouped.map(([day, records]) => <div key={day}>
        <div className="flex items-center justify-between border-b bg-muted/20 px-4 py-3"><p className="text-xs font-semibold">{day}</p><p className="text-[10px] text-muted-foreground vibe-mono">{records.length} RECORDS</p></div>
        <div>{records.map((session) => {
          const started = new Date(session.started_at);
          const ended = new Date(session.ended_at);
          const insightCount = analysisBySession.get(session.id) ?? 0;
          return <button key={session.id} type="button" aria-selected={filters.session === session.id} onClick={() => setFilter('session', session.id)} className="group grid w-full grid-cols-[56px_minmax(0,1fr)_76px_18px] gap-3 border-b px-4 py-4 text-left hover:bg-muted/30 aria-selected:bg-[#EAF5F3] dark:aria-selected:bg-[#143A3A]">
            <span className="text-[10px] text-muted-foreground vibe-mono">{started.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })}</span>
            <span><strong className="block text-sm leading-5">{getSessionTitle(session)}</strong><span className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-muted-foreground vibe-mono"><span>{sourceLabel(session.source_tool)}</span><span>{session.user_message_count} USER · {session.assistant_message_count} ASST</span>{session.tool_call_count > 0 && <span>{session.tool_call_count} TOOLS</span>}</span></span>
            <span className="text-right"><span className="block text-[10px] text-muted-foreground vibe-mono">{formatDuration(started, ended)}</span><span className="mt-2 block text-[10px] vibe-mono">{insightCount > 0 ? <span className="inline-flex items-center gap-1 text-[#28666E]"><Sparkles className="h-3 w-3" />已分析</span> : <span className="text-muted-foreground">待分析</span>}</span></span>
            <ChevronRight className="mt-1 h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-1" />
          </button>;
        })}</div>
      </div>)}
      {!loading && filtered.length === 0 && <div className="border-b py-16 text-center"><p className="vibe-serif text-2xl">没有符合条件的记录</p><button type="button" className="mt-3 text-xs text-[#365D8D] underline" onClick={() => { setFilter('q', ''); setFilter('project', 'all'); setFilter('source', 'all'); setFilter('status', 'all'); setFilter('dateRange', 'all'); }}>清除筛选</button></div>}
      {!loading && visibleCount < filtered.length && <div className="flex items-center justify-between border-b px-4 py-5 text-xs"><span className="text-muted-foreground">已显示 {visible.length} / {filtered.length} 条</span><button type="button" className="min-h-11 border border-foreground px-4 font-semibold hover:bg-foreground hover:text-background" onClick={() => setVisibleCount((count) => count + 100)}>继续加载 100 条</button></div>}
      </div>
    </section>

    {filters.session && <>
      <button type="button" aria-label="关闭会话档案" className="fixed inset-0 z-[60] cursor-default bg-foreground/20 backdrop-blur-[1px]" onClick={() => setFilter('session', '')} />
      <aside className="fixed inset-y-0 right-0 z-[61] w-full max-w-[760px] overflow-hidden border-l border-foreground bg-background shadow-2xl" aria-label="会话档案">
        <button type="button" aria-label="关闭会话档案" onClick={() => setFilter('session', '')} className="absolute right-4 top-4 z-[62] grid h-11 w-11 place-items-center border bg-background hover:bg-muted">
          <X className="h-4 w-4" />
        </button>
        <SessionDetailPanel sessionId={filters.session} onDelete={() => setFilter('session', '')} />
      </aside>
    </>}
  </div>;
}
