import { Link } from 'react-router';
import { ChevronDown, RefreshCw, Target } from 'lucide-react';
import { BehaviorAnalysisRunTimeline } from '@/components/analysis/AnalysisRunTrace';
import { useBehaviorReport, useRunBehaviorReport } from '@/hooks/useBehaviorReport';
import { useLanguage } from '@/i18n/LanguageProvider';
import { useLocalizedGeneratedContent } from '@/hooks/useLocalizedGeneratedContent';

function parseDate(value: string): Date {
  return new Date(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value) ? `${value.replace(' ', 'T')}Z` : value);
}

function EvidenceLinks({ refs }: { refs: string[] }) {
  const { language } = useLanguage();
  const cn = language === 'zh-CN';
  if (!refs.length) return null;
  const labels: Record<string, string> = {
    'activity.windowSessions': cn ? '分析范围内的会话' : 'Sessions in scope',
    'activity.rootTasks': cn ? '主任务' : 'Root tasks',
    'activity.subagentTasks': cn ? '子 Agent 任务' : 'Sub-agent tasks',
    'activity.projectSwitchesWithinTwoHours': cn ? '两小时内发生的项目切换' : 'Project switches within two hours',
    'activity.shortFollowups': cn ? '简短补充消息' : 'Short follow-ups',
    'activity.shortFollowupRate': cn ? '简短补充消息占比' : 'Short follow-up rate',
    'coverage.semanticEnrichmentRatio': cn ? '已完成详细分析的会话占比' : 'Semantically enriched sessions',
    'leverage.skills.coveredSessions': cn ? '使用过 Skill 的会话' : 'Sessions using Skills',
    'leverage.skills.explicitInvocations': cn ? '用户指定 Skill' : 'User-invoked Skills',
    'leverage.skills.automaticInvocations': cn ? 'Agent 自动启用 Skill' : 'Agent-invoked Skills',
    'leverage.tools.totalCalls': cn ? '工具调用' : 'Tool calls',
    'promptSignals.withConstraint': cn ? '开头说明约束的会话' : 'Sessions starting with constraints',
    'promptSignals.withPath': cn ? '开头说明路径的会话' : 'Sessions starting with paths',
    'promptSignals.withSkillReference': cn ? '开头提到 Skill 的会话' : 'Sessions starting with Skill references',
    'promptSignals.withValidation': cn ? '开头提到验证的会话' : 'Sessions starting with validation',
    'tokenEfficiency.cacheReadShare': cn ? '缓存读取占输入比' : 'Cache-read share of input',
    'tokenEfficiency.sessionsWithCompaction': cn ? '发生上下文压缩的会话' : 'Sessions with compaction',
  };
  const readable = (ref: string) => {
    const [key, value] = ref.split('=', 2);
    if (labels[key]) {
      const normalized = key.endsWith('Rate') || key.endsWith('Ratio') || key.endsWith('Share')
        ? `${Math.round(Number(value) * 100)}%`
        : value;
      return `${labels[key]}：${normalized}`;
    }
    if (ref === 'leverage.skills.items') return cn ? '各 Skill 的使用明细' : 'Skill usage details';
    if (ref === 'contextDocuments.measurementNote') return cn ? '上下文文档统计说明' : 'Context-document measurements';
    if (ref.startsWith('representativeEpisodes')) return cn ? '具有代表性的会话片段' : 'Representative session episode';
    if (ref === 'activity') return cn ? '会话数量、任务层级与项目切换统计' : 'Session, task hierarchy, and project-switch statistics';
    if (ref === 'leverage.tools') return cn ? '工具调用次数与使用类型统计' : 'Tool-call and tool-family statistics';
    if (ref === 'leverage.skills') return cn ? 'Skill 使用方式与次数统计' : 'Skill invocation statistics';
    if (ref === 'promptSignals') return cn ? '任务开头提供信息的统计' : 'Task-opening signal statistics';
    if (ref === 'tokenEfficiency') return cn ? 'Token 与上下文压缩统计' : 'Token and compaction statistics';
    if (ref === 'investigatorResearch.profileThesis') return cn ? '模型对整体使用方式的归纳' : 'Model synthesis of overall usage';
    const finding = ref.match(/^investigatorResearch\.behavioralFindings\.(\d+)$/);
    if (finding) return `${cn ? '模型归纳的跨会话观察' : 'Cross-session observation'} ${Number(finding[1]) + 1}`;
    const family = ref.match(/^leverage\.tools\.families\.([^.]+)\.(calls|tasks)=(.+)$/);
    if (family) return `${family[1]}: ${family[3]} ${family[2] === 'calls' ? (cn ? '次调用' : 'calls') : (cn ? '个任务' : 'tasks')}`;
    const tool = ref.match(/^leverage\.tools\.topTools\.([^.]+)\.calls=(.+)$/);
    if (tool) return `${tool[1]}: ${tool[2]} ${cn ? '次调用' : 'calls'}`;
    const readablePath = ref.split('.').filter(Boolean).slice(-2).join(' / ');
    return readablePath ? `${cn ? '分析依据' : 'Evidence'}: ${readablePath}` : (cn ? '一项本地分析依据' : 'Local analysis evidence');
  };
  return <details className="mt-3 text-[10px] text-muted-foreground vibe-mono">
    <summary className="cursor-pointer hover:text-foreground">{cn ? '证据来源' : 'Evidence sources'} · {refs.length}</summary>
    <div className="mt-2 flex flex-wrap gap-2">{refs.slice(0, 8).map((ref, index) => ref.startsWith('codex:')
      ? <Link key={ref} to={`/sessions?session=${encodeURIComponent(ref)}`} className="border border-[#365D8D]/50 px-2 py-1 font-sans text-[#365D8D] hover:bg-[#365D8D]/10">{cn ? '查看来源会话' : 'Open source session'} {index + 1}</Link>
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

export default function ImprovePage() {
  const { language, t } = useLanguage();
  const cn = language === 'zh-CN';
  const state = useBehaviorReport();
  const run = useRunBehaviorReport();
  const dataset = state.data?.dataset;
  const localizedReport = useLocalizedGeneratedContent(state.data?.report);
  const report = localizedReport.data ?? state.data?.report;
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
  const statusLabel = cn
    ? { established: '多项证据支持', candidate: '需要继续观察', qualitative: '当前观察' }
    : { established: 'Supported by multiple signals', candidate: 'Continue observing', qualitative: 'Current observation' };
  const confidenceLabel = cn
    ? { high: '较高', medium: '中等', low: '有限' }
    : { high: 'high', medium: 'medium', low: 'limited' };
  const signalLayerLabel = cn
    ? { L0: '用量计数', L1: '结构信号', L2: '语义判断', L3: '已验证对照' }
    : { L0: 'Usage count', L1: 'Structural signal', L2: 'Semantic judgment', L3: 'Executed counterfactual' };
  const attributionLabel = cn
    ? { 'harness-waste': 'Agent 运行方式', 'capability-limit': '模型能力边界', unknown: '尚不能归因' }
    : { 'harness-waste': 'Harness waste', 'capability-limit': 'Capability limit', unknown: 'Attribution unknown' };

  const translationStatus = localizedReport.isFetching
    ? <p className="border-b py-3 text-xs text-muted-foreground">{cn ? '正在后台准备中文分析，完成后自动更新…' : 'Preparing the English analysis in the background; this page will update automatically…'}</p>
    : localizedReport.isError
      ? <div className="flex items-center justify-between gap-4 border-b border-amber-500 py-3 text-xs">
          <span>{cn ? '分析内容暂未完成中文转换。' : 'Analysis content could not be translated yet.'}</span>
          <button type="button" className="font-semibold underline" onClick={() => { void localizedReport.refetch(); }}>{cn ? '重试' : 'Retry'}</button>
        </div>
      : null;

  if (state.isLoading) {
    return <div className="vibe-page" aria-busy="true" aria-label={cn ? '正在读取跨任务分析' : 'Loading cross-task analysis'}>
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
    {translationStatus}
    <div className="flex min-h-9 flex-wrap items-center justify-between gap-3 border-y py-2 text-[10px] text-muted-foreground vibe-mono">
      <span>{reportRun ? `${cn ? '上次分析' : 'Last analysis'} · ${parseDate(reportRun.createdAt).toLocaleString(locale)}` : (cn ? '等待首次分析' : 'Waiting for first analysis')}</span>
      <span className={hasNewEvidence || state.data?.needsRegeneration ? 'text-[#C08A36]' : ''}>
        {latestAttemptFailed && report
          ? (cn ? '上次更新失败，正在显示最近一次成功结果' : 'Last update failed; showing the latest successful result')
          : state.data?.needsRegeneration
            ? (cn ? '分析方法已更新，需要重新分析' : 'Analysis method updated; run analysis again')
            : hasNewEvidence
              ? (cn ? '有新的会话记录，可以重新分析' : 'New sessions are available for analysis')
              : report ? (cn ? '已包含最新会话记录' : 'Includes the latest sessions') : (cn ? '尚无分析结果' : 'No analysis result yet')}
      </span>
    </div>

    <header className="flex flex-col justify-between gap-8 border-b border-foreground py-10 lg:flex-row lg:items-end">
      <div>
        <p className="vibe-mono flex items-center gap-3 text-[11px] tracking-[.15em] text-muted-foreground"><span className="w-6 border-t-2 border-[#4F775F]" />AGENT USAGE REVIEW</p>
        <h1 className="vibe-serif mt-5 text-4xl leading-tight sm:text-6xl">{cn ? '你的 Agent 使用方式' : 'How you use Agents'}</h1>
        <p className="mt-4 max-w-3xl text-sm leading-6 text-muted-foreground">{cn ? '从最近 30 天的会话中总结常见做法、值得保留的地方和可以改进之处。' : 'A review of recurring approaches, strengths, and improvement opportunities from the last 30 days.'}</p>
      </div>
      <button type="button" onClick={() => run.mutate()} disabled={isGenerating || state.isLoading || Boolean(state.data?.eligibilityReason)} className="flex items-center justify-center gap-2 border border-foreground px-4 py-2.5 text-sm font-semibold hover:bg-foreground hover:text-background disabled:cursor-not-allowed disabled:opacity-50">
        <RefreshCw className={`h-4 w-4 ${isGenerating ? 'animate-spin' : ''}`} />{isGenerating ? t('analysis.generating', 'Generating…') : report ? t('analysis.regenerate', 'Regenerate report') : t('analysis.generateReport', 'Generate LLM report')}
      </button>
    </header>

    <section className="grid border-b md:grid-cols-5">
      <div className="border-b py-5 md:border-b-0 md:border-r md:pr-5"><p className="vibe-mono text-[10px] text-muted-foreground">{cn ? '报告生成时间' : 'Generated'}</p><p className="mt-2 text-sm font-semibold">{reportRun ? parseDate(reportRun.createdAt).toLocaleString(locale) : '—'}</p></div>
      <div className="border-b py-5 md:border-b-0 md:border-r md:px-5"><p className="vibe-mono text-[10px] text-muted-foreground">{cn ? '数据窗口' : 'Data window'}</p><p className="mt-2 text-sm font-semibold">{reportWindow?.startsAt && reportWindow.endsAt ? `${parseDate(reportWindow.startsAt).toLocaleDateString(locale)} – ${parseDate(reportWindow.endsAt).toLocaleDateString(locale)}` : '—'}</p></div>
      <div className="border-b py-5 md:border-b-0 md:border-r md:px-5"><p className="vibe-mono text-[10px] text-muted-foreground">{cn ? '全量结构分析' : 'Structural analysis'}</p><p className="mt-2 text-sm font-semibold">{reportCoverage ? `${reportCoverage.structurallyAnalyzedSessions}/${reportCoverage.windowSessions} ${cn ? '个会话' : 'sessions'}` : '—'}</p></div>
      <div className="border-b py-5 md:border-b-0 md:border-r md:px-5"><p className="vibe-mono text-[10px] text-muted-foreground">{cn ? '可选语义增强' : 'Semantic enrichment'}</p><p className="mt-2 text-sm font-semibold">{reportCoverage ? `${reportCoverage.semanticEnrichedSessions ?? 0} ${cn ? '个会话' : 'sessions'}` : '—'}</p></div>
      <div className="py-5 md:pl-5"><p className="vibe-mono text-[10px] text-muted-foreground">{cn ? '代表性片段' : 'Representative episodes'}</p><p className="mt-2 text-sm font-semibold">{representativeSample?.count ?? dataset?.representativeSample?.count ?? dataset?.representativeEpisodes?.length ?? 0}</p></div>
    </section>
    {state.isError && <p className="border-b py-5 text-sm text-destructive">{cn ? '无法加载 Agent 使用分析。' : 'Could not load Agent usage analysis.'}</p>}
    {run.isError && <p className="border-b py-5 text-sm text-destructive">{cn ? '分析失败，请查看运行记录。' : 'Analysis failed. Review the run record.'}</p>}
    {!report && <section className="border-b py-12 text-center"><h2 className="vibe-serif text-2xl">{isGenerating ? t('analysis.generatingReport', 'Generating the cross-session LLM report…') : state.data?.needsRegeneration ? (cn ? '分析方法已更新' : 'Analysis method updated') : (cn ? '尚未生成使用分析' : 'Usage analysis has not been generated')}</h2><p className="mx-auto mt-3 max-w-2xl text-sm text-muted-foreground">{isGenerating ? (cn ? '分析正在后台运行；离开本页不会中断。' : 'Analysis is running in the background; leaving this page will not interrupt it.') : state.data?.needsRegeneration ? (cn ? '可以现在重新分析，或等待下一次自动分析。' : 'Run analysis now or wait for the next automatic analysis.') : state.data?.eligibilityReason === 'history-import-running' ? (cn ? '历史整理仍在进行中；完成后即可生成分析。' : 'History import is still running. Analysis will be available when it finishes.') : (cn && state.data?.eligibilityReason ? state.data.eligibilityReason : (cn ? '历史导入完成并具备足够会话后会自动开始首次分析。' : 'The first analysis starts automatically after history import has enough sessions.'))}</p></section>}

    {report && dataset && <>
      <section className="grid border-b py-10 lg:grid-cols-[280px_1fr] lg:gap-12">
        <div><p className="vibe-mono text-[10px] tracking-[.14em] text-[#365D8D]">CURRENT IDENTITY</p><p className="vibe-serif mt-3 text-3xl">{report.identity.title}</p><p className="mt-2 text-xs font-semibold text-[#4F775F]">{report.identity.stage}</p></div>
        <div><h2 className="vibe-serif text-3xl leading-snug">{report.headline}</h2><details className="mt-5 border-t"><summary className="cursor-pointer py-4 text-sm font-semibold">{cn ? '查看完整说明' : 'View full explanation'}</summary><div className="pb-4"><p className="text-sm leading-7 text-muted-foreground">{report.identity.rationale}</p><p className="mt-3 text-sm leading-7 text-muted-foreground">{report.summary}</p><EvidenceLinks refs={report.identity.evidenceRefs} /></div></details></div>
      </section>

      <section className="border-b py-9"><div className="mb-5"><p className="vibe-mono text-[10px] tracking-[.14em] text-muted-foreground">USAGE SUMMARY</p><h2 className="vibe-serif mt-2 text-2xl">{cn ? '主要使用特点' : 'Key usage characteristics'}</h2></div><div className="border-t">{report.portrait.map((item, index) => <AnalysisItem key={`${item.title}-${index}`} title={item.title} meta={String(index + 1).padStart(2, '0')} collapsible={false}><p>{item.finding}</p><EvidenceLinks refs={item.evidenceRefs} /></AnalysisItem>)}</div></section>

      <section className="grid border-b lg:grid-cols-2">
        <div className="py-9 lg:border-r lg:pr-9"><h2 className="vibe-serif text-2xl">{cn ? '做得好的地方' : 'What works well'}</h2><div className="mt-4 border-t">{report.strengths.map((item, index) => <AnalysisItem key={`${item.title}-${index}`} title={item.title} meta={String(index + 1).padStart(2, '0')}><p>{item.explanation}</p><p className="mt-3 border-l-2 border-[#4F775F] pl-3 text-xs leading-5"><strong>{cn ? '为什么有效：' : 'Why it works: '}</strong>{item.mechanism}</p><EvidenceLinks refs={item.evidenceRefs} /></AnalysisItem>)}</div></div>
        <div className="py-9 lg:pl-9"><h2 className="vibe-serif text-2xl">{cn ? '可以改进的地方' : 'What could improve'}</h2><div className="mt-4 border-t">{report.bottlenecks.map((item, index) => <AnalysisItem key={`${item.title}-${index}`} title={item.title} meta={String(index + 1).padStart(2, '0')}><p>{item.explanation}</p><p className="mt-3 border-l-2 border-[#D86F4B] pl-3 text-xs leading-5"><strong>{cn ? '为什么值得关注：' : 'Why it matters: '}</strong>{item.mechanism}</p>{item.counterEvidence.length > 0 && <p className="mt-2 text-xs leading-5"><strong>{cn ? '不一定适用的情况：' : 'When it may not apply: '}</strong>{item.counterEvidence.join(cn ? '；' : '; ')}</p>}<EvidenceLinks refs={item.evidenceRefs} /></AnalysisItem>)}</div></div>
      </section>

      <section className="border-b py-9"><div className="mb-5 flex flex-col justify-between gap-3 md:flex-row md:items-end"><div><p className="vibe-mono text-[10px] tracking-[.14em] text-muted-foreground">USAGE PATTERNS</p><h2 className="vibe-serif mt-2 text-2xl">{cn ? '值得关注的使用习惯' : 'Usage patterns worth watching'}</h2><p className="mt-1 max-w-3xl text-xs leading-5 text-muted-foreground">{cn ? '模型从代表性会话中归纳这些内容；证据不足时仅作为待观察事项。' : 'The model derives these patterns from representative sessions; limited evidence remains an observation, not a score.'}</p></div><span className="vibe-mono text-[10px] text-muted-foreground">{report.dimensions.length} {cn ? '项' : 'items'}</span></div><div className="border-t">{report.dimensions.map((item, index) => <AnalysisItem key={item.id} title={item.label} meta={`${String(index + 1).padStart(2, '0')} · ${statusLabel[item.status]}`}><p>{item.observation}</p><div className="mt-4 grid gap-3 border-t pt-4 text-xs leading-5"><p><strong>{cn ? '可能的帮助：' : 'Potential benefit: '}</strong>{item.benefitHypothesis}</p><p><strong>{cn ? '适用场景：' : 'Applies to: '}</strong>{item.applicability.join(cn ? '；' : '; ') || (cn ? '未限定' : 'Not specified')}</p><p><strong>{cn ? '目前的局限：' : 'Current limitations: '}</strong>{item.limitations.join(cn ? '；' : '; ') || (cn ? '未记录' : 'Not recorded')} · {cn ? '可信程度' : 'Confidence: '}{confidenceLabel[item.confidence]}</p></div><EvidenceLinks refs={item.evidenceRefs} /></AnalysisItem>)}</div></section>
    </>}

    {dataset?.leverage && <section className="border-b py-9"><div className="mb-5"><h2 className="vibe-serif text-2xl">{cn ? 'Skill 与工具使用' : 'Skill and tool usage'}</h2></div><div className="grid gap-9 lg:grid-cols-[minmax(0,1.35fr)_minmax(280px,.9fr)]">
      <div><div className="mb-3 flex flex-wrap gap-4 text-xs"><span>{cn ? '用户指定' : 'User-invoked'} <strong>{dataset.leverage.skills.explicitInvocations ?? 0}</strong></span><span>{cn ? 'Agent 自动启用' : 'Agent-invoked'} <strong>{dataset.leverage.skills.automaticInvocations ?? 0}</strong></span><span className="text-muted-foreground">{cn ? '覆盖' : 'Across'} {dataset.leverage.skills.coveredSessions} {cn ? '个会话' : 'sessions'}</span></div><div className="grid grid-cols-[minmax(130px,1fr)_80px_90px_64px] border-y py-2 text-[10px] text-muted-foreground vibe-mono"><span>SKILL</span><span className="text-right">{cn ? '用户指定' : 'USER'}</span><span className="text-right">{cn ? '自动启用' : 'AGENT'}</span><span className="text-right">{cn ? '会话' : 'SESSIONS'}</span></div>{dataset.leverage.skills.items.filter((item) => !/^\d+$/.test(item.name)).slice(0, 10).map((item) => <div key={item.name} className="grid grid-cols-[minmax(130px,1fr)_80px_90px_64px] items-center border-b py-3 text-xs"><div><strong>${item.name}</strong>{item.coUsedWith?.length ? <p className="mt-1 truncate text-[10px] text-muted-foreground">{cn ? '常与' : 'Often with'} {item.coUsedWith.map((co) => `$${co.name}`).join(cn ? '、' : ', ')}</p> : null}</div><span className="text-right vibe-mono">{item.userInvocations ?? item.invocations}</span><span className="text-right vibe-mono">{item.automaticInvocations ?? 0}</span><span className="text-right vibe-mono">{item.sessions}</span></div>)}</div>
      <div><h3 className="vibe-serif text-lg">{cn ? 'Skill 适用性' : 'Skill fit'}</h3><div className="mt-3 border-t">{report?.skillAssessments.length ? report.skillAssessments.slice(0, 6).map((item) => <AnalysisItem key={item.name} title={`$${item.name}`} meta={item.fit === 'appropriate' ? (cn ? '适合' : 'Appropriate') : item.fit === 'mixed' ? (cn ? '需要调整' : 'Needs adjustment') : (cn ? '证据不足' : 'Limited evidence')}><p>{item.observation}</p>{item.issue && <p className="mt-2 text-xs"><strong>{cn ? '需要关注：' : 'Watch: '}</strong>{item.issue}</p>}<p className="mt-2 text-xs text-[#365D8D]"><strong>{cn ? '建议：' : 'Recommendation: '}</strong>{item.recommendation}</p><EvidenceLinks refs={item.evidenceRefs} /></AnalysisItem>) : <p className="border-b py-5 text-xs leading-5 text-muted-foreground">{cn ? '生成分析后，这里会结合任务评价 Skill 是否用得合适。' : 'After analysis, this section evaluates whether each Skill fits its tasks.'}</p>}</div><h3 className="vibe-serif mt-7 text-lg">{cn ? '工具类型' : 'Tool families'}</h3><div className="mt-3 border-t">{dataset.leverage.tools.families.slice(0, 6).map((item) => <div key={item.family} className="grid grid-cols-[1fr_70px_70px] border-b py-3 text-xs"><strong>{item.family}</strong><span className="text-right vibe-mono">{item.calls} {cn ? '次' : 'calls'}</span><span className="text-right text-muted-foreground vibe-mono">{item.tasks} {cn ? '任务' : 'tasks'}</span></div>)}</div></div>
    </div></section>}

    {dataset?.runtimeUsage && <section className="border-b py-9"><div className="grid gap-9 lg:grid-cols-[minmax(0,.8fr)_minmax(0,1.2fr)]">
      <div><p className="vibe-mono text-[10px] tracking-[.14em] text-muted-foreground">RUNTIME FIT</p><h2 className="vibe-serif mt-2 text-2xl">{cn ? '模型与推理强度' : 'Model and reasoning fit'}</h2><p className="mt-2 text-xs leading-5 text-muted-foreground">{cn ? '结合任务类型、过程和结果判断配置是否合适，不把更强的模型或更高的推理强度自动当成更好。' : 'Judge configuration fit from task type, process, and outcome rather than assuming stronger models or more reasoning are always better.'}</p><div className="mt-5 grid grid-cols-2 border-y text-xs"><div className="border-r p-3"><span className="text-muted-foreground">{cn ? '使用模型' : 'Models used'}</span><strong className="mt-1 block vibe-mono">{dataset.runtimeUsage.models.length}</strong></div><div className="p-3"><span className="text-muted-foreground">{cn ? '推理档位' : 'Reasoning levels'}</span><strong className="mt-1 block vibe-mono">{dataset.runtimeUsage.reasoningEfforts.length}</strong></div></div></div>
      <div className="border-t">{(report?.runtimeAssessments ?? []).length ? (report?.runtimeAssessments ?? []).map((item) => <AnalysisItem key={`${item.category}-${item.target}`} title={item.target} meta={`${item.category === 'model' ? (cn ? '模型' : 'Model') : (cn ? '推理强度' : 'Reasoning')} · ${item.fit === 'appropriate' ? (cn ? '适合' : 'Appropriate') : item.fit === 'mixed' ? (cn ? '需要调整' : 'Needs adjustment') : (cn ? '证据不足' : 'Limited evidence')}`}><p>{item.observation}</p>{item.issue && <p className="mt-2 text-xs"><strong>{cn ? '需要关注：' : 'Watch: '}</strong>{item.issue}</p>}<p className="mt-2 text-xs"><strong>{cn ? '适用任务：' : 'Applies to: '}</strong>{item.applicability}</p><p className="mt-2 text-xs text-[#365D8D]"><strong>{cn ? '建议：' : 'Recommendation: '}</strong>{item.recommendation}</p><EvidenceLinks refs={item.evidenceRefs} /></AnalysisItem>) : <p className="border-b py-5 text-xs leading-5 text-muted-foreground">{cn ? '当前记录还不足以判断模型或推理强度是否需要调整。' : 'There is not yet enough evidence to judge model or reasoning changes.'}</p>}</div>
    </div></section>}

    {report && <section className="grid border-b lg:grid-cols-2">
      <div className="py-9 lg:border-r lg:pr-9"><h2 className="vibe-serif text-2xl">{cn ? '上下文文档效能' : 'Context-document effectiveness'}</h2>
        <div className="mt-4 border-y bg-primary/[.025] p-4">
          <p className="text-[10px] font-semibold tracking-wide text-muted-foreground">{cn ? '重点结论' : 'KEY FINDING'}</p>
          <p className="mt-2 text-sm font-semibold">{contextAttention.length > 0 ? `${contextAttention.length} ${cn ? '类文档需要关注' : 'document types need attention'}` : contextAssessments.length > 0 ? (cn ? '暂未发现明确的文档负担' : 'No clear document burden found') : (cn ? '当前证据不足' : 'Limited evidence')}</p>
          <p className="mt-2 text-xs leading-5 text-muted-foreground">{contextAttention[0]?.optimization || contextAttention[0]?.observation || (contextHelpful.length > 0 ? `${contextHelpful.length} ${cn ? '类文档表现为有效帮助，继续保持当前边界。' : 'document types appear helpful; keep their current scope.'}` : (cn ? '生成更多跨项目证据后再判断是否需要调整。' : 'Collect more cross-project evidence before changing them.'))}</p>
          <div className="mt-3 flex gap-5 text-[10px] vibe-mono"><span>{cn ? '需关注' : 'WATCH'} {contextAttention.length}</span><span>{cn ? '有帮助' : 'HELPFUL'} {contextHelpful.length}</span><span>{cn ? '证据不足' : 'LIMITED'} {contextAssessments.filter((item) => item.assessment === 'uncertain').length}</span></div>
        </div>
        {contextAssessments.length > 0 && <details className="border-b">
          <summary className="cursor-pointer py-4 text-xs font-semibold text-[#365D8D]">{cn ? '展开全部文档分析' : 'Show all document analyses'} · {contextAssessments.length}</summary>
          <div className="border-t">{contextAssessments.map((item) => { const source = dataset?.contextDocuments.items.find((document) => document.documentRef === item.documentRef); return <AnalysisItem key={item.documentRef} title={item.name} meta={item.assessment === 'helpful' ? (cn ? '有帮助' : 'Helpful') : item.assessment === 'mixed' ? (cn ? '需要权衡' : 'Mixed') : item.assessment === 'costly' ? (cn ? '占用上下文较多' : 'Context-heavy') : (cn ? '证据不足' : 'Limited evidence')}><p className="text-[10px] vibe-mono">{cn ? '项目：' : 'Projects: '}{source?.projects.join(cn ? '、' : ', ') || (cn ? '来源项目未识别' : 'Unknown')}</p><p className="mt-2 text-xs">{item.observation}</p><p className="mt-2 text-xs"><strong>{cn ? '上下文占用：' : 'Context cost: '}</strong>{item.tokenCost}</p>{item.optimization && <p className="mt-2 text-xs text-[#365D8D]"><strong>{cn ? '可以调整：' : 'Adjustment: '}</strong>{item.optimization}</p>}<EvidenceLinks refs={item.evidenceRefs} /></AnalysisItem>; })}</div>
        </details>}
      </div>
      <div className="py-9 lg:pl-9"><h2 className="vibe-serif text-2xl">{cn ? 'Token 使用情况' : 'Token usage'}</h2><p className="mt-2 text-xs leading-5 text-muted-foreground">{cn ? '在保留必要上下文、验证和安全信息的前提下，查找可以减少重复输入的地方。' : 'Find repeated input that can be reduced while preserving necessary context, validation, and safety information.'}</p><div className="mt-4 grid grid-cols-2 border-y text-xs"><div className="border-r p-3"><span className="text-muted-foreground">{cn ? '缓存读取占输入比' : 'Cache-read share of input'}</span><strong className="mt-1 block vibe-mono">{Math.round((dataset?.tokenEfficiency?.cacheReadShare ?? 0) * 100)}%</strong></div><div className="p-3"><span className="text-muted-foreground">{cn ? '发生压缩的会话' : 'Compacted sessions'}</span><strong className="mt-1 block vibe-mono">{dataset?.tokenEfficiency?.sessionsWithCompaction ?? 0}</strong></div></div><div className="border-t">{(report.tokenEfficiencyFindings ?? []).length ? (report.tokenEfficiencyFindings ?? []).map((item) => <AnalysisItem key={item.title} title={item.title} meta={item.signalLayer ? signalLayerLabel[item.signalLayer] : undefined}><p>{item.observation}</p>{item.attribution && <p className="mt-2 text-xs"><strong>{cn ? '当前归因：' : 'Current attribution: '}</strong>{attributionLabel[item.attribution]}{item.confidence ? ` · ${cn ? '可信程度' : 'confidence'} ${confidenceLabel[item.confidence]}` : ''}</p>}<p className="mt-2 text-xs"><strong>{cn ? '如何减少重复：' : 'Reduce repetition: '}</strong>{item.savingMechanism}</p><p className="mt-2 text-xs"><strong>{cn ? '适用场景：' : 'Applies to: '}</strong>{item.applicability}</p><EvidenceLinks refs={item.evidenceRefs} /></AnalysisItem>) : <p className="border-b py-5 text-xs text-muted-foreground">{cn ? '当前没有可靠、且不损害质量的 Token 改进建议。' : 'No reliable token-saving recommendation is available without risking quality.'}</p>}</div></div>
    </section>}

    {report && (report.skillOpportunities ?? []).length > 0 && <section className="border-b py-9"><div className="grid gap-8 lg:grid-cols-[250px_1fr]"><div><p className="vibe-mono text-[10px] tracking-[.14em] text-muted-foreground">ONLY WHEN NECESSARY</p><h2 className="vibe-serif mt-2 text-2xl">{cn ? '可以考虑的 Skill' : 'Skills to consider'}</h2><p className="mt-2 text-xs leading-5 text-muted-foreground">{cn ? '只有反复出现的任务表明 Skill 可能减少返工时才会显示。' : 'Shown only when recurring work indicates a Skill may reduce rework.'}</p></div><div className="border-t">{(report.skillOpportunities ?? []).map((item) => <AnalysisItem key={`${item.type}-${item.name}`} title={item.name} meta={item.type === 'existing-skill' ? (cn ? '现有 Skill' : 'Existing Skill') : (cn ? '可创建 Skill' : 'Potential Skill')}><p className="text-xs"><strong>{cn ? '适用情况：' : 'Trigger: '}</strong>{item.trigger}</p><p className="mt-2 text-xs">{item.evidence}</p><p className="mt-2 text-xs text-[#365D8D]"><strong>{cn ? '可能的帮助：' : 'Potential benefit: '}</strong>{item.expectedBenefit}</p><EvidenceLinks refs={item.evidenceRefs} /></AnalysisItem>)}</div></div></section>}

    {report && <section className="flex flex-col justify-between gap-5 border-b py-9 md:flex-row md:items-center">
      <div className="max-w-2xl"><Target className="h-5 w-5 text-[#D86F4B]" /><h2 className="vibe-serif mt-3 text-2xl">{cn ? '查看改进追踪' : 'Open improvement tracking'}</h2><p className="mt-2 text-sm leading-6 text-muted-foreground">{cn ? '查看当前计划、自动观察进度和复盘结果。' : 'Review current plans, observation progress, and outcomes.'}</p></div>
      <Link to="/improvements" className="shrink-0 border border-foreground px-4 py-2.5 text-sm font-semibold hover:bg-foreground hover:text-background">{cn ? '前往改进追踪' : 'Go to improvement tracking'} →</Link>
    </section>}

    <details className="mt-8 border-y">
      <summary className="cursor-pointer py-4 text-sm font-semibold">{cn ? '证据与模型运行记录' : 'Evidence and model run records'}</summary>
      <div className="border-t py-6"><BehaviorAnalysisRunTimeline running={isGenerating} /></div>
    </details>
  </div>;
}
