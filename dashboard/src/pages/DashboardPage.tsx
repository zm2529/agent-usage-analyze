import { useMemo, useState } from 'react';
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
import { useImprovements } from '@/hooks/useImprovements';
import { useSessions } from '@/hooks/useSessions';
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

function compact(value: number): string {
  return new Intl.NumberFormat('zh-CN', { notation: 'compact', maximumFractionDigits: 1 }).format(value);
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

export function PriorityDecision({ headline, plans, healthState, reportState, headlineLoading = false, plansLoading = false, healthLoading = false }: {
  headline: string | null;
  plans: Array<{ id: string; title: string; status: string; matchedTaskCount: number; maxTaskCount: number; basisChanged: boolean }>;
  healthState: string | undefined;
  reportState: string | undefined;
  headlineLoading?: boolean;
  plansLoading?: boolean;
  healthLoading?: boolean;
}) {
  const showHeadlineLoading = headlineLoading && !headline;
  const showPlansLoading = plansLoading && plans.length === 0;

  return <>
    <header className="flex flex-col justify-between gap-6 border-b border-foreground py-10 lg:flex-row lg:items-end">
      <div><p className="vibe-mono text-[10px] tracking-[.18em] text-[#28666E]">DAILY DECISION BRIEF</p><h1 className="vibe-serif mt-3 text-4xl sm:text-5xl">总览</h1><p className="mt-3 max-w-3xl text-sm leading-6 text-muted-foreground">先看最近最大的变化、成因与正在观察的改进，再看使用统计。</p></div>
      <div className="flex gap-2"><Link to="/analysis" className="flex h-11 items-center border px-4 text-xs font-semibold">进入分析证据</Link><Link to="/improvements" className="flex h-11 items-center border border-foreground bg-foreground px-4 text-xs font-semibold text-background">查看改进追踪</Link></div>
    </header>
    <section className="grid border-b border-foreground bg-card lg:grid-cols-[minmax(0,1.45fr)_minmax(330px,.72fr)]">
      <div className="flex min-h-[390px] flex-col border-b p-6 lg:border-b-0 lg:border-r">
        <p className="vibe-mono text-[10px] text-muted-foreground">最近最大的变化</p>
        {showHeadlineLoading ? <>
          <div className="mt-8 grid max-w-3xl gap-3" role="status" aria-label="正在整理最近记录">
            <DashboardSkeleton className="h-10 w-[88%] sm:h-12" />
            <DashboardSkeleton className="h-10 w-[64%] sm:h-12" />
          </div>
          <div className="mt-6 grid max-w-2xl gap-2.5">
            <DashboardSkeleton className="h-2.5 w-full" />
            <DashboardSkeleton className="h-2.5 w-3/4" />
          </div>
          <p className="mt-5 text-xs text-muted-foreground">正在整理最近记录</p>
        </> : <>
          <h2 className="vibe-serif mt-8 max-w-3xl text-3xl leading-tight sm:text-5xl">{headline ?? '最近还没有可展示的分析'}</h2>
          <p className="mt-5 max-w-3xl text-sm leading-7 text-muted-foreground">{headline ? '这是最近 30 天最值得关注的使用变化。' : '完成一次分析后，最值得关注的变化会显示在这里。'}</p>
        </>}
        <div className="mt-auto flex justify-end border-t pt-4 text-xs">
          {showHeadlineLoading ? <DashboardSkeleton className="h-3 w-20" /> : <Link to="/analysis" className="font-semibold underline underline-offset-4">查看完整分析</Link>}
        </div>
      </div>
      <div>
        <div className="border-b p-5"><h2 className="vibe-serif text-2xl">数据 / 分析健康</h2><div className="mt-4 grid grid-cols-2 border-l border-t text-xs"><div className="border-b border-r p-3"><span className="text-[10px] text-muted-foreground">数据导入</span>{healthLoading ? <DashboardSkeleton className="mt-2 h-3 w-16" /> : <strong className="mt-2 block">{healthState === 'completed' ? '最近完成' : healthState === 'running' ? '进行中' : '需要检查'}</strong>}</div><div className="border-b border-r p-3"><span className="text-[10px] text-muted-foreground">跨任务报告</span>{headlineLoading ? <DashboardSkeleton className="mt-2 h-3 w-16" /> : <strong className="mt-2 block">{reportState ?? '等待首次运行'}</strong>}</div><div className="border-b border-r p-3"><span className="text-[10px] text-muted-foreground">当前计划</span>{plansLoading ? <DashboardSkeleton className="mt-2 h-3 w-10" /> : <strong className="vibe-mono mt-2 block">{plans.length} / 3</strong>}</div><div className="border-b border-r p-3"><span className="text-[10px] text-muted-foreground">依据变化</span>{plansLoading ? <DashboardSkeleton className="mt-2 h-3 w-8" /> : <strong className="vibe-mono mt-2 block">{plans.filter((plan) => plan.basisChanged).length}</strong>}</div></div></div>
        <div className="p-5"><h2 className="vibe-serif text-2xl">接下来可以做什么</h2>{showHeadlineLoading ? <div className="mt-3 space-y-0" aria-hidden>{Array.from({ length: 3 }, (_, index) => <div key={index} className="flex items-center gap-3 border-b py-4 last:border-b-0"><span className="vibe-mono text-[10px] text-muted-foreground">0{index + 1}</span><DashboardSkeleton className={`h-2.5 ${index === 1 ? 'w-3/4' : 'w-5/6'}`} /></div>)}</div> : <ol className="mt-3"><li className="border-b py-3 text-xs"><b className="vibe-mono mr-3">01</b>查看完整分析，了解这项变化出现在哪些任务中。</li><li className="border-b py-3 text-xs"><b className="vibe-mono mr-3">02</b>跟踪正在进行的改进，观察后续任务是否发生变化。</li><li className="py-3 text-xs"><b className="vibe-mono mr-3">03</b>需要更多做法时，到实践库查看相关资料。</li></ol>}</div>
      </div>
    </section>
    <section className="mt-6 border-y border-foreground bg-card"><div className="flex items-end justify-between gap-4 border-b p-4"><div><h2 className="vibe-serif text-2xl">当前改进计划</h2><p className="mt-1 text-xs text-muted-foreground">{showPlansLoading ? '正在整理最近记录' : '查看正在观察的改进及当前进度。'}</p></div><Link to="/improvements" className="text-xs font-semibold underline underline-offset-4">管理全部计划</Link></div><div className="grid lg:grid-cols-3">{showPlansLoading ? Array.from({ length: 3 }, (_, index) => <article key={index} className="flex min-h-36 flex-col border-b p-5 last:border-b-0 lg:border-b-0 lg:border-r lg:last:border-r-0" aria-hidden><DashboardSkeleton className="h-2.5 w-16" /><DashboardSkeleton className="mt-4 h-6 w-4/5" /><DashboardSkeleton className="mt-auto h-1.5 w-full" /><DashboardSkeleton className="mt-3 h-2.5 w-2/3" /></article>) : plans.length === 0 ? <div className="p-5 text-xs text-muted-foreground"><p>{reportState === '已完成' ? '当前没有适合追踪的计划，可以从实践库选择一项开始。' : '完成分析后会在这里显示适合追踪的改进。'}</p><div className="mt-3 flex gap-4"><Link to="/analysis" className="font-semibold text-foreground underline underline-offset-4">{reportState === '需要重新分析' ? '重新分析' : '前往分析'}</Link><Link to="/practices" className="font-semibold text-foreground underline underline-offset-4">打开实践库</Link></div></div> : plans.slice(0, 3).map((plan) => <article key={plan.id} className="border-b p-5 last:border-b-0 lg:border-b-0 lg:border-r lg:last:border-r-0"><p className="vibe-mono text-[10px] text-muted-foreground">{plan.status === 'queued' ? '排队' : '自动观察'}{plan.basisChanged ? ' · 建议提前复盘' : ''}</p><h3 className="vibe-serif mt-2 text-xl">{plan.title}</h3><div className="mt-5 h-1.5 bg-muted"><i className="block h-full bg-[#28666E]" style={{ width: `${Math.min(100, plan.matchedTaskCount / Math.max(1, plan.maxTaskCount) * 100)}%` }} /></div><div className="mt-2 flex justify-between text-[10px] text-muted-foreground"><span>已观察 {plan.matchedTaskCount} / {plan.maxTaskCount} 项任务</span><span>{plan.basisChanged ? '建议提前复盘' : '持续观察'}</span></div></article>)}</div></section>
  </>;
}

const tooltipStyle = { background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 2, fontSize: 11, boxShadow: '0 10px 30px rgb(0 0 0 / .18)' };
const chartCursor = { fill: 'rgba(40, 102, 110, 0.08)' };

type SkillTooltipEntry = {
  color?: string; dataKey?: string | number; name?: string | number; value?: string | number | ReadonlyArray<string | number>;
};

export function skillTooltipEntries(payload: ReadonlyArray<SkillTooltipEntry> = []): SkillTooltipEntry[] {
  return [...payload].reverse();
}

function SkillTrendTooltip({ active, label, payload }: {
  active?: boolean;
  label?: string | number;
  payload?: ReadonlyArray<SkillTooltipEntry>;
}) {
  if (!active || !payload?.length) return null;
  return <div className="min-w-52 border border-border bg-card p-3 text-xs shadow-xl">
    <p className="mb-2 font-semibold">时间：{label}</p>
    <div className="space-y-1.5">
      {skillTooltipEntries(payload).map((entry) => <div key={String(entry.dataKey)} className="flex items-center justify-between gap-6">
        <span className="flex min-w-0 items-center gap-2"><i className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: entry.color }} /><span className="truncate">{entry.name}</span></span>
        <strong className="tabular-nums">{Number(entry.value ?? 0)}</strong>
      </div>)}
    </div>
  </div>;
}

export default function DashboardPage() {
  const [range, setRange] = useState<OverviewRange>('7d');
  const overview = useOverviewAnalytics(range);
  const behavior = useBehaviorReportSummary();
  const improvements = useImprovements();
  const { data: health, isLoading: healthLoading } = useIngestionHealth();
  const { data: sessions = [] } = useSessions({ limit: 8 });
  const data = overview.data;
  const report = behavior.data?.report;
  const generatedAt = behavior.data?.report?.generatedAt ?? null;
  const tokenComposition = useMemo(() => data ? [
    { name: '未缓存输入', value: data.totals.uncachedInputTokens },
    { name: '缓存写入', value: data.totals.cacheCreationTokens },
    { name: '缓存读取', value: data.totals.cacheReadTokens },
    { name: '输出', value: data.totals.outputTokens },
  ] : [], [data]);
  const skillTrend = useMemo(() => (data?.skillTimeline ?? []).map((point) => ({
    key: point.key,
    label: point.label,
    total: point.total,
    ...Object.fromEntries((data?.skillSeries ?? []).map((series, index) => [
      `skill_${index}`,
      point.counts[series.name] ?? 0,
    ])),
  })), [data]);
  const priority = <PriorityDecision
    headline={report?.headline ?? null}
    plans={(improvements.data?.plans ?? []).filter((plan) => ['observing', 'queued', 'review-ready'].includes(plan.status))}
    healthState={health?.status}
    reportState={behavior.data?.generation.running ? '分析中' : behavior.data?.report ? '已完成' : behavior.data?.latestAttempt?.status === 'completed' ? '需要重新分析' : behavior.data?.latestAttempt?.status}
    headlineLoading={behavior.isLoading}
    plansLoading={improvements.isLoading}
    healthLoading={healthLoading}
  />;

  if (overview.isLoading) {
    return <div className="vibe-page pb-16">{priority}<section className="mt-7" aria-busy="true"><h2 className="vibe-serif text-2xl">使用统计</h2><p className="mt-1 text-xs text-muted-foreground">已有记录先显示，其余内容正在整理。</p><div className="overview-metrics mt-4" aria-hidden>{Array.from({ length: 8 }, (_, index) => <div key={index} className="overview-metric flex flex-col"><DashboardSkeleton className="h-2.5 w-16" /><DashboardSkeleton className="mt-4 h-7 w-14" /><DashboardSkeleton className="mt-3 h-2.5 w-3/4" /></div>)}</div></section></div>;
  }
  if (overview.isError || !data) {
    return <div className="vibe-page pb-16">{priority}<p className="mt-7 border-y border-destructive py-5 text-sm text-destructive">详细统计暂时不可用；最近成功的分析摘要仍保留，请确认服务后刷新。</p></div>;
  }

  return <div className="vibe-page pb-16">
    {priority}
    <header className="mt-8 border-b border-foreground/80 pb-6 pt-8">
      <div className="flex flex-wrap items-start justify-between gap-5">
        <div>
          <p className="vibe-mono text-[10px] tracking-[.18em] text-[#28666E]">LOCAL FACTS / SECOND SCREEN</p>
          <h2 className="vibe-serif mt-3 text-3xl">使用统计</h2>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">查看使用规模、Agent 编排、Skill 与工具、Token 结构和提示词质量。所有数值来自本地已导入会话。</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex border border-border bg-card p-1" aria-label="统计时间范围">
            {([['today', '当天'], ['7d', '7 天'], ['30d', '30 天']] as const).map(([value, label]) => <button
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
      <span className="flex items-center gap-2"><span className={`h-2 w-2 rounded-full ${health?.status === 'completed' ? 'bg-[#28666E]' : 'bg-[#BF7A45]'}`} />所有统计均来自本机已整理的会话记录</span>
      <span>{data ? `统计生成 ${new Date(data.generatedAt).toLocaleTimeString('zh-CN')}` : '正在读取统计'}</span>
    </div>

    <section className="overview-metrics">
      <Metric label="会话" value={compact(data?.totals.sessions ?? 0)} detail={`${data?.totals.projects ?? 0} 个项目`} icon={MessageSquareText} />
      <Metric label="主任务" value={compact(data?.totals.rootTasks ?? 0)} detail="根任务" icon={FileText} />
      <Metric label="子 Agent" value={compact(data?.totals.subagents ?? 0)} detail="委派任务" icon={Bot} />
      <Metric label="持续时间" value={duration(data?.totals.durationMinutes ?? 0)} detail="会话累计" icon={Clock3} />
      <Metric label="工具调用" value={compact(data?.totals.toolCalls ?? 0)} detail="全部工具事件" icon={Wrench} />
      <Metric label="Skill" value={compact(data?.totals.skillInvocations ?? 0)} detail="用户指定与 Agent 自动启用" icon={Sparkles} />
      <Metric
        label="处理 Token"
        value={compact(data?.totals.totalProcessedTokens ?? 0)}
        detail={`未缓存输入 ${compact(data?.totals.uncachedInputTokens ?? 0)} · 缓存写入 ${compact(data?.totals.cacheCreationTokens ?? 0)} · 缓存读取 ${compact(data?.totals.cacheReadTokens ?? 0)} · 输出 ${compact(data?.totals.outputTokens ?? 0)}`}
        icon={Cpu}
      />
      <Metric
        label="提示词质量"
        value={data?.totals.promptScore == null ? '—' : String(data.totals.promptScore)}
        detail={`已分析 ${data.totals.promptScoreAnalyzedSessions}/${data.totals.promptScoreEligibleSessions} 个会话`}
        icon={Activity}
      />
    </section>

    <section className="border-b py-7">
      <SectionTitle title="活动节奏" description={range === 'today' ? '今天按小时显示会话、工具调用与子 Agent 数量。' : `${range === '7d' ? '最近 7 天' : '最近 30 天'}按天显示，不用累计值掩盖波动。`} />
      <div className="h-[280px] w-full">
        <ResponsiveContainer width="100%" height="100%" minWidth={0} initialDimension={{ width: 900, height: 280 }}><AreaChart data={data?.timeline ?? []} margin={{ left: -20, right: 8 }}>
          <CartesianGrid vertical={false} stroke="hsl(var(--border))" />
          <XAxis dataKey="label" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} interval={range === 'today' ? 2 : range === '30d' ? 4 : 0} />
          <YAxis tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
          <Tooltip contentStyle={tooltipStyle} cursor={chartCursor} />
          <Legend iconType="line" wrapperStyle={{ fontSize: 11 }} />
          <Area name="会话" type="monotone" dataKey="sessions" stroke="#28666E" fill="#28666E" fillOpacity={0.12} strokeWidth={2} />
          <Line name="工具调用" type="monotone" dataKey="toolCalls" stroke="#3B6EA8" dot={false} strokeWidth={1.5} />
          <Line name="子 Agent" type="monotone" dataKey="subagents" stroke="#BF7A45" dot={false} strokeWidth={1.5} />
        </AreaChart></ResponsiveContainer>
      </div>
    </section>

    <section className="grid gap-8 border-b py-7 lg:grid-cols-[1.35fr_.9fr]">
      <div>
        <SectionTitle title="Token 消耗趋势" description="未缓存输入、缓存写入、缓存读取与输出使用同一契约，总和等于处理 Token。" />
        <div className="h-[250px] min-w-0"><ResponsiveContainer width="100%" height="100%" minWidth={0} initialDimension={{ width: 650, height: 250 }}><BarChart data={data?.timeline ?? []} margin={{ left: -12 }}>
          <CartesianGrid vertical={false} stroke="hsl(var(--border))" />
          <XAxis dataKey="label" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} interval={range === '30d' ? 4 : range === 'today' ? 2 : 0} />
          <YAxis tickFormatter={compact} tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
          <Tooltip contentStyle={tooltipStyle} cursor={chartCursor} formatter={(value) => compact(Number(value))} />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          <Bar name="未缓存输入" dataKey="uncachedInputTokens" stackId="tokens" fill="#28666E" />
          <Bar name="缓存写入" dataKey="cacheCreationTokens" stackId="tokens" fill="#8BA79B" />
          <Bar name="缓存读取" dataKey="cacheReadTokens" stackId="tokens" fill="#A7B9AE" />
          <Bar name="输出" dataKey="outputTokens" stackId="tokens" fill="#3B6EA8" />
        </BarChart></ResponsiveContainer></div>
      </div>
      <div>
        <SectionTitle title="Token 组成" description="当前时间范围内的累计组成。" />
        <div className="h-[250px] min-w-0"><ResponsiveContainer width="100%" height="100%" minWidth={0} initialDimension={{ width: 360, height: 250 }}><PieChart>
          <Pie data={tokenComposition} dataKey="value" nameKey="name" innerRadius={58} outerRadius={88} paddingAngle={2}>
            {tokenComposition.map((item, index) => <Cell key={item.name} fill={COLORS[index]} />)}
          </Pie><Tooltip contentStyle={tooltipStyle} cursor={false} formatter={(value) => compact(Number(value))} /><Legend wrapperStyle={{ fontSize: 11 }} />
        </PieChart></ResponsiveContainer></div>
      </div>
    </section>

    <section className="border-b py-7">
      <SectionTitle
        title="Skill 使用趋势"
        description="按时间展示用户指定和 Agent 自动启用的 Skill；同一时段按 Skill 叠加。"
        aside={<div className="text-right"><span className="block text-[10px] text-muted-foreground">当前范围调用</span><strong className="text-2xl tabular-nums">{compact(data.totals.skillInvocations)}</strong></div>}
      />
      {data.skillSeries.length > 0 ? <div className="h-[310px] min-w-0">
        <ResponsiveContainer width="100%" height="100%" minWidth={0} initialDimension={{ width: 900, height: 310 }}>
          <AreaChart data={skillTrend} margin={{ left: -12, right: 28, top: 8 }}>
            <CartesianGrid vertical={false} stroke="hsl(var(--border))" strokeDasharray="3 4" />
            <XAxis dataKey="label" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} interval={range === 'today' ? 2 : range === '30d' ? 4 : 0} />
            <YAxis tick={{ fontSize: 10 }} tickLine={false} axisLine={false} allowDecimals={false} />
            <Tooltip
              content={({ active, label, payload }) => <SkillTrendTooltip active={active} label={label} payload={payload} />}
              cursor={{ stroke: 'rgba(168, 137, 230, 0.6)', strokeWidth: 1 }}
            />
            <Legend iconType="circle" wrapperStyle={{ fontSize: 10, lineHeight: '22px' }} />
            {data.skillSeries.map((series, index) => <Area
              key={series.name}
              type="monotone"
              name={series.name === '其他' ? '其他' : `$${series.name}`}
              dataKey={`skill_${index}`}
              stackId="skills"
              stroke={SKILL_COLORS[index % SKILL_COLORS.length]}
              fill={SKILL_COLORS[index % SKILL_COLORS.length]}
              fillOpacity={0.88}
              strokeWidth={1.5}
            />)}
          </AreaChart>
        </ResponsiveContainer>
      </div> : <div className="border-y py-12 text-center text-xs text-muted-foreground">当前时间范围还没有识别到 Skill 使用记录</div>}
    </section>

    <section className="grid gap-9 border-b py-7 lg:grid-cols-2">
      <div>
        <SectionTitle title="模型使用" description="按实际记录到的 Agent 轮次统计；同一会话切换模型会分别计入。" />
        {data.modelUsage.length > 0 ? <div className="h-[260px] min-w-0">
          <ResponsiveContainer width="100%" height="100%" minWidth={0} initialDimension={{ width: 520, height: 260 }}>
            <BarChart data={data.modelUsage.slice(0, 7)} layout="vertical" margin={{ left: 12, right: 28 }}>
              <CartesianGrid horizontal={false} stroke="hsl(var(--border))" />
              <XAxis type="number" allowDecimals={false} tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
              <YAxis type="category" dataKey="name" width={112} tickFormatter={formatModelName} tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
              <Tooltip contentStyle={tooltipStyle} cursor={chartCursor} formatter={(value) => [`${Number(value)} 轮`, '使用']} labelFormatter={(label) => formatModelName(String(label))} />
              <Bar dataKey="turns" name="使用轮次" fill="#28666E" radius={[0, 2, 2, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div> : <p className="border-y py-10 text-center text-xs text-muted-foreground">当前时间范围还没有模型记录</p>}
      </div>
      <div>
        <SectionTitle title="推理强度" description="查看不同推理强度的使用轮次，帮助判断是否总在使用同一档位。" />
        {data.reasoningEffortUsage.length > 0 ? <div className="h-[260px] min-w-0">
          <ResponsiveContainer width="100%" height="100%" minWidth={0} initialDimension={{ width: 520, height: 260 }}>
            <BarChart data={data.reasoningEffortUsage} margin={{ left: -12, right: 12 }}>
              <CartesianGrid vertical={false} stroke="hsl(var(--border))" />
              <XAxis dataKey="name" tickFormatter={(value) => EFFORT_LABELS[String(value)] ?? String(value)} tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
              <YAxis allowDecimals={false} tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
              <Tooltip contentStyle={tooltipStyle} cursor={chartCursor} formatter={(value) => [`${Number(value)} 轮`, '使用']} labelFormatter={(label) => `推理强度：${EFFORT_LABELS[String(label)] ?? String(label)}`} />
              <Bar dataKey="turns" name="使用轮次" radius={[2, 2, 0, 0]}>
                {data.reasoningEffortUsage.map((item) => <Cell key={item.name} fill={EFFORT_COLORS[item.name] ?? '#6B7280'} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div> : <p className="border-y py-10 text-center text-xs text-muted-foreground">当前时间范围还没有推理强度记录</p>}
      </div>
    </section>

    <section className="grid gap-8 border-b py-7 lg:grid-cols-3">
      <div>
        <SectionTitle title="常用 Skill" description="调用次数与覆盖会话数；是否合适请查看单次会话评价。" />
        <div className="border-t">{(data?.skills ?? []).slice(0, 8).map((skill) => <div key={skill.name} className="grid grid-cols-[1fr_56px_62px] gap-3 border-b py-2.5 text-xs"><strong className="truncate">${skill.name}</strong><span className="text-right tabular-nums">{skill.invocations}</span><span className="text-right text-muted-foreground">{skill.sessions} 会话</span></div>)}{!data?.skills.length && <p className="border-b py-8 text-center text-xs text-muted-foreground">当前范围还没有识别到 Skill 使用记录</p>}</div>
      </div>
      <div>
        <SectionTitle title="工具族" description="按调用目的归类，便于识别工作方式变化。" />
        <div className="h-[250px] min-w-0"><ResponsiveContainer width="100%" height="100%" minWidth={0} initialDimension={{ width: 360, height: 250 }}><BarChart data={(data?.toolFamilies ?? []).slice(0, 7)} layout="vertical" margin={{ left: 8 }}>
          <XAxis type="number" hide /><YAxis type="category" dataKey="family" width={84} tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
          <Tooltip contentStyle={tooltipStyle} cursor={chartCursor} /><Bar dataKey="calls" name="调用" fill="#3B6EA8" radius={[0, 3, 3, 0]} />
        </BarChart></ResponsiveContainer></div>
      </div>
      <div>
        <SectionTitle title="会话持续时间" description="查看短任务与长线程的结构，而非只看平均值。" />
        <div className="h-[250px] min-w-0"><ResponsiveContainer width="100%" height="100%" minWidth={0} initialDimension={{ width: 360, height: 250 }}><BarChart data={data?.durationBands ?? []} margin={{ left: -20 }}>
          <CartesianGrid vertical={false} stroke="hsl(var(--border))" /><XAxis dataKey="label" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} /><YAxis tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
          <Tooltip contentStyle={tooltipStyle} cursor={chartCursor} /><Bar dataKey="count" name="会话" fill="#BF7A45" radius={[3, 3, 0, 0]} />
        </BarChart></ResponsiveContainer></div>
      </div>
    </section>

    <section className="grid gap-8 border-b py-7 lg:grid-cols-[1.25fr_.75fr]">
      <div>
        <SectionTitle title="提示词质量趋势" description="仅包含已经完成提示词质量分析的会话；空值不会被当作 0 分。" />
        <div className="h-[230px] min-w-0"><ResponsiveContainer width="100%" height="100%" minWidth={0} initialDimension={{ width: 700, height: 230 }}><LineChart data={data?.timeline ?? []} margin={{ left: -16 }}>
          <CartesianGrid vertical={false} stroke="hsl(var(--border))" /><XAxis dataKey="label" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} interval={range === '30d' ? 4 : range === 'today' ? 2 : 0} /><YAxis domain={[0, 100]} tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
          <Tooltip contentStyle={tooltipStyle} cursor={{ stroke: 'rgba(40, 102, 110, 0.35)', strokeWidth: 1 }} /><Line dataKey="promptScore" name="提示词得分" connectNulls={false} stroke="#28666E" strokeWidth={2} dot={{ r: 2 }} />
        </LineChart></ResponsiveContainer></div>
      </div>
      <aside className="border border-border bg-card p-5">
        <div className="flex items-center justify-between gap-3"><div><p className="vibe-mono text-[10px] tracking-[.14em] text-[#28666E]">CROSS-SESSION REPORT</p><h2 className="mt-2 text-lg font-semibold">跨会话行为报告</h2></div><Database className="h-5 w-5 text-muted-foreground" /></div>
        <p className="mt-4 text-sm font-medium leading-6">{report?.headline ?? '等待第一份跨会话报告'}</p>
        <dl className="mt-5 border-t pt-4 text-xs"><div className="flex justify-between gap-4"><dt className="text-muted-foreground">最近生成</dt><dd className="text-right">{generatedAt ? parseStoredDate(generatedAt).toLocaleString('zh-CN') : '尚未生成'}</dd></div></dl>
        <Link to="/analysis" className="mt-5 block border border-foreground px-3 py-2 text-center text-xs font-semibold hover:bg-foreground hover:text-background">查看完整报告</Link>
      </aside>
    </section>

    <section className="py-7">
      <SectionTitle title="最近会话" description="回顾最近使用 Agent 完成的工作。" aside={<Link to="/sessions" className="text-xs text-[#28666E] hover:underline">查看全部记录 →</Link>} />
      <div className="border-t">{sessions.slice(0, 6).map((session) => <Link key={session.id} to={`/sessions?session=${encodeURIComponent(session.id)}`} className="grid grid-cols-[112px_112px_minmax(0,1fr)_80px] gap-4 border-b py-3 text-xs hover:bg-[#28666E]/[.055]"><span className="text-muted-foreground"><small className="mr-1 text-[9px]">开始</small>{new Date(session.started_at).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</span><span className="text-muted-foreground"><small className="mr-1 text-[9px]">更新</small>{new Date(session.ended_at).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</span><span className="truncate font-medium">{session.custom_title || session.generated_title || session.summary || session.project_name}</span><span className="text-right text-muted-foreground">{session.message_count} 条消息</span></Link>)}</div>
      {!sessions.length && <div className="flex items-center justify-center gap-2 border-b py-10 text-sm text-muted-foreground"><Database className="h-4 w-4" />等待第一条已稳定会话</div>}
    </section>
  </div>;
}
