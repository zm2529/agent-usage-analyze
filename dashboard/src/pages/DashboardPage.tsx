import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import {
  Activity, Bot, Clock3, Cpu, Database, FileText, MessageSquareText,
  Sparkles, Wrench,
} from 'lucide-react';
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart,
  Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { useOverviewAnalytics } from '@/hooks/useAnalytics';
import { useBehaviorReportSummary } from '@/hooks/useBehaviorReport';
import { useIngestionHealth } from '@/hooks/useIngestionHealth';
import { useQueryClient } from '@tanstack/react-query';
import { fetchBehaviorReport } from '@/lib/api';
import { useImprovements } from '@/hooks/useImprovements';
import { useSessions } from '@/hooks/useSessions';
import { useLanguage } from '@/i18n/LanguageProvider';
import { useLocalizedGeneratedContent } from '@/hooks/useLocalizedGeneratedContent';
import { HistorySyncButton } from '@/components/dashboard/HistorySyncButton';
import { IngestionProgressCard } from '@/components/dashboard/IngestionProgressCard';
import type { OverviewRange } from '@/lib/types';
import { formatModelName } from '@/lib/utils';

const COLORS = ['#28666E', '#3B6EA8', '#BF7A45', '#6B7280'];
const SKILL_COLORS = ['#C8DCF4', '#75B5F4', '#3D8BE8', '#235CA8', '#C7A8F3', '#8757DF', '#E56AA6', '#A178E8'];
const EFFORT_COLORS: Record<string, string> = {
  none: '#9CA3AF', minimal: '#8AAFC1', low: '#5E93B4', medium: '#3B6EA8',
  high: '#6D58B5', xhigh: '#8757DF', max: '#A178E8', ultra: '#BF7A45',
};
const EFFORT_LABELS: Record<string, string> = {
  none: '无', minimal: '极低', low: '低', medium: '中', high: '高',
  xhigh: '很高', max: '最高', ultra: '极高',
};

function compact(value: number, locale = 'zh-CN'): string {
  return new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 }).format(value);
}

const TOOL_FAMILY_LABELS: Record<string, { zh: string; en: string }> = {
  shell: { zh: '终端与命令', en: 'Shell and commands' },
  '终端与命令': { zh: '终端与命令', en: 'Shell and commands' },
  other: { zh: '其他', en: 'Other' },
  '其他': { zh: '其他', en: 'Other' },
  'agent-orchestration': { zh: 'Agent 编排', en: 'Agent orchestration' },
  'Agent 编排': { zh: 'Agent 编排', en: 'Agent orchestration' },
  editing: { zh: '代码编辑', en: 'Code editing' },
  '代码编辑': { zh: '代码编辑', en: 'Code editing' },
  'planning-goals': { zh: '计划与目标', en: 'Plans and goals' },
  '计划与目标': { zh: '计划与目标', en: 'Plans and goals' },
  'browser-ui': { zh: '界面与浏览器', en: 'UI and browser' },
  '界面与浏览器': { zh: '界面与浏览器', en: 'UI and browser' },
  'search-read': { zh: '搜索与读取', en: 'Search and reading' },
  '搜索与读取': { zh: '搜索与读取', en: 'Search and reading' },
};

function toolFamilyLabel(value: string, cn: boolean): string {
  const labels = TOOL_FAMILY_LABELS[value];
  return labels ? (cn ? labels.zh : labels.en) : value;
}

function duration(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function parseStoredDate(value: string): Date {
  return new Date(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value) ? `${value.replace(' ', 'T')}Z` : value);
}

function Metric({ label, value, detail, icon: Icon }: {
  label: string; value: string; detail: string; icon: typeof Activity;
}) {
  return <div className="overview-metric">
    <div className="flex items-center gap-2 text-[11px] text-muted-foreground"><Icon className="h-3.5 w-3.5" />{label}</div>
    <p className="mt-2 text-2xl font-semibold tracking-tight tabular-nums">{value}</p>
    <p className="mt-1 truncate text-[10px] text-muted-foreground">{detail}</p>
  </div>;
}

function SectionTitle({ title, description, aside }: { title: string; description: string; aside?: React.ReactNode }) {
  return <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
    <div><h2 className="text-lg font-semibold tracking-tight">{title}</h2><p className="mt-1 text-xs text-muted-foreground">{description}</p></div>
    {aside}
  </div>;
}

function DashboardSkeleton({ className = '' }: { className?: string }) {
  return <span className={`dashboard-skeleton ${className}`} aria-hidden="true" />;
}

export function PriorityDecision({ headline, plans, healthState, reportState, headlineLoading = false, plansLoading = false, healthLoading = false, cn = true }: {
  headline: string | null;
  plans: Array<{ id: string; title: string; status: string; matchedTaskCount: number; maxTaskCount: number; basisChanged: boolean }>;
  healthState: string | undefined;
  reportState: string | undefined;
  headlineLoading?: boolean;
  plansLoading?: boolean;
  healthLoading?: boolean;
  cn?: boolean;
}) {
  const showHeadlineLoading = headlineLoading && !headline;
  const showPlansLoading = plansLoading && plans.length === 0;

  return <>
    <header className="flex flex-col justify-between gap-6 border-b border-foreground py-10 lg:flex-row lg:items-end">
      <div><p className="vibe-mono text-[10px] tracking-[.18em] text-[#28666E]">DAILY DECISION BRIEF</p><h1 className="vibe-serif mt-3 text-4xl sm:text-5xl">{cn ? '总览' : 'Overview'}</h1><p className="mt-3 max-w-3xl text-sm leading-6 text-muted-foreground">{cn ? '先看最近最大的变化、成因与正在观察的改进，再看使用统计。' : 'Start with the largest recent change and active improvements, then review usage statistics.'}</p></div>
      <div className="flex gap-2"><Link to="/analysis" className="flex h-11 items-center border px-4 text-xs font-semibold">{cn ? '进入分析证据' : 'Open analysis'}</Link><Link to="/improvements" className="flex h-11 items-center border border-foreground bg-foreground px-4 text-xs font-semibold text-background">{cn ? '查看改进追踪' : 'View improvements'}</Link></div>
    </header>
    <section className="grid border-b border-foreground bg-card lg:grid-cols-[minmax(0,1.45fr)_minmax(330px,.72fr)]">
      <div className="flex min-h-[390px] flex-col border-b p-6 lg:border-b-0 lg:border-r">
        <p className="vibe-mono text-[10px] text-muted-foreground">{cn ? '最近最大的变化' : 'LARGEST RECENT CHANGE'}</p>
        {showHeadlineLoading ? <>
          <div className="mt-8 grid max-w-3xl gap-3" role="status" aria-label={cn ? '正在整理最近记录' : 'Preparing recent records'}>
            <DashboardSkeleton className="h-10 w-[88%] sm:h-12" />
            <DashboardSkeleton className="h-10 w-[64%] sm:h-12" />
          </div>
          <div className="mt-6 grid max-w-2xl gap-2.5">
            <DashboardSkeleton className="h-2.5 w-full" />
            <DashboardSkeleton className="h-2.5 w-3/4" />
          </div>
          <p className="mt-5 text-xs text-muted-foreground">{cn ? '正在整理最近记录' : 'Preparing recent records'}</p>
        </> : <>
          <h2 className={`vibe-serif mt-8 max-w-3xl text-3xl leading-tight ${cn ? 'sm:text-5xl' : 'sm:text-4xl'}`}>{headline ?? (cn ? '最近还没有可展示的分析' : 'No analysis to show yet')}</h2>
          <p className="mt-5 max-w-3xl text-sm leading-7 text-muted-foreground">{headline ? (cn ? '这是最近 30 天最值得关注的使用变化。' : 'This is the most notable usage change from the last 30 days.') : (cn ? '完成一次分析后，最值得关注的变化会显示在这里。' : 'The most notable change appears here after analysis completes.')}</p>
        </>}
        <div className="mt-auto flex justify-end border-t pt-4 text-xs">
          {showHeadlineLoading ? <DashboardSkeleton className="h-3 w-20" /> : <Link to="/analysis" className="font-semibold underline underline-offset-4">{cn ? '查看完整分析' : 'View full analysis'}</Link>}
        </div>
      </div>
      <div>
        <div className="border-b p-5"><h2 className="vibe-serif text-2xl">{cn ? '数据 / 分析健康' : 'Data / analysis health'}</h2><div className="mt-4 grid grid-cols-2 border-l border-t text-xs"><div className="border-b border-r p-3"><span className="text-[10px] text-muted-foreground">{cn ? '数据导入' : 'Data import'}</span>{healthLoading ? <DashboardSkeleton className="mt-2 h-3 w-16" /> : <strong className="mt-2 block">{healthState === 'completed' ? (cn ? '最近完成' : 'Completed') : healthState === 'running' ? (cn ? '进行中' : 'Running') : (cn ? '需要检查' : 'Needs attention')}</strong>}</div><div className="border-b border-r p-3"><span className="text-[10px] text-muted-foreground">{cn ? '跨任务报告' : 'Cross-task report'}</span>{headlineLoading ? <DashboardSkeleton className="mt-2 h-3 w-16" /> : <strong className="mt-2 block">{reportState ?? (cn ? '等待首次运行' : 'Waiting for first run')}</strong>}</div><div className="border-b border-r p-3"><span className="text-[10px] text-muted-foreground">{cn ? '当前计划' : 'Active plans'}</span>{plansLoading ? <DashboardSkeleton className="mt-2 h-3 w-10" /> : <strong className="vibe-mono mt-2 block">{plans.length} / 3</strong>}</div><div className="border-b border-r p-3"><span className="text-[10px] text-muted-foreground">{cn ? '依据变化' : 'Changed evidence'}</span>{plansLoading ? <DashboardSkeleton className="mt-2 h-3 w-8" /> : <strong className="vibe-mono mt-2 block">{plans.filter((plan) => plan.basisChanged).length}</strong>}</div></div></div>
        <div className="p-5"><h2 className="vibe-serif text-2xl">{cn ? '接下来可以做什么' : 'What to do next'}</h2>{showHeadlineLoading ? <div className="mt-3 space-y-0" aria-hidden>{Array.from({ length: 3 }, (_, index) => <div key={index} className="flex items-center gap-3 border-b py-4 last:border-b-0"><span className="vibe-mono text-[10px] text-muted-foreground">0{index + 1}</span><DashboardSkeleton className={`h-2.5 ${index === 1 ? 'w-3/4' : 'w-5/6'}`} /></div>)}</div> : <ol className="mt-3"><li className="border-b py-3 text-xs"><b className="vibe-mono mr-3">01</b>{cn ? '查看完整分析，了解这项变化出现在哪些任务中。' : 'Open the full analysis to see where the change appears.'}</li><li className="border-b py-3 text-xs"><b className="vibe-mono mr-3">02</b>{cn ? '跟踪正在进行的改进，观察后续任务是否发生变化。' : 'Track active improvements and observe later work.'}</li><li className="py-3 text-xs"><b className="vibe-mono mr-3">03</b>{cn ? '需要更多做法时，到实践库查看相关资料。' : 'Use the Practice Library when you need more approaches.'}</li></ol>}</div>
      </div>
    </section>
    <section className="mt-6 border-y border-foreground bg-card"><div className="flex items-end justify-between gap-4 border-b p-4"><div><h2 className="vibe-serif text-2xl">{cn ? '当前改进计划' : 'Current improvement plans'}</h2><p className="mt-1 text-xs text-muted-foreground">{showPlansLoading ? (cn ? '正在整理最近记录' : 'Preparing recent records') : (cn ? '查看正在观察的改进及当前进度。' : 'Review active improvements and their progress.')}</p></div><Link to="/improvements" className="text-xs font-semibold underline underline-offset-4">{cn ? '管理全部计划' : 'Manage all plans'}</Link></div><div className="grid lg:grid-cols-3">{showPlansLoading ? Array.from({ length: 3 }, (_, index) => <article key={index} className="flex min-h-36 flex-col border-b p-5 last:border-b-0 lg:border-b-0 lg:border-r lg:last:border-r-0" aria-hidden><DashboardSkeleton className="h-2.5 w-16" /><DashboardSkeleton className="mt-4 h-6 w-4/5" /><DashboardSkeleton className="mt-auto h-1.5 w-full" /><DashboardSkeleton className="mt-3 h-2.5 w-2/3" /></article>) : plans.length === 0 ? <div className="p-5 text-xs text-muted-foreground"><p>{reportState === (cn ? '已完成' : 'Completed') ? (cn ? '当前没有适合追踪的计划，可以从实践库选择一项开始。' : 'There is no trackable plan yet; choose a practice from the library to begin.') : (cn ? '完成分析后会在这里显示适合追踪的改进。' : 'Trackable improvements appear here after analysis.')}</p><div className="mt-3 flex gap-4"><Link to="/analysis" className="font-semibold text-foreground underline underline-offset-4">{reportState === (cn ? '需要重新分析' : 'Run analysis again') ? (cn ? '重新分析' : 'Run analysis again') : (cn ? '前往分析' : 'Open analysis')}</Link><Link to="/practices" className="font-semibold text-foreground underline underline-offset-4">{cn ? '打开实践库' : 'Open Practice Library'}</Link></div></div> : plans.slice(0, 3).map((plan) => <article key={plan.id} className="border-b p-5 last:border-b-0 lg:border-b-0 lg:border-r lg:last:border-r-0"><p className="vibe-mono text-[10px] text-muted-foreground">{plan.status === 'queued' ? (cn ? '排队' : 'Queued') : (cn ? '自动观察' : 'Observing')}{plan.basisChanged ? (cn ? ' · 建议提前复盘' : ' · Early review suggested') : ''}</p><h3 className="vibe-serif mt-2 text-xl">{plan.title}</h3><div className="mt-5 h-1.5 bg-muted"><i className="block h-full bg-[#28666E]" style={{ width: `${Math.min(100, plan.matchedTaskCount / Math.max(1, plan.maxTaskCount) * 100)}%` }} /></div><div className="mt-2 flex justify-between text-[10px] text-muted-foreground"><span>{cn ? '已观察' : 'Observed'} {plan.matchedTaskCount} / {plan.maxTaskCount} {cn ? '项任务' : 'tasks'}</span><span>{plan.basisChanged ? (cn ? '建议提前复盘' : 'Review early') : (cn ? '持续观察' : 'Keep observing')}</span></div></article>)}</div></section>
  </>;
}

const tooltipStyle = {
  background: 'hsl(var(--card))',
  border: '1px solid hsl(var(--border))',
  borderRadius: 2,
  color: 'hsl(var(--foreground))',
  fontSize: 11,
  boxShadow: '0 10px 30px rgb(0 0 0 / .18)',
};
const chartCursor = { fill: 'rgba(40, 102, 110, 0.08)' };

type SkillTooltipEntry = {
  color?: string; dataKey?: string | number; name?: string | number; value?: string | number | ReadonlyArray<string | number>;
};

export function skillTooltipEntries(payload: ReadonlyArray<SkillTooltipEntry> = []): SkillTooltipEntry[] {
  return [...payload].reverse();
}

function SkillTrendTooltip({ active, label, payload, cn = true }: {
  active?: boolean;
  label?: string | number;
  payload?: ReadonlyArray<SkillTooltipEntry>;
  cn?: boolean;
}) {
  if (!active || !payload?.length) return null;
  return <div className="min-w-52 border border-border bg-card p-3 text-xs shadow-xl">
    <p className="mb-2 font-semibold">{cn ? '时间：' : 'Time: '}{label}</p>
    <div className="space-y-1.5">
      {skillTooltipEntries(payload).map((entry) => <div key={String(entry.dataKey)} className="flex items-center justify-between gap-6">
        <span className="flex min-w-0 items-center gap-2"><i className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: entry.color }} /><span className="truncate">{entry.name}</span></span>
        <strong className="tabular-nums">{Number(entry.value ?? 0)}</strong>
      </div>)}
    </div>
  </div>;
}

export default function DashboardPage() {
  const { language } = useLanguage();
  const cn = language === 'zh-CN';
  const locale = cn ? 'zh-CN' : 'en-US';
  const queryClient = useQueryClient();
  const [range, setRange] = useState<OverviewRange>('7d');
  const overview = useOverviewAnalytics(range);
  const behavior = useBehaviorReportSummary();
  const improvements = useImprovements();
  const { data: health, isLoading: healthLoading } = useIngestionHealth();
  useEffect(() => {
    if (health?.status !== 'completed' && health?.status !== 'completed-with-errors') return;
    const id = window.setTimeout(() => {
      void queryClient.prefetchQuery({
        queryKey: ['behaviorReport'],
        queryFn: fetchBehaviorReport,
        staleTime: 30_000,
      });
    }, 300);
    return () => window.clearTimeout(id);
  }, [health?.completedAt, health?.status, queryClient]);
  const { data: sessions = [] } = useSessions({ limit: 8 });
  const data = overview.data;
  const localizedReport = useLocalizedGeneratedContent(behavior.data?.report);
  const localizedPlans = useLocalizedGeneratedContent(improvements.data?.plans);
  const report = localizedReport.data ?? behavior.data?.report;
  const generatedAt = behavior.data?.report?.generatedAt ?? null;
  const tokenComposition = useMemo(() => data ? [
    { name: cn ? '未缓存输入' : 'Uncached input', value: data.totals.uncachedInputTokens },
    { name: cn ? '缓存写入' : 'Cache writes', value: data.totals.cacheCreationTokens },
    { name: cn ? '缓存读取' : 'Cache reads', value: data.totals.cacheReadTokens },
    { name: cn ? '输出' : 'Output', value: data.totals.outputTokens },
  ] : [], [cn, data]);
  const skillTrend = useMemo(() => (data?.skillTimeline ?? []).map((point) => ({
    key: point.key,
    label: point.label,
    total: point.total,
    ...Object.fromEntries((data?.skillSeries ?? []).map((series, index) => [
      `skill_${index}`,
      point.counts[series.name] ?? 0,
    ])),
  })), [data]);
  const durationBands = useMemo(() => (data?.durationBands ?? []).map((band, index) => ({
    ...band,
    label: cn ? band.label : ['< 5 min', '5–20 min', '20–60 min', '> 60 min'][index] ?? band.label,
  })), [cn, data?.durationBands]);
  const compactNumber = (value: number) => compact(value, locale);
  const localizedToolFamilies = useMemo(() => (data?.toolFamilies ?? []).map((item) => ({
    ...item,
    family: toolFamilyLabel(item.family, cn),
  })), [cn, data?.toolFamilies]);
  const priority = <PriorityDecision
    headline={report?.headline ?? null}
    plans={(localizedPlans.data ?? improvements.data?.plans ?? []).filter((plan) => ['observing', 'queued', 'review-ready'].includes(plan.status))}
    healthState={health?.status}
    reportState={behavior.data?.generation.running ? (cn ? '分析中' : 'Analyzing') : behavior.data?.report ? (cn ? '已完成' : 'Completed') : behavior.data?.latestAttempt?.status === 'completed' ? (cn ? '需要重新分析' : 'Run analysis again') : behavior.data?.latestAttempt?.status}
    headlineLoading={behavior.isLoading}
    plansLoading={improvements.isLoading}
    healthLoading={healthLoading}
    cn={cn}
  />;

  if (overview.isLoading) {
    return <div className="vibe-page pb-16">{priority}<section className="mt-7" aria-busy="true"><h2 className="vibe-serif text-2xl">{cn ? '使用统计' : 'Usage statistics'}</h2><p className="mt-1 text-xs text-muted-foreground">{cn ? '已有记录先显示，其余内容正在整理。' : 'Available records are shown while the remaining statistics load.'}</p><div className="overview-metrics mt-4" aria-hidden>{Array.from({ length: 8 }, (_, index) => <div key={index} className="overview-metric flex flex-col"><DashboardSkeleton className="h-2.5 w-16" /><DashboardSkeleton className="mt-4 h-7 w-14" /><DashboardSkeleton className="mt-3 h-2.5 w-3/4" /></div>)}</div></section></div>;
  }
  if (overview.isError || !data) {
    return <div className="vibe-page pb-16">{priority}<p className="mt-7 border-y border-destructive py-5 text-sm text-destructive">{cn ? '详细统计暂时不可用，请稍后刷新。' : 'Detailed statistics are temporarily unavailable. Refresh shortly.'}</p></div>;
  }

  return <div className="vibe-page pb-16">
    {priority}
    <header className="mt-8 border-b border-foreground/80 pb-6 pt-8">
      <div className="flex flex-wrap items-start justify-between gap-5">
        <div>
          <p className="vibe-mono text-[10px] tracking-[.18em] text-[#28666E]">LOCAL FACTS / SECOND SCREEN</p>
          <h2 className="vibe-serif mt-3 text-3xl">{cn ? '使用统计' : 'Usage statistics'}</h2>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">{cn ? '查看使用规模、Agent 编排、Skill 与工具、Token 结构和提示词质量。' : 'Review usage volume, Agent orchestration, Skills and tools, Token structure, and prompt quality.'}</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex border border-border bg-card p-1" aria-label={cn ? '统计时间范围' : 'Statistics time range'}>
            {([['today', cn ? '当天' : 'Today'], ['7d', cn ? '7 天' : '7 days'], ['30d', cn ? '30 天' : '30 days']] as const).map(([value, label]) => <button
              key={value} type="button" onClick={() => setRange(value)}
              className={`px-3 py-1.5 text-xs ${range === value ? 'bg-foreground text-background' : 'text-muted-foreground hover:text-foreground'}`}
            >{label}</button>)}
          </div>
          <HistorySyncButton />
        </div>
      </div>
    </header>

    {health?.status === 'running' && (
      <section className="border-b py-4">
        <IngestionProgressCard health={health} />
      </section>
    )}

    <div className="flex min-h-10 flex-wrap items-center justify-between gap-2 border-b py-2 text-[10px] text-muted-foreground">
      <span className="flex items-center gap-2"><span className={`h-2 w-2 rounded-full ${health?.status === 'completed' ? 'bg-[#28666E]' : 'bg-[#BF7A45]'}`} />{cn ? '统计来自已导入的会话记录' : 'Statistics use imported session records'}</span>
      <span>{data ? `${cn ? '统计生成' : 'Generated'} ${new Date(data.generatedAt).toLocaleTimeString(locale)}` : (cn ? '正在读取统计' : 'Loading statistics')}</span>
    </div>

    <section className="overview-metrics">
      <Metric label={cn ? '会话' : 'Sessions'} value={compactNumber(data?.totals.sessions ?? 0)} detail={`${data?.totals.projects ?? 0} ${cn ? '个项目' : 'projects'}`} icon={MessageSquareText} />
      <Metric label={cn ? '主任务' : 'Root tasks'} value={compactNumber(data?.totals.rootTasks ?? 0)} detail={cn ? '根任务' : 'Top-level tasks'} icon={FileText} />
      <Metric label={cn ? '子 Agent' : 'Sub-agents'} value={compactNumber(data?.totals.subagents ?? 0)} detail={cn ? '委派任务' : 'Delegated tasks'} icon={Bot} />
      <Metric label={cn ? '持续时间' : 'Duration'} value={duration(data?.totals.durationMinutes ?? 0)} detail={cn ? '会话累计' : 'Across sessions'} icon={Clock3} />
      <Metric label={cn ? '工具调用' : 'Tool calls'} value={compactNumber(data?.totals.toolCalls ?? 0)} detail={cn ? '全部工具事件' : 'All tool events'} icon={Wrench} />
      <Metric label="Skill" value={compactNumber(data?.totals.skillInvocations ?? 0)} detail={cn ? '用户指定与 Agent 自动启用' : 'User- and Agent-invoked'} icon={Sparkles} />
      <Metric
        label={cn ? '处理 Token' : 'Processed tokens'}
        value={compactNumber(data?.totals.totalProcessedTokens ?? 0)}
        detail={`${cn ? '未缓存输入' : 'Input'} ${compactNumber(data?.totals.uncachedInputTokens ?? 0)} · ${cn ? '缓存写入' : 'Cache write'} ${compactNumber(data?.totals.cacheCreationTokens ?? 0)} · ${cn ? '缓存读取' : 'Cache read'} ${compactNumber(data?.totals.cacheReadTokens ?? 0)} · ${cn ? '输出' : 'Output'} ${compactNumber(data?.totals.outputTokens ?? 0)}`}
        icon={Cpu}
      />
      <Metric
        label={cn ? '提示词质量' : 'Prompt quality'}
        value={data?.totals.promptScore == null ? '—' : String(data.totals.promptScore)}
        detail={`${cn ? '已分析' : 'Analyzed'} ${data.totals.promptScoreAnalyzedSessions}/${data.totals.promptScoreEligibleSessions} ${cn ? '个会话' : 'sessions'}`}
        icon={Activity}
      />
    </section>

    <section className="border-b py-7">
      <SectionTitle title={cn ? '活动节奏' : 'Activity rhythm'} description={range === 'today' ? (cn ? '今天按小时显示会话、工具调用与子 Agent 数量。' : 'Hourly sessions, tool calls, and sub-agents today.') : (cn ? `${range === '7d' ? '最近 7 天' : '最近 30 天'}按天显示。` : `Daily activity for the last ${range === '7d' ? '7' : '30'} days.`)} />
      <div className="h-[280px] w-full">
        <ResponsiveContainer width="100%" height="100%" minWidth={0} initialDimension={{ width: 900, height: 280 }}><AreaChart data={data?.timeline ?? []} margin={{ left: -8, right: -8 }}>
          <CartesianGrid vertical={false} stroke="hsl(var(--border))" />
          <XAxis dataKey="label" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} interval={range === 'today' ? 2 : range === '30d' ? 4 : 0} />
          <YAxis yAxisId="activity" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} allowDecimals={false} width={36} />
          <YAxis yAxisId="tools" orientation="right" tickFormatter={compactNumber} tick={{ fontSize: 10 }} tickLine={false} axisLine={false} width={42} />
          <Tooltip contentStyle={tooltipStyle} cursor={chartCursor} />
          <Legend iconType="line" wrapperStyle={{ fontSize: 11 }} />
          <Area yAxisId="activity" name={cn ? '会话' : 'Sessions'} type="monotone" dataKey="sessions" stroke="#28666E" fill="#28666E" fillOpacity={0.12} strokeWidth={2} />
          <Line yAxisId="tools" name={cn ? '工具调用' : 'Tool calls'} type="monotone" dataKey="toolCalls" stroke="#3B6EA8" dot={false} strokeWidth={1.5} />
          <Line yAxisId="activity" name={cn ? '子 Agent' : 'Sub-agents'} type="monotone" dataKey="subagents" stroke="#BF7A45" dot={false} strokeWidth={1.5} />
        </AreaChart></ResponsiveContainer>
      </div>
    </section>

    <section className="grid gap-8 border-b py-7 lg:grid-cols-[1.35fr_.9fr]">
      <div>
        <SectionTitle title={cn ? 'Token 消耗趋势' : 'Token usage trend'} description={cn ? '按统一口径展示输入、缓存与输出。' : 'Input, cache, and output use one consistent accounting contract.'} />
        <div className="h-[250px] min-w-0"><ResponsiveContainer width="100%" height="100%" minWidth={0} initialDimension={{ width: 650, height: 250 }}><BarChart data={data?.timeline ?? []} margin={{ left: -12 }}>
          <CartesianGrid vertical={false} stroke="hsl(var(--border))" />
          <XAxis dataKey="label" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} interval={range === '30d' ? 4 : range === 'today' ? 2 : 0} />
          <YAxis tickFormatter={compactNumber} tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
          <Tooltip contentStyle={tooltipStyle} cursor={chartCursor} formatter={(value) => compactNumber(Number(value))} />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          <Bar name={cn ? '未缓存输入' : 'Uncached input'} dataKey="uncachedInputTokens" stackId="tokens" fill="#28666E" />
          <Bar name={cn ? '缓存写入' : 'Cache writes'} dataKey="cacheCreationTokens" stackId="tokens" fill="#8BA79B" />
          <Bar name={cn ? '缓存读取' : 'Cache reads'} dataKey="cacheReadTokens" stackId="tokens" fill="#A7B9AE" />
          <Bar name={cn ? '输出' : 'Output'} dataKey="outputTokens" stackId="tokens" fill="#3B6EA8" />
        </BarChart></ResponsiveContainer></div>
      </div>
      <div>
        <SectionTitle title={cn ? 'Token 组成' : 'Token composition'} description={cn ? '当前时间范围内的累计组成。' : 'Totals for the selected time range.'} />
        <div className="h-[250px] min-w-0"><ResponsiveContainer width="100%" height="100%" minWidth={0} initialDimension={{ width: 360, height: 250 }}><PieChart>
          <Pie data={tokenComposition} dataKey="value" nameKey="name" innerRadius={58} outerRadius={88} paddingAngle={2}>
            {tokenComposition.map((item, index) => <Cell key={item.name} fill={COLORS[index]} />)}
          </Pie><Tooltip contentStyle={tooltipStyle} cursor={false} formatter={(value) => compactNumber(Number(value))} /><Legend wrapperStyle={{ fontSize: 11 }} />
        </PieChart></ResponsiveContainer></div>
      </div>
    </section>

    <section className="border-b py-7">
      <SectionTitle
        title={cn ? 'Skill 使用趋势' : 'Skill usage trend'}
        description={cn ? '按时间展示用户指定和 Agent 自动启用的 Skill。' : 'User- and Agent-invoked Skills over time.'}
        aside={<div className="text-right"><span className="block text-[10px] text-muted-foreground">{cn ? '当前范围调用' : 'Invocations'}</span><strong className="text-2xl tabular-nums">{compactNumber(data.totals.skillInvocations)}</strong></div>}
      />
      {data.skillSeries.length > 0 ? <div className="h-[310px] min-w-0">
        <ResponsiveContainer width="100%" height="100%" minWidth={0} initialDimension={{ width: 900, height: 310 }}>
          <AreaChart data={skillTrend} margin={{ left: -12, right: 28, top: 8 }}>
            <CartesianGrid vertical={false} stroke="hsl(var(--border))" strokeDasharray="3 4" />
            <XAxis dataKey="label" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} interval={range === 'today' ? 2 : range === '30d' ? 4 : 0} />
            <YAxis tick={{ fontSize: 10 }} tickLine={false} axisLine={false} allowDecimals={false} />
            <Tooltip
              content={({ active, label, payload }) => <SkillTrendTooltip active={active} label={label} payload={payload} cn={cn} />}
              cursor={{ stroke: 'rgba(168, 137, 230, 0.6)', strokeWidth: 1 }}
            />
            <Legend iconType="circle" wrapperStyle={{ fontSize: 10, lineHeight: '22px' }} />
            {data.skillSeries.map((series, index) => <Area
              key={series.name}
              type="monotone"
              name={series.name === '其他' ? (cn ? '其他' : 'Other') : `$${series.name}`}
              dataKey={`skill_${index}`}
              stackId="skills"
              stroke={SKILL_COLORS[index % SKILL_COLORS.length]}
              fill={SKILL_COLORS[index % SKILL_COLORS.length]}
              fillOpacity={0.88}
              strokeWidth={1.5}
            />)}
          </AreaChart>
        </ResponsiveContainer>
      </div> : <div className="border-y py-12 text-center text-xs text-muted-foreground">{cn ? '当前时间范围还没有识别到 Skill 使用记录' : 'No Skill usage in this time range'}</div>}
    </section>

    <section className="grid gap-9 border-b py-7 lg:grid-cols-2">
      <div>
        <SectionTitle title={cn ? '模型使用' : 'Model usage'} description={cn ? '按实际记录到的 Agent 轮次统计。' : 'Counts recorded Agent turns by model.'} />
        {data.modelUsage.length > 0 ? <div className="h-[260px] min-w-0">
          <ResponsiveContainer width="100%" height="100%" minWidth={0} initialDimension={{ width: 520, height: 260 }}>
            <BarChart data={data.modelUsage.slice(0, 7)} layout="vertical" margin={{ left: 12, right: 28 }}>
              <CartesianGrid horizontal={false} stroke="hsl(var(--border))" />
              <XAxis type="number" allowDecimals={false} tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
              <YAxis type="category" dataKey="name" width={112} tickFormatter={formatModelName} tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
              <Tooltip contentStyle={tooltipStyle} cursor={chartCursor} formatter={(value) => [`${Number(value)} ${cn ? '轮' : 'turns'}`, cn ? '使用' : 'Usage']} labelFormatter={(label) => formatModelName(String(label))} />
              <Bar dataKey="turns" name={cn ? '使用轮次' : 'Turns'} fill="#28666E" radius={[0, 2, 2, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div> : <p className="border-y py-10 text-center text-xs text-muted-foreground">{cn ? '当前时间范围还没有模型记录' : 'No model records in this time range'}</p>}
      </div>
      <div>
        <SectionTitle title={cn ? '推理强度' : 'Reasoning effort'} description={cn ? '查看不同推理强度的使用轮次。' : 'Compare turns across reasoning levels.'} />
        {data.reasoningEffortUsage.length > 0 ? <div className="h-[260px] min-w-0">
          <ResponsiveContainer width="100%" height="100%" minWidth={0} initialDimension={{ width: 520, height: 260 }}>
            <BarChart data={data.reasoningEffortUsage} margin={{ left: -12, right: 12 }}>
              <CartesianGrid vertical={false} stroke="hsl(var(--border))" />
              <XAxis dataKey="name" tickFormatter={(value) => cn ? (EFFORT_LABELS[String(value)] ?? String(value)) : String(value)} tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
              <YAxis allowDecimals={false} tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
              <Tooltip contentStyle={tooltipStyle} cursor={chartCursor} formatter={(value) => [`${Number(value)} ${cn ? '轮' : 'turns'}`, cn ? '使用' : 'Usage']} labelFormatter={(label) => `${cn ? '推理强度：' : 'Reasoning: '}${cn ? (EFFORT_LABELS[String(label)] ?? String(label)) : String(label)}`} />
              <Bar dataKey="turns" name={cn ? '使用轮次' : 'Turns'} radius={[2, 2, 0, 0]}>
                {data.reasoningEffortUsage.map((item) => <Cell key={item.name} fill={EFFORT_COLORS[item.name] ?? '#6B7280'} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div> : <p className="border-y py-10 text-center text-xs text-muted-foreground">{cn ? '当前时间范围还没有推理强度记录' : 'No reasoning records in this time range'}</p>}
      </div>
    </section>

    <section className="grid gap-8 border-b py-7 lg:grid-cols-3">
      <div>
        <SectionTitle title={cn ? '常用 Skill' : 'Frequent Skills'} description={cn ? '调用次数与覆盖会话数。' : 'Invocation and session coverage.'} />
        <div className="border-t">{(data?.skills ?? []).slice(0, 8).map((skill) => <div key={skill.name} className="grid grid-cols-[1fr_56px_62px] gap-3 border-b py-2.5 text-xs"><strong className="truncate">${skill.name}</strong><span className="text-right tabular-nums">{skill.invocations}</span><span className="text-right text-muted-foreground">{skill.sessions} {cn ? '会话' : 'sessions'}</span></div>)}{!data?.skills.length && <p className="border-b py-8 text-center text-xs text-muted-foreground">{cn ? '当前范围还没有识别到 Skill 使用记录' : 'No Skill usage in this range'}</p>}</div>
      </div>
      <div>
        <SectionTitle title={cn ? '工具族' : 'Tool families'} description={cn ? '按调用目的归类。' : 'Grouped by tool purpose.'} />
        <div className="h-[250px] min-w-0"><ResponsiveContainer width="100%" height="100%" minWidth={0} initialDimension={{ width: 360, height: 250 }}><BarChart data={localizedToolFamilies.slice(0, 7)} layout="vertical" margin={{ left: 8 }}>
          <XAxis type="number" hide /><YAxis type="category" dataKey="family" width={84} tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
          <Tooltip contentStyle={tooltipStyle} cursor={chartCursor} /><Bar dataKey="calls" name={cn ? '调用' : 'Calls'} fill="#3B6EA8" radius={[0, 3, 3, 0]} />
        </BarChart></ResponsiveContainer></div>
      </div>
      <div>
        <SectionTitle title={cn ? '会话持续时间' : 'Session duration'} description={cn ? '查看短任务与长线程的分布。' : 'Distribution of short tasks and long threads.'} />
        <div className="h-[250px] min-w-0"><ResponsiveContainer width="100%" height="100%" minWidth={0} initialDimension={{ width: 360, height: 250 }}><BarChart data={durationBands} margin={{ left: -20 }}>
          <CartesianGrid vertical={false} stroke="hsl(var(--border))" /><XAxis dataKey="label" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} /><YAxis tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
          <Tooltip contentStyle={tooltipStyle} cursor={chartCursor} /><Bar dataKey="count" name={cn ? '会话' : 'Sessions'} fill="#BF7A45" radius={[3, 3, 0, 0]} />
        </BarChart></ResponsiveContainer></div>
      </div>
    </section>

    <section className="grid gap-8 border-b py-7 lg:grid-cols-[1.25fr_.75fr]">
      <div>
        <SectionTitle title={cn ? '提示词质量趋势' : 'Prompt quality trend'} description={cn ? '仅包含已经完成提示词质量分析的会话。' : 'Includes only sessions with completed prompt-quality analysis.'} />
        <div className="h-[230px] min-w-0"><ResponsiveContainer width="100%" height="100%" minWidth={0} initialDimension={{ width: 700, height: 230 }}><LineChart data={data?.timeline ?? []} margin={{ left: -16 }}>
          <CartesianGrid vertical={false} stroke="hsl(var(--border))" /><XAxis dataKey="label" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} interval={range === '30d' ? 4 : range === 'today' ? 2 : 0} /><YAxis domain={[0, 100]} tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
          <Tooltip contentStyle={tooltipStyle} cursor={{ stroke: 'rgba(40, 102, 110, 0.35)', strokeWidth: 1 }} /><Line dataKey="promptScore" name={cn ? '提示词得分' : 'Prompt score'} connectNulls={false} stroke="#28666E" strokeWidth={2} dot={{ r: 2 }} />
        </LineChart></ResponsiveContainer></div>
      </div>
      <aside className="border border-border bg-card p-5">
        <div className="flex items-center justify-between gap-3"><div><p className="vibe-mono text-[10px] tracking-[.14em] text-[#28666E]">CROSS-SESSION REPORT</p><h2 className="mt-2 text-lg font-semibold">{cn ? '跨会话行为报告' : 'Cross-session behavior report'}</h2></div><Database className="h-5 w-5 text-muted-foreground" /></div>
        <p className="mt-4 text-sm font-medium leading-6">{report?.headline ?? (cn ? '等待第一份跨会话报告' : 'Waiting for the first cross-session report')}</p>
        <dl className="mt-5 border-t pt-4 text-xs"><div className="flex justify-between gap-4"><dt className="text-muted-foreground">{cn ? '最近生成' : 'Generated'}</dt><dd className="text-right">{generatedAt ? parseStoredDate(generatedAt).toLocaleString(locale) : (cn ? '尚未生成' : 'Not generated')}</dd></div></dl>
        <Link to="/analysis" className="mt-5 block border border-foreground px-3 py-2 text-center text-xs font-semibold hover:bg-foreground hover:text-background">{cn ? '查看完整报告' : 'View full report'}</Link>
      </aside>
    </section>

    <section className="py-7">
      <SectionTitle title={cn ? '最近会话' : 'Recent sessions'} description={cn ? '回顾最近使用 Agent 完成的工作。' : 'Review recent work completed with Agents.'} aside={<Link to="/sessions" className="text-xs text-[#28666E] hover:underline">{cn ? '查看全部记录' : 'View all'} →</Link>} />
      <div className="border-t">{sessions.slice(0, 6).map((session) => <Link key={session.id} to={`/sessions?session=${encodeURIComponent(session.id)}`} className="grid grid-cols-[112px_112px_minmax(0,1fr)_80px] gap-4 border-b py-3 text-xs hover:bg-[#28666E]/[.055]"><span className="text-muted-foreground"><small className="mr-1 text-[9px]">{cn ? '开始' : 'START'}</small>{new Date(session.started_at).toLocaleString(locale, { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</span><span className="text-muted-foreground"><small className="mr-1 text-[9px]">{cn ? '更新' : 'UPDATED'}</small>{new Date(session.ended_at).toLocaleString(locale, { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</span><span className="truncate font-medium">{session.custom_title || session.generated_title || session.summary || session.project_name}</span><span className="text-right text-muted-foreground">{session.message_count} {cn ? '条消息' : 'messages'}</span></Link>)}</div>
      {!sessions.length && <div className="flex items-center justify-center gap-2 border-b py-10 text-sm text-muted-foreground"><Database className="h-4 w-4" />{cn ? '等待第一条已稳定会话' : 'Waiting for the first stable session'}</div>}
    </section>
  </div>;
}
