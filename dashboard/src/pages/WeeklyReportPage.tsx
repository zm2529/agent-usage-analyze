import { Activity, Bot, Clock3, FolderKanban, MessageSquareText, Wrench } from 'lucide-react';
import { useWeeklyReport } from '@/hooks/useAnalytics';
import { useLanguage } from '@/i18n/LanguageProvider';
import type { WeeklyReportAgent } from '@/lib/types';

const AGENT_LABELS: Record<string, string> = {
  'codex-cli': 'Codex',
  'claude-code': 'Claude Code',
  cursor: 'Cursor',
  unknown: 'Unknown',
};

function compact(value: number, locale: string): string {
  return new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 }).format(value);
}

function formatDuration(minutes: number, cn: boolean): string {
  if (minutes < 60) return `${minutes} ${cn ? '分钟' : 'min'}`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours}h ${rest}m` : `${hours}h`;
}

function formatRange(startsAt: string, endsAt: string, locale: string): string {
  const format = new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric' });
  return `${format.format(new Date(startsAt))} – ${format.format(new Date(endsAt))}`;
}

function deltaLabel(value: number | null, cn: boolean): string {
  if (value === null) return cn ? '本周新增' : 'New this week';
  if (value === 0) return cn ? '与上周同期持平' : 'Flat vs last week';
  return `${value > 0 ? '+' : ''}${value}% ${cn ? '较上周同期' : 'vs last week'}`;
}

function Metric({ icon: Icon, label, value, detail }: {
  icon: typeof Activity; label: string; value: string; detail: string;
}) {
  return <div className="overview-metric">
    <div className="flex items-center gap-2 text-[11px] text-muted-foreground"><Icon className="h-3.5 w-3.5" />{label}</div>
    <p className="mt-2 text-2xl font-semibold tabular-nums">{value}</p>
    <p className="mt-1 text-[10px] text-muted-foreground">{detail}</p>
  </div>;
}

function AgentRow({ agent, cn, locale }: { agent: WeeklyReportAgent; cn: boolean; locale: string }) {
  const label = AGENT_LABELS[agent.sourceTool] ?? agent.sourceTool;
  return <article className="grid gap-5 border-b p-5 last:border-b-0 lg:grid-cols-[1.25fr_repeat(4,minmax(0,1fr))] lg:items-center">
    <div>
      <div className="flex items-center gap-3"><span className="grid h-9 w-9 place-items-center border border-foreground"><Bot className="h-4 w-4" /></span><div><h3 className="font-semibold">{label}</h3><p className="mt-1 text-[10px] text-muted-foreground">{agent.sharePercent}% {cn ? '本周会话占比' : 'of weekly sessions'}</p></div></div>
      <div className="mt-3 h-1.5 bg-muted"><div className="h-full bg-[#28666E]" style={{ width: `${Math.max(agent.sharePercent, 2)}%` }} /></div>
    </div>
    <div><span className="text-[10px] text-muted-foreground">{cn ? '会话' : 'Sessions'}</span><strong className="mt-1 block text-xl tabular-nums">{agent.sessions}</strong><small className={agent.sessionDeltaPercent !== null && agent.sessionDeltaPercent < 0 ? 'text-[#BF7A45]' : 'text-[#28666E]'}>{deltaLabel(agent.sessionDeltaPercent, cn)}</small></div>
    <div><span className="text-[10px] text-muted-foreground">Token</span><strong className="mt-1 block text-xl tabular-nums">{compact(agent.totalTokens, locale)}</strong><small className="text-muted-foreground">{deltaLabel(agent.tokenDeltaPercent, cn)}</small></div>
    <div><span className="text-[10px] text-muted-foreground">{cn ? '项目 / 工具调用' : 'Projects / tools'}</span><strong className="mt-1 block text-xl tabular-nums">{agent.projects} / {agent.toolCalls}</strong><small className="text-muted-foreground">{formatDuration(agent.durationMinutes, cn)}</small></div>
    <div><span className="text-[10px] text-muted-foreground">{cn ? '分析覆盖' : 'Analysis coverage'}</span><strong className="mt-1 block text-xl tabular-nums">{agent.analysisCoverage}%</strong><small className="text-muted-foreground">{agent.analyzedSessions} / {agent.sessions} {cn ? '个会话' : 'sessions'}</small></div>
  </article>;
}

export default function WeeklyReportPage() {
  const { language } = useLanguage();
  const cn = language === 'zh-CN';
  const locale = cn ? 'zh-CN' : 'en-US';
  const report = useWeeklyReport();
  if (report.isLoading) return <div className="vibe-page"><div className="h-12 w-72 animate-pulse bg-muted" /><div className="mt-8 h-40 animate-pulse border-y bg-muted/30" /></div>;
  if (report.isError || !report.data) return <div className="vibe-page"><h1 className="vibe-serif text-4xl">{cn ? '周报' : 'Weekly report'}</h1><p className="mt-8 border-y border-destructive py-5 text-sm text-destructive">{cn ? '周报暂时不可用，请稍后刷新。' : 'The weekly report is temporarily unavailable. Refresh shortly.'}</p></div>;
  const data = report.data;
  return <div className="vibe-page">
    <section className="flex flex-col gap-5 border-b border-foreground pb-7 sm:flex-row sm:items-end sm:justify-between">
      <div><p className="vibe-mono text-[10px] tracking-[.18em] text-[#28666E]">WEEKLY AGENT BRIEF</p><h1 className="vibe-serif mt-3 text-4xl sm:text-5xl">{cn ? '本周 Agent 周报' : 'Weekly agent report'}</h1><p className="mt-3 max-w-3xl text-sm leading-6 text-muted-foreground">{cn ? '按自然周汇总各 Agent 的使用规模、投入与分析覆盖，并与上周同期比较。' : 'A natural-week summary of agent activity, effort, and analysis coverage compared with the same period last week.'}</p></div>
      <div className="shrink-0 text-right"><span className="block text-[10px] text-muted-foreground">{cn ? '统计周期' : 'Reporting period'}</span><strong className="vibe-mono mt-1 block text-sm">{formatRange(data.week.startsAt, data.week.endsAt, locale)}</strong><small className="mt-1 block text-muted-foreground">{cn ? '每分钟自动更新' : 'Updates every minute'}</small></div>
    </section>

    <section className="overview-metrics mt-7" aria-label={cn ? '本周汇总' : 'Weekly totals'}>
      <Metric icon={Activity} label={cn ? '会话' : 'Sessions'} value={String(data.totals.sessions)} detail={deltaLabel(data.totals.sessionDeltaPercent, cn)} />
      <Metric icon={Bot} label={cn ? '活跃 Agent' : 'Active agents'} value={String(data.agents.length)} detail={cn ? `${data.totals.analysisCoverage}% 已分析` : `${data.totals.analysisCoverage}% analyzed`} />
      <Metric icon={FolderKanban} label={cn ? '活跃项目' : 'Active projects'} value={String(data.totals.projects)} detail={cn ? '去重项目数' : 'Distinct projects'} />
      <Metric icon={MessageSquareText} label={cn ? '消息' : 'Messages'} value={compact(data.totals.messages, locale)} detail={`${data.totals.sessions ? Math.round(data.totals.messages / data.totals.sessions) : 0} / ${cn ? '会话' : 'session'}`} />
      <Metric icon={Wrench} label={cn ? '工具调用' : 'Tool calls'} value={compact(data.totals.toolCalls, locale)} detail={`${data.totals.sessions ? Math.round(data.totals.toolCalls / data.totals.sessions) : 0} / ${cn ? '会话' : 'session'}`} />
      <Metric icon={Clock3} label={cn ? '投入时长' : 'Duration'} value={formatDuration(data.totals.durationMinutes, cn)} detail={cn ? '按会话起止时间估算' : 'Estimated from session times'} />
      <Metric icon={Activity} label="Token" value={compact(data.totals.totalTokens, locale)} detail={deltaLabel(data.totals.tokenDeltaPercent, cn)} />
      <Metric icon={Bot} label={cn ? '分析覆盖' : 'Coverage'} value={`${data.totals.analysisCoverage}%`} detail={`${data.totals.analyzedSessions} / ${data.totals.sessions} ${cn ? '个会话' : 'sessions'}`} />
    </section>

    <section className="mt-7 border-y border-foreground bg-card">
      <div className="border-b p-5"><h2 className="vibe-serif text-2xl">{cn ? '本周简析' : 'Brief analysis'}</h2><p className="mt-1 text-xs text-muted-foreground">{cn ? '由本地统计规则生成，不调用额外 LLM。' : 'Generated from local metrics without an additional LLM call.'}</p></div>
      <div className="grid lg:grid-cols-3">{data.highlights.map((item, index) => <article key={`${item.kind}-${index}`} className="min-h-32 border-b p-5 last:border-b-0 lg:border-b-0 lg:border-r lg:last:border-r-0"><span className="vibe-mono text-[10px] tracking-[.14em] text-[#28666E]">0{index + 1}</span><h3 className="mt-3 font-semibold">{cn ? item.title : item.titleEn}</h3><p className="mt-2 text-xs leading-5 text-muted-foreground">{cn ? item.detail : item.detailEn}</p></article>)}</div>
    </section>

    <section className="mt-7 border-y border-foreground bg-card">
      <div className="border-b p-5"><h2 className="vibe-serif text-2xl">{cn ? '各 Agent 使用情况' : 'Usage by agent'}</h2><p className="mt-1 text-xs text-muted-foreground">{cn ? '按会话数量排序；Token 包含未缓存输入、缓存读写与输出。' : 'Sorted by session count; tokens include uncached input, cache reads and writes, and output.'}</p></div>
      {data.agents.length ? data.agents.map((agent) => <AgentRow key={agent.sourceTool} agent={agent} cn={cn} locale={locale} />) : <p className="p-8 text-sm text-muted-foreground">{cn ? '本周还没有会话记录。' : 'No sessions recorded this week.'}</p>}
    </section>
  </div>;
}
