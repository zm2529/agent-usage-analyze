import { Link } from 'react-router';
import { ChevronDown, RefreshCw, Target } from 'lucide-react';
import { AnalysisRunTrace } from '@/components/analysis/AnalysisRunTrace';
import { useBehaviorReport, useRunBehaviorReport } from '@/hooks/useBehaviorReport';
import { useLanguage } from '@/i18n/LanguageProvider';

function parseDate(value: string): Date {
  return new Date(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value) ? `${value.replace(' ', 'T')}Z` : value);
}

function EvidenceLinks({ refs }: { refs: string[] }) {
  if (!refs.length) return null;
  const labels: Record<string, string> = {
    'activity.windowSessions': '分析范围内的会话',
    'activity.rootTasks': '主任务',
    'activity.subagentTasks': '子 Agent 任务',
    'activity.projectSwitchesWithinTwoHours': '两小时内发生的项目切换',
    'activity.shortFollowups': '简短补充消息',
    'activity.shortFollowupRate': '简短补充消息占比',
    'coverage.semanticEnrichmentRatio': '已完成详细分析的会话占比',
    'leverage.skills.coveredSessions': '使用过 Skill 的会话',
    'leverage.skills.explicitInvocations': '用户指定 Skill',
    'leverage.skills.automaticInvocations': 'Agent 自动启用 Skill',
    'leverage.tools.totalCalls': '工具调用',
    'promptSignals.withConstraint': '开头说明约束的会话',
    'promptSignals.withPath': '开头说明路径的会话',
    'promptSignals.withSkillReference': '开头提到 Skill 的会话',
    'promptSignals.withValidation': '开头提到验证的会话',
    'tokenEfficiency.cacheReadShare': '缓存读取占比',
    'tokenEfficiency.sessionsWithCompaction': '发生上下文压缩的会话',
  };
  const readable = (ref: string) => {
    const [key, value] = ref.split('=', 2);
    if (labels[key]) {
      const normalized = key.endsWith('Rate') || key.endsWith('Ratio') || key.endsWith('Share')
        ? `${Math.round(Number(value) * 100)}%`
        : value;
      return `${labels[key]}：${normalized}`;
    }
    if (ref === 'leverage.skills.items') return '各 Skill 的使用明细';
    if (ref === 'contextDocuments.measurementNote') return '上下文文档统计说明';
    if (ref.startsWith('representativeEpisodes')) return '具有代表性的会话片段';
    if (ref === 'activity') return '会话数量、任务层级与项目切换统计';
    if (ref === 'leverage.tools') return '工具调用次数与使用类型统计';
    if (ref === 'leverage.skills') return 'Skill 使用方式与次数统计';
    if (ref === 'promptSignals') return '任务开头提供信息的统计';
    if (ref === 'tokenEfficiency') return 'Token 与上下文压缩统计';
    if (ref === 'investigatorResearch.profileThesis') return '模型对整体使用方式的归纳';
    const finding = ref.match(/^investigatorResearch\.behavioralFindings\.(\d+)$/);
    if (finding) return `模型归纳的跨会话观察 ${Number(finding[1]) + 1}`;
    const family = ref.match(/^leverage\.tools\.families\.([^.]+)\.(calls|tasks)=(.+)$/);
    if (family) return `${family[1]}：${family[3]} ${family[2] === 'calls' ? '次调用' : '个任务'}`;
    const tool = ref.match(/^leverage\.tools\.topTools\.([^.]+)\.calls=(.+)$/);
    if (tool) return `${tool[1]}：${tool[2]} 次调用`;
    const readablePath = ref.split('.').filter(Boolean).slice(-2).join(' / ');
    return readablePath ? `分析依据：${readablePath}` : '一项本地分析依据';
  };
  return <details className="mt-3 text-[10px] text-muted-foreground vibe-mono">
    <summary className="cursor-pointer hover:text-foreground">证据来源 · {refs.length} 项</summary>
    <div className="mt-2 flex flex-wrap gap-2">{refs.slice(0, 8).map((ref, index) => ref.startsWith('codex:')
      ? <Link key={ref} to={`/sessions?session=${encodeURIComponent(ref)}`} className="border border-[#365D8D]/50 px-2 py-1 font-sans text-[#365D8D] hover:bg-[#365D8D]/10">查看来源会话 {index + 1}</Link>
      : <span key={ref} className="border border-border px-2 py-1 font-sans">{readable(ref)}</span>)}</div>
  </details>;
}

function AnalysisItem({ title, meta, children, collapsible = true }: {
  title: string;
  meta?: string;
  children: React.ReactNode;
  collapsible?: boolean;
}) {
  if (collapsible) {
    return <details className="group border-b">
      <summary className="flex cursor-pointer list-none items-start justify-between gap-4 py-4">
        <span className="text-sm font-semibold">{title}</span>
        <span className="flex shrink-0 items-center gap-2 text-[10px] text-muted-foreground">
          {meta}<ChevronDown className="h-3.5 w-3.5 transition-transform group-open:rotate-180" />
        </span>
      </summary>
      <div className="pb-4 text-sm leading-6 text-muted-foreground">{children}</div>
    </details>;
  }
  return <article className="border-b py-4">
    <div className="flex items-start justify-between gap-4">
      <span className="text-sm font-semibold">{title}</span>
      {meta && <span className="shrink-0 text-[10px] text-muted-foreground">{meta}</span>}
    </div>
    <div className="mt-2 text-sm leading-6 text-muted-foreground">{children}</div>
  </article>;
}

const statusLabel = { established: '多项证据支持', candidate: '需要继续观察', qualitative: '当前观察' } as const;
const confidenceLabel = { high: '较高', medium: '中等', low: '有限' } as const;

export default function ImprovePage() {
  const { language, t } = useLanguage();
  const state = useBehaviorReport();
  const run = useRunBehaviorReport();
  const dataset = state.data?.dataset;
  const report = state.data?.report;
  const isGenerating = run.isPending || state.data?.generation?.running === true;
  const reportRun = state.data?.run?.status === 'completed' && report ? state.data.run : null;
  const latestAttemptFailed = state.data?.latestAttempt?.status === 'failed'
    || state.data?.latestAttempt?.status === 'rejected';
  const locale = language === 'zh-CN' ? 'zh-CN' : 'en-US';
  const inputSummary = reportRun?.inputSummary ?? {};
  const inputWindow = inputSummary.window as { startsAt?: string; endsAt?: string } | undefined;
  const inputCoverage = inputSummary.coverage as {
    windowSessions?: number;
    structurallyAnalyzedSessions?: number;
    semanticEnrichedSessions?: number;
  } | undefined;
  const inputBasis = inputSummary.basis as { latestSessionAt?: string | null } | undefined;
  const representativeSample = inputSummary.representativeSample as { count?: number } | undefined;
  const reportWindow = inputWindow?.startsAt && inputWindow.endsAt ? inputWindow : dataset?.window;
  const reportCoverage = typeof inputCoverage?.structurallyAnalyzedSessions === 'number'
    && typeof inputCoverage.windowSessions === 'number'
    ? inputCoverage : dataset?.coverage;
  const evidenceCutoff = inputBasis?.latestSessionAt ?? reportRun?.createdAt ?? null;
  const hasNewEvidence = Boolean(dataset?.basis.latestSessionAt && evidenceCutoff
    && parseDate(dataset.basis.latestSessionAt) > parseDate(evidenceCutoff));
  const contextAssessments = report?.contextDocumentAssessments ?? [];
  const contextAttention = contextAssessments.filter((item) => item.assessment === 'mixed' || item.assessment === 'costly');
  const contextHelpful = contextAssessments.filter((item) => item.assessment === 'helpful');

  if (state.isLoading) {
    return <div className="vibe-page" aria-busy="true" aria-label="正在读取跨任务分析">
      <div className="h-9 animate-pulse border-y bg-muted/20" />
      <header className="border-b border-foreground py-10">
        <div className="h-3 w-44 animate-pulse bg-muted/40" />
        <div className="mt-5 h-14 max-w-2xl animate-pulse bg-muted/30" />
        <div className="mt-4 h-5 max-w-3xl animate-pulse bg-muted/20" />
      </header>
      <section className="grid border-b md:grid-cols-5">
        {Array.from({ length: 5 }, (_, index) => <div key={index} className="h-24 animate-pulse border-r bg-muted/15" />)}
      </section>
      <section className="grid gap-6 py-10 lg:grid-cols-3">
        {Array.from({ length: 3 }, (_, index) => <div key={index} className="h-48 animate-pulse border-y bg-muted/15" />)}
      </section>
    </div>;
  }

  return <div className="vibe-page">
    <div className="flex min-h-9 flex-wrap items-center justify-between gap-3 border-y py-2 text-[10px] text-muted-foreground vibe-mono">
      <span>{reportRun ? `上次分析 · ${parseDate(reportRun.createdAt).toLocaleString(locale)}` : '等待首次分析'}</span>
      <span className={hasNewEvidence || state.data?.needsRegeneration ? 'text-[#C08A36]' : ''}>
        {latestAttemptFailed && report
          ? '上次更新失败，正在显示最近一次成功结果'
          : state.data?.needsRegeneration
            ? '分析方法已更新，需要重新分析'
            : hasNewEvidence
              ? '有新的会话记录，可以重新分析'
              : report ? '已包含最新会话记录' : '尚无分析结果'}
      </span>
    </div>

    <header className="flex flex-col justify-between gap-8 border-b border-foreground py-10 lg:flex-row lg:items-end">
      <div>
        <p className="vibe-mono flex items-center gap-3 text-[11px] tracking-[.15em] text-muted-foreground"><span className="w-6 border-t-2 border-[#4F775F]" />AGENT USAGE REVIEW</p>
        <h1 className="vibe-serif mt-5 text-4xl leading-tight sm:text-6xl">你的 Agent 使用方式</h1>
        <p className="mt-4 max-w-3xl text-sm leading-6 text-muted-foreground">从最近 30 天的会话中总结常见做法、值得保留的地方和可以改进之处。</p>
      </div>
      <button type="button" onClick={() => run.mutate()} disabled={isGenerating || state.isLoading || Boolean(state.data?.eligibilityReason)} className="flex items-center justify-center gap-2 border border-foreground px-4 py-2.5 text-sm font-semibold hover:bg-foreground hover:text-background disabled:cursor-not-allowed disabled:opacity-50">
        <RefreshCw className={`h-4 w-4 ${isGenerating ? 'animate-spin' : ''}`} />{isGenerating ? t('analysis.generating', 'Generating…') : report ? t('analysis.regenerate', 'Regenerate report') : t('analysis.generateReport', 'Generate LLM report')}
      </button>
    </header>

    <section className="grid border-b md:grid-cols-5">
      <div className="border-b py-5 md:border-b-0 md:border-r md:pr-5"><p className="vibe-mono text-[10px] text-muted-foreground">报告生成时间</p><p className="mt-2 text-sm font-semibold">{reportRun ? parseDate(reportRun.createdAt).toLocaleString(locale) : '—'}</p></div>
      <div className="border-b py-5 md:border-b-0 md:border-r md:px-5"><p className="vibe-mono text-[10px] text-muted-foreground">数据窗口</p><p className="mt-2 text-sm font-semibold">{reportWindow?.startsAt && reportWindow.endsAt ? `${parseDate(reportWindow.startsAt).toLocaleDateString(locale)} – ${parseDate(reportWindow.endsAt).toLocaleDateString(locale)}` : '—'}</p></div>
      <div className="border-b py-5 md:border-b-0 md:border-r md:px-5"><p className="vibe-mono text-[10px] text-muted-foreground">全量结构分析</p><p className="mt-2 text-sm font-semibold">{reportCoverage ? `${reportCoverage.structurallyAnalyzedSessions}/${reportCoverage.windowSessions} 个会话完成结构分析` : '—'}</p></div>
      <div className="border-b py-5 md:border-b-0 md:border-r md:px-5"><p className="vibe-mono text-[10px] text-muted-foreground">可选语义增强</p><p className="mt-2 text-sm font-semibold">{reportCoverage ? `${reportCoverage.semanticEnrichedSessions ?? 0} 个会话带语义增强` : '—'}</p></div>
      <div className="py-5 md:pl-5"><p className="vibe-mono text-[10px] text-muted-foreground">代表性片段</p><p className="mt-2 text-sm font-semibold">{representativeSample?.count ?? dataset?.representativeEpisodes.length ?? 0} 个分层样本</p></div>
    </section>
    {state.isError && <p className="border-b py-5 text-sm text-destructive">无法加载 Agent 使用分析。</p>}
    {run.isError && <p className="border-b py-5 text-sm text-destructive">分析失败，请在页面底部查看运行记录。</p>}
    {!report && <section className="border-b py-12 text-center"><h2 className="vibe-serif text-2xl">{isGenerating ? t('analysis.generatingReport', 'Generating the cross-session LLM report…') : state.data?.needsRegeneration ? '分析方法已更新' : '尚未生成使用分析'}</h2><p className="mx-auto mt-3 max-w-2xl text-sm text-muted-foreground">{isGenerating ? `任务已在后台持续运行${state.data?.generation?.startedAt ? `，开始于 ${parseDate(state.data.generation.startedAt).toLocaleString(locale)}` : ''}；离开本页不会中断。` : state.data?.needsRegeneration ? '现有结果使用旧版分析方法。你可以现在重新生成，或等待下一次自动分析。' : (state.data?.eligibilityReason ?? '最近 30 天具备至少 10 个可结构分析会话后即可生成。')}</p></section>}

    {report && <>
      <section className="grid border-b py-10 lg:grid-cols-[280px_1fr] lg:gap-12">
        <div><p className="vibe-mono text-[10px] tracking-[.14em] text-[#365D8D]">CURRENT IDENTITY</p><p className="vibe-serif mt-3 text-3xl">{report.identity.title}</p><p className="mt-2 text-xs font-semibold text-[#4F775F]">{report.identity.stage}</p></div>
        <div><h2 className="vibe-serif text-3xl leading-snug">{report.headline}</h2><details className="mt-5 border-t"><summary className="cursor-pointer py-4 text-sm font-semibold">查看完整说明</summary><div className="pb-4"><p className="text-sm leading-7 text-muted-foreground">{report.identity.rationale}</p><p className="mt-3 text-sm leading-7 text-muted-foreground">{report.summary}</p><EvidenceLinks refs={report.identity.evidenceRefs} /></div></details></div>
      </section>

      <section className="border-b py-9"><div className="mb-5"><p className="vibe-mono text-[10px] tracking-[.14em] text-muted-foreground">USAGE SUMMARY</p><h2 className="vibe-serif mt-2 text-2xl">主要使用特点</h2></div><div className="border-t">{report.portrait.map((item, index) => <AnalysisItem key={`${item.title}-${index}`} title={item.title} meta={String(index + 1).padStart(2, '0')} collapsible={false}><p>{item.finding}</p><EvidenceLinks refs={item.evidenceRefs} /></AnalysisItem>)}</div></section>

      <section className="grid border-b lg:grid-cols-2">
        <div className="py-9 lg:border-r lg:pr-9"><h2 className="vibe-serif text-2xl">做得好的地方</h2><div className="mt-4 border-t">{report.strengths.map((item, index) => <AnalysisItem key={`${item.title}-${index}`} title={item.title} meta={String(index + 1).padStart(2, '0')}><p>{item.explanation}</p><p className="mt-3 border-l-2 border-[#4F775F] pl-3 text-xs leading-5"><strong>为什么有效：</strong>{item.mechanism}</p><EvidenceLinks refs={item.evidenceRefs} /></AnalysisItem>)}</div></div>
        <div className="py-9 lg:pl-9"><h2 className="vibe-serif text-2xl">可以改进的地方</h2><div className="mt-4 border-t">{report.bottlenecks.map((item, index) => <AnalysisItem key={`${item.title}-${index}`} title={item.title} meta={String(index + 1).padStart(2, '0')}><p>{item.explanation}</p><p className="mt-3 border-l-2 border-[#D86F4B] pl-3 text-xs leading-5"><strong>为什么值得关注：</strong>{item.mechanism}</p>{item.counterEvidence.length > 0 && <p className="mt-2 text-xs leading-5"><strong>不一定适用的情况：</strong>{item.counterEvidence.join('；')}</p>}<EvidenceLinks refs={item.evidenceRefs} /></AnalysisItem>)}</div></div>
      </section>

      <section className="border-b py-9"><div className="mb-5 flex flex-col justify-between gap-3 md:flex-row md:items-end"><div><p className="vibe-mono text-[10px] tracking-[.14em] text-muted-foreground">USAGE PATTERNS</p><h2 className="vibe-serif mt-2 text-2xl">值得关注的使用习惯</h2><p className="mt-1 max-w-3xl text-xs leading-5 text-muted-foreground">这些内容由模型从代表性会话中总结，不是固定评分。证据不足时只作为待观察事项。</p></div><span className="vibe-mono text-[10px] text-muted-foreground">{report.dimensions.length} 项</span></div><div className="border-t">{report.dimensions.map((item, index) => <AnalysisItem key={item.id} title={item.label} meta={`${String(index + 1).padStart(2, '0')} · ${statusLabel[item.status]}`}><p>{item.observation}</p><div className="mt-4 grid gap-3 border-t pt-4 text-xs leading-5"><p><strong>可能的帮助：</strong>{item.benefitHypothesis}</p><p><strong>适用场景：</strong>{item.applicability.join('；') || '未限定'}</p><p><strong>目前的局限：</strong>{item.limitations.join('；') || '未记录'} · 可信程度{confidenceLabel[item.confidence]}</p></div><EvidenceLinks refs={item.evidenceRefs} /></AnalysisItem>)}</div></section>
    </>}

    {dataset?.leverage && <section className="border-b py-9"><div className="mb-5"><h2 className="vibe-serif text-2xl">Skill 与工具使用</h2></div><div className="grid gap-9 lg:grid-cols-[minmax(0,1.35fr)_minmax(280px,.9fr)]">
      <div><div className="mb-3 flex flex-wrap gap-4 text-xs"><span>用户指定 <strong>{dataset.leverage.skills.explicitInvocations ?? 0}</strong> 次</span><span>Agent 自动启用 <strong>{dataset.leverage.skills.automaticInvocations ?? 0}</strong> 次</span><span className="text-muted-foreground">覆盖 {dataset.leverage.skills.coveredSessions} 个会话</span></div><div className="grid grid-cols-[minmax(130px,1fr)_80px_90px_64px] border-y py-2 text-[10px] text-muted-foreground vibe-mono"><span>SKILL</span><span className="text-right">用户指定</span><span className="text-right">自动启用</span><span className="text-right">会话</span></div>{dataset.leverage.skills.items.filter((item) => !/^\d+$/.test(item.name)).slice(0, 10).map((item) => <div key={item.name} className="grid grid-cols-[minmax(130px,1fr)_80px_90px_64px] items-center border-b py-3 text-xs"><div><strong>${item.name}</strong>{item.coUsedWith?.length ? <p className="mt-1 truncate text-[10px] text-muted-foreground">常与 {item.coUsedWith.map((co) => `$${co.name}`).join('、')} 共用</p> : null}</div><span className="text-right vibe-mono">{item.userInvocations ?? item.invocations}</span><span className="text-right vibe-mono">{item.automaticInvocations ?? 0}</span><span className="text-right vibe-mono">{item.sessions}</span></div>)}</div>
      <div><h3 className="vibe-serif text-lg">Skill 适用性</h3><div className="mt-3 border-t">{report?.skillAssessments.length ? report.skillAssessments.slice(0, 6).map((item) => <AnalysisItem key={item.name} title={`$${item.name}`} meta={item.fit === 'appropriate' ? '适合' : item.fit === 'mixed' ? '需要调整' : '证据不足'}><p>{item.observation}</p>{item.issue && <p className="mt-2 text-xs"><strong>需要关注：</strong>{item.issue}</p>}<p className="mt-2 text-xs text-[#365D8D]"><strong>建议：</strong>{item.recommendation}</p><EvidenceLinks refs={item.evidenceRefs} /></AnalysisItem>) : <p className="border-b py-5 text-xs leading-5 text-muted-foreground">生成分析后，这里会结合任务评价 Skill 是否用得合适。</p>}</div><h3 className="vibe-serif mt-7 text-lg">工具类型</h3><div className="mt-3 border-t">{dataset.leverage.tools.families.slice(0, 6).map((item) => <div key={item.family} className="grid grid-cols-[1fr_70px_70px] border-b py-3 text-xs"><strong>{item.family}</strong><span className="text-right vibe-mono">{item.calls} 次</span><span className="text-right text-muted-foreground vibe-mono">{item.tasks} 任务</span></div>)}</div></div>
    </div></section>}

    {dataset?.runtimeUsage && <section className="border-b py-9"><div className="grid gap-9 lg:grid-cols-[minmax(0,.8fr)_minmax(0,1.2fr)]">
      <div><p className="vibe-mono text-[10px] tracking-[.14em] text-muted-foreground">RUNTIME FIT</p><h2 className="vibe-serif mt-2 text-2xl">模型与推理强度</h2><p className="mt-2 text-xs leading-5 text-muted-foreground">结合任务类型、过程和结果判断配置是否合适，不把更强的模型或更高的推理强度自动当成更好。</p><div className="mt-5 grid grid-cols-2 border-y text-xs"><div className="border-r p-3"><span className="text-muted-foreground">使用模型</span><strong className="mt-1 block vibe-mono">{dataset.runtimeUsage.models.length}</strong></div><div className="p-3"><span className="text-muted-foreground">推理档位</span><strong className="mt-1 block vibe-mono">{dataset.runtimeUsage.reasoningEfforts.length}</strong></div></div></div>
      <div className="border-t">{(report?.runtimeAssessments ?? []).length ? (report?.runtimeAssessments ?? []).map((item) => <AnalysisItem key={`${item.category}-${item.target}`} title={item.target} meta={`${item.category === 'model' ? '模型' : '推理强度'} · ${item.fit === 'appropriate' ? '适合' : item.fit === 'mixed' ? '需要调整' : '证据不足'}`}><p>{item.observation}</p>{item.issue && <p className="mt-2 text-xs"><strong>需要关注：</strong>{item.issue}</p>}<p className="mt-2 text-xs"><strong>适用任务：</strong>{item.applicability}</p><p className="mt-2 text-xs text-[#365D8D]"><strong>建议：</strong>{item.recommendation}</p><EvidenceLinks refs={item.evidenceRefs} /></AnalysisItem>) : <p className="border-b py-5 text-xs leading-5 text-muted-foreground">当前记录还不足以判断模型或推理强度是否需要调整。</p>}</div>
    </div></section>}

    {report && <section className="grid border-b lg:grid-cols-2">
      <div className="py-9 lg:border-r lg:pr-9"><h2 className="vibe-serif text-2xl">上下文文档效能</h2>
        <div className="mt-4 border-y bg-primary/[.025] p-4">
          <p className="text-[10px] font-semibold tracking-wide text-muted-foreground">重点结论</p>
          <p className="mt-2 text-sm font-semibold">{contextAttention.length > 0 ? `${contextAttention.length} 类文档需要关注` : contextAssessments.length > 0 ? '暂未发现明确的文档负担' : '当前证据不足'}</p>
          <p className="mt-2 text-xs leading-5 text-muted-foreground">{contextAttention[0]?.optimization || contextAttention[0]?.observation || (contextHelpful.length > 0 ? `${contextHelpful.length} 类文档表现为有效帮助，继续保持当前边界。` : '生成更多跨项目证据后再判断是否需要调整。')}</p>
          <div className="mt-3 flex gap-5 text-[10px] vibe-mono"><span>需关注 {contextAttention.length}</span><span>有帮助 {contextHelpful.length}</span><span>证据不足 {contextAssessments.filter((item) => item.assessment === 'uncertain').length}</span></div>
        </div>
        {contextAssessments.length > 0 && <details className="border-b">
          <summary className="cursor-pointer py-4 text-xs font-semibold text-[#365D8D]">展开全部文档分析 · {contextAssessments.length} 项</summary>
          <div className="border-t">{contextAssessments.map((item) => { const source = dataset?.contextDocuments.items.find((document) => document.documentRef === item.documentRef); return <AnalysisItem key={item.documentRef} title={item.name} meta={item.assessment === 'helpful' ? '有帮助' : item.assessment === 'mixed' ? '需要权衡' : item.assessment === 'costly' ? '占用上下文较多' : '证据不足'}><p className="text-[10px] vibe-mono">项目：{source?.projects.join('、') || '来源项目未识别'}</p><p className="mt-2 text-xs">{item.observation}</p><p className="mt-2 text-xs"><strong>上下文占用：</strong>{item.tokenCost}</p>{item.optimization && <p className="mt-2 text-xs text-[#365D8D]"><strong>可以调整：</strong>{item.optimization}</p>}<EvidenceLinks refs={item.evidenceRefs} /></AnalysisItem>; })}</div>
        </details>}
      </div>
      <div className="py-9 lg:pl-9"><h2 className="vibe-serif text-2xl">Token 使用情况</h2><p className="mt-2 text-xs leading-5 text-muted-foreground">在不减少必要上下文、验证和安全信息的前提下，查找可以减少重复输入的地方。</p><div className="mt-4 grid grid-cols-2 border-y text-xs"><div className="border-r p-3"><span className="text-muted-foreground">缓存读取占比</span><strong className="mt-1 block vibe-mono">{Math.round((dataset?.tokenEfficiency?.cacheReadShare ?? 0) * 100)}%</strong></div><div className="p-3"><span className="text-muted-foreground">发生压缩的会话</span><strong className="mt-1 block vibe-mono">{dataset?.tokenEfficiency?.sessionsWithCompaction ?? 0}</strong></div></div><div className="border-t">{(report.tokenEfficiencyFindings ?? []).length ? (report.tokenEfficiencyFindings ?? []).map((item) => <AnalysisItem key={item.title} title={item.title}><p>{item.observation}</p><p className="mt-2 text-xs"><strong>如何减少重复：</strong>{item.savingMechanism}</p><p className="mt-2 text-xs"><strong>适用场景：</strong>{item.applicability}</p><EvidenceLinks refs={item.evidenceRefs} /></AnalysisItem>) : <p className="border-b py-5 text-xs text-muted-foreground">当前没有可靠、且不损害质量的 Token 改进建议。</p>}</div></div>
    </section>}

    {report && (report.skillOpportunities ?? []).length > 0 && <section className="border-b py-9"><div className="grid gap-8 lg:grid-cols-[250px_1fr]"><div><p className="vibe-mono text-[10px] tracking-[.14em] text-muted-foreground">ONLY WHEN NECESSARY</p><h2 className="vibe-serif mt-2 text-2xl">可以考虑的 Skill</h2><p className="mt-2 text-xs leading-5 text-muted-foreground">只有多次出现的情况表明 Skill 可能减少返工时才会显示。</p></div><div className="border-t">{(report.skillOpportunities ?? []).map((item) => <AnalysisItem key={`${item.type}-${item.name}`} title={item.name} meta={item.type === 'existing-skill' ? '现有 Skill' : '可创建 Skill'}><p className="text-xs"><strong>适用情况：</strong>{item.trigger}</p><p className="mt-2 text-xs">{item.evidence}</p><p className="mt-2 text-xs text-[#365D8D]"><strong>可能的帮助：</strong>{item.expectedBenefit}</p><EvidenceLinks refs={item.evidenceRefs} /></AnalysisItem>)}</div></div></section>}

    {report && <section className="flex flex-col justify-between gap-5 border-b py-9 md:flex-row md:items-center">
      <div className="max-w-2xl"><Target className="h-5 w-5 text-[#D86F4B]" /><h2 className="vibe-serif mt-3 text-2xl">查看改进追踪</h2><p className="mt-2 text-sm leading-6 text-muted-foreground">集中查看当前计划、自动观察进度和独立复盘结果。</p></div>
      <Link to="/improvements" className="shrink-0 border border-foreground px-4 py-2.5 text-sm font-semibold hover:bg-foreground hover:text-background">前往改进追踪 →</Link>
    </section>}

    <details className="mt-8 border-y">
      <summary className="cursor-pointer py-4 text-sm font-semibold">证据与模型运行记录</summary>
      <div className="grid gap-6 border-t py-6">
        <div><p className="mb-2 text-xs font-semibold text-[#365D8D]">01 · 研究：跨任务发现模式、反例与待补证据</p><AnalysisRunTrace analysisType="behavior_research" /></div>
        <div><p className="mb-2 text-xs font-semibold text-[#365D8D]">02 · 分析：主任务语义与结果证据</p><AnalysisRunTrace analysisType="session" /></div>
        <div><p className="mb-2 text-xs font-semibold text-[#365D8D]">03 · 教练建议：结合事实与实践快照形成建议</p><AnalysisRunTrace analysisType="behavior_coach" /></div>
        <div><p className="mb-2 text-xs font-semibold text-[#365D8D]">04 · 最终报告：汇总两阶段运行与输入快照</p><AnalysisRunTrace analysisType="behavior_report" /></div>
      </div>
    </details>
  </div>;
}
