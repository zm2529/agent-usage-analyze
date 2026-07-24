import { Link } from 'react-router';
import { FlaskConical, RefreshCw, Target } from 'lucide-react';
import { AnalysisRunTrace } from '@/components/analysis/AnalysisRunTrace';
import { useBehaviorReport, useRunBehaviorReport } from '@/hooks/useBehaviorReport';
import { useLanguage } from '@/i18n/LanguageProvider';

function parseDate(value: string): Date {
  return new Date(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value) ? `${value.replace(' ', 'T')}Z` : value);
}

function EvidenceLinks({ refs }: { refs: string[] }) {
  if (!refs.length) return null;
  return <details className="mt-3 text-[10px] text-muted-foreground vibe-mono">
    <summary className="cursor-pointer hover:text-foreground">证据来源 · {refs.length} 项</summary>
    <div className="mt-2 flex flex-wrap gap-2">{refs.slice(0, 8).map((ref) => ref.startsWith('codex:')
      ? <Link key={ref} to={`/sessions?session=${encodeURIComponent(ref)}`} className="border-b border-[#365D8D] text-[#365D8D]">打开来源会话</Link>
      : <span key={ref}>{ref}</span>)}</div>
  </details>;
}

const statusLabel = { established: '多源支持', candidate: '待实验验证', qualitative: '定性观察' } as const;
const confidenceLabel = { high: '较高', medium: '中等', low: '有限' } as const;

export default function ImprovePage() {
  const { language, t } = useLanguage();
  const state = useBehaviorReport();
  const run = useRunBehaviorReport();
  const dataset = state.data?.dataset;
  const report = state.data?.report;
  const isGenerating = run.isPending || state.data?.generation?.running === true;
  const reportRun = state.data?.run?.status === 'completed' && report ? state.data.run : null;
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
  const automation = state.data?.automation;
  const contextAssessments = report?.contextDocumentAssessments ?? [];
  const contextAttention = contextAssessments.filter((item) => item.assessment === 'mixed' || item.assessment === 'costly');
  const contextHelpful = contextAssessments.filter((item) => item.assessment === 'helpful');

  return <div className="vibe-page">
    <div className="flex min-h-9 flex-wrap items-center justify-between gap-3 border-y py-2 text-[10px] text-muted-foreground vibe-mono">
      <span>{reportRun ? `PROFILE · ${parseDate(reportRun.createdAt).toLocaleString(locale)} · ${reportRun.promptVersion}` : 'PROFILE · 等待生成'}</span>
      <span className={hasNewEvidence || state.data?.needsRegeneration ? 'text-[#C08A36]' : ''}>
        {state.data?.needsRegeneration ? '分析方法已升级，等待手动生成或下次自动生成' : hasNewEvidence ? '报告后有新会话证据，等待重新分析' : report ? '当前画像已覆盖最新稳定证据' : '尚无可展示画像'}
      </span>
    </div>

    <header className="flex flex-col justify-between gap-8 border-b border-foreground py-10 lg:flex-row lg:items-end">
      <div>
        <p className="vibe-mono flex items-center gap-3 text-[11px] tracking-[.15em] text-muted-foreground"><span className="w-6 border-t-2 border-[#4F775F]" />PERSONAL ENGINEERING PROFILE</p>
        <h1 className="vibe-serif mt-5 text-4xl leading-tight sm:text-6xl">个人工程画像<br />与发展方案</h1>
        <p className="mt-4 max-w-3xl text-sm leading-6 text-muted-foreground">模型先读取最近 30 天全部可结构分析会话，再从不同项目和任务长度中选择代表片段；已有单会话分析只增加语义细节，不决定报告能否生成。维度不是统一写死的评分项，每个判断都说明适用场景、证据局限和预期收益。</p>
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
    <p className="border-b py-3 text-xs leading-5 text-muted-foreground">
      <strong className="text-foreground">自动生成时机：</strong>Codex 的首次提示与停止事件会登记会话；本地服务同时监听会话文件变化作为补偿，等待写入稳定后完成导入。只有出现新稳定证据、报告样本满足条件且距上次尝试已满 24 小时，才在后台自动生成，24 小时内最多尝试一次。当前状态：
      <span className="ml-1 text-foreground">{automation?.reason === 'up-to-date' ? '已覆盖最新证据' : automation?.reason === 'cooldown' ? `冷却中${automation.nextEligibleAt ? `，最早 ${parseDate(automation.nextEligibleAt).toLocaleString(locale)}` : ''}` : automation?.reason === 'due' ? '下一次 Hook 稳定后可生成' : automation?.reason === 'disabled' ? '已关闭' : '样本尚不足'}</span>。
    </p>

    {state.isError && <p className="border-b py-5 text-sm text-destructive">无法加载个人工程画像。</p>}
    {run.isError && <p className="border-b py-5 text-sm text-destructive">画像生成失败，请在页面底部查看运行记录。</p>}
    {!report && <section className="border-b py-12 text-center"><h2 className="vibe-serif text-2xl">{isGenerating ? t('analysis.generatingReport', 'Generating the cross-session LLM report…') : state.data?.needsRegeneration ? '分析方法已升级' : '尚未生成个人工程画像'}</h2><p className="mx-auto mt-3 max-w-2xl text-sm text-muted-foreground">{isGenerating ? `任务已在后台持续运行${state.data?.generation?.startedAt ? `，开始于 ${parseDate(state.data.generation.startedAt).toLocaleString(locale)}` : ''}；离开本页不会中断。` : state.data?.needsRegeneration ? '现有旧版报告不会冒充新分析结果。你可以立即手动生成，或等待满足 24 小时条件后的下一次自动生成。' : (state.data?.eligibilityReason ?? '最近 30 天具备至少 10 个可结构分析会话后即可生成。')}</p></section>}

    {report && <>
      <section className="grid border-b py-10 lg:grid-cols-[280px_1fr] lg:gap-12">
        <div><p className="vibe-mono text-[10px] tracking-[.14em] text-[#365D8D]">CURRENT IDENTITY</p><p className="vibe-serif mt-3 text-3xl">{report.identity.title}</p><p className="mt-2 text-xs font-semibold text-[#4F775F]">{report.identity.stage}</p></div>
        <div><h2 className="vibe-serif text-3xl leading-snug">{report.headline}</h2><p className="mt-4 text-sm leading-7 text-muted-foreground">{report.identity.rationale}</p><p className="mt-3 text-sm leading-7 text-muted-foreground">{report.summary}</p><EvidenceLinks refs={report.identity.evidenceRefs} /></div>
      </section>

      <section className="border-b py-9"><div className="mb-5"><p className="vibe-mono text-[10px] tracking-[.14em] text-muted-foreground">BEHAVIORAL PORTRAIT</p><h2 className="vibe-serif mt-2 text-2xl">真实使用画像</h2></div><div className="grid border-t md:grid-cols-2">{report.portrait.map((item, index) => <article key={`${item.title}-${index}`} className="border-b py-5 md:odd:border-r md:odd:pr-7 md:even:pl-7"><span className="vibe-mono text-[10px] text-muted-foreground">{String(index + 1).padStart(2, '0')}</span><h3 className="mt-2 text-sm font-semibold">{item.title}</h3><p className="mt-2 text-sm leading-6 text-muted-foreground">{item.finding}</p><EvidenceLinks refs={item.evidenceRefs} /></article>)}</div></section>

      <section className="grid border-b lg:grid-cols-2">
        <div className="py-9 lg:border-r lg:pr-9"><h2 className="vibe-serif text-2xl">高杠杆能力</h2><div className="mt-4 border-t">{report.strengths.map((item, index) => <article key={`${item.title}-${index}`} className="border-b py-5"><h3 className="text-sm font-semibold">{String(index + 1).padStart(2, '0')} · {item.title}</h3><p className="mt-2 text-sm leading-6 text-muted-foreground">{item.explanation}</p><p className="mt-3 border-l-2 border-[#4F775F] pl-3 text-xs leading-5"><strong>形成机制：</strong>{item.mechanism}</p><EvidenceLinks refs={item.evidenceRefs} /></article>)}</div></div>
        <div className="py-9 lg:pl-9"><h2 className="vibe-serif text-2xl">当前限制因素</h2><div className="mt-4 border-t">{report.bottlenecks.map((item, index) => <article key={`${item.title}-${index}`} className="border-b py-5"><h3 className="text-sm font-semibold">{String(index + 1).padStart(2, '0')} · {item.title}</h3><p className="mt-2 text-sm leading-6 text-muted-foreground">{item.explanation}</p><p className="mt-3 border-l-2 border-[#D86F4B] pl-3 text-xs leading-5"><strong>作用机制：</strong>{item.mechanism}</p>{item.counterEvidence.length > 0 && <p className="mt-2 text-xs leading-5 text-muted-foreground"><strong>反例/边界：</strong>{item.counterEvidence.join('；')}</p>}<EvidenceLinks refs={item.evidenceRefs} /></article>)}</div></div>
      </section>

      <section className="border-b py-9"><div className="mb-5 flex flex-col justify-between gap-3 md:flex-row md:items-end"><div><p className="vibe-mono text-[10px] tracking-[.14em] text-muted-foreground">DISCOVERED DIMENSIONS</p><h2 className="vibe-serif mt-2 text-2xl">动态行为维度</h2><p className="mt-1 max-w-3xl text-xs leading-5 text-muted-foreground">由本次 LLM 从代表性片段中发现，不是全体用户共用的量表。只有观察结果符合收益假设，才把变化解释为有益。</p></div><span className="vibe-mono text-[10px] text-muted-foreground">{report.dimensions.length} DIMENSIONS</span></div><div className="grid border-t lg:grid-cols-2">{report.dimensions.map((item, index) => <article key={item.id} className="border-b py-6 lg:odd:border-r lg:odd:pr-8 lg:even:pl-8"><div className="flex items-start justify-between gap-5"><div><span className="vibe-mono text-[10px] text-[#365D8D]">DIMENSION {String(index + 1).padStart(2, '0')}</span><h3 className="mt-2 text-base font-semibold">{item.label}</h3></div><span className="shrink-0 border px-2 py-1 text-[10px] vibe-mono">{statusLabel[item.status]}</span></div><p className="mt-3 text-sm leading-6 text-muted-foreground">{item.observation}</p><div className="mt-4 grid gap-3 border-t pt-4 text-xs leading-5"><p><strong>预期收益：</strong>{item.benefitHypothesis}</p><p><strong>适用场景：</strong>{item.applicability.join('；') || '未限定'}</p><p className="text-muted-foreground"><strong>证据局限：</strong>{item.limitations.join('；') || '未记录'} · 置信度{confidenceLabel[item.confidence]}</p></div><EvidenceLinks refs={item.evidenceRefs} /></article>)}</div></section>
    </>}

    {dataset?.leverage && <section className="border-b py-9"><div className="mb-5"><h2 className="vibe-serif text-2xl">Skill 与工具使用画像</h2><p className="mt-1 text-xs text-muted-foreground">使用次数、覆盖会话和四周趋势是本地统计；是否选择得当、是否造成额外开销由 LLM 结合任务情境评估。</p></div><div className="grid gap-9 lg:grid-cols-[minmax(0,1.35fr)_minmax(280px,.9fr)]">
      <div><div className="grid grid-cols-[minmax(130px,1fr)_64px_64px_140px] border-y py-2 text-[10px] text-muted-foreground vibe-mono"><span>SKILL</span><span className="text-right">调用</span><span className="text-right">会话</span><span className="text-right">四周趋势</span></div>{dataset.leverage.skills.items.filter((item) => !/^\d+$/.test(item.name)).slice(0, 10).map((item) => { const weekly = item.weeklyInvocations ?? [0, 0, 0, 0]; const peak = Math.max(1, ...weekly); return <div key={item.name} className="grid grid-cols-[minmax(130px,1fr)_64px_64px_140px] items-center border-b py-3 text-xs"><div><strong>${item.name}</strong>{item.coUsedWith?.length ? <p className="mt-1 truncate text-[10px] text-muted-foreground">常与 {item.coUsedWith.map((co) => `$${co.name}`).join('、')} 共用</p> : null}</div><span className="text-right vibe-mono">{item.invocations}</span><span className="text-right vibe-mono">{item.sessions}</span><div aria-label="四周趋势" className="ml-auto flex h-7 w-28 items-end justify-end gap-1">{weekly.map((count, week) => <span key={week} title={`第 ${week + 1} 周：${count} 次`} className="w-5 bg-[#4F775F]/80" style={{ height: `${Math.max(2, (count / peak) * 100)}%` }} />)}</div></div>; })}</div>
      <div><h3 className="vibe-serif text-lg">情境评估</h3><div className="mt-3 border-t">{report?.skillAssessments.length ? report.skillAssessments.slice(0, 6).map((item) => <article key={item.name} className="border-b py-4"><div className="flex justify-between gap-3"><strong className="text-xs">${item.name}</strong><span className="vibe-mono text-[10px] text-muted-foreground">{item.fit === 'appropriate' ? '匹配' : item.fit === 'mixed' ? '混合' : '证据不足'}</span></div><p className="mt-2 text-xs leading-5 text-muted-foreground">{item.observation}</p>{item.issue && <p className="mt-2 text-xs">问题：{item.issue}</p>}<p className="mt-2 text-xs text-[#365D8D]">建议：{item.recommendation}</p><EvidenceLinks refs={item.evidenceRefs} /></article>) : <p className="border-b py-5 text-xs leading-5 text-muted-foreground">生成画像后，这里会评估 Skill 选择是否匹配任务、是否重复编排，以及怎样形成更稳定的用法。</p>}</div><h3 className="vibe-serif mt-7 text-lg">工具族活动</h3><div className="mt-3 border-t">{dataset.leverage.tools.families.slice(0, 6).map((item) => <div key={item.family} className="grid grid-cols-[1fr_70px_70px] border-b py-3 text-xs"><strong>{item.family}</strong><span className="text-right vibe-mono">{item.calls} 次</span><span className="text-right text-muted-foreground vibe-mono">{item.tasks} 任务</span></div>)}</div></div>
    </div></section>}

    {report && <section className="grid border-b lg:grid-cols-2">
      <div className="py-9 lg:border-r lg:pr-9"><h2 className="vibe-serif text-2xl">上下文文档效能</h2><p className="mt-2 text-xs leading-5 text-muted-foreground">扫描 AGENTS.md、CLAUDE.md、CODEX.md 与工程级指令文件；模型只接收体量、指令密度、覆盖范围和行为统计，不接收正文，也不把相关性当因果。</p>
        <div className="mt-4 border-y bg-primary/[.025] p-4">
          <p className="text-[10px] font-semibold tracking-wide text-muted-foreground">重点结论</p>
          <p className="mt-2 text-sm font-semibold">{contextAttention.length > 0 ? `${contextAttention.length} 类文档需要关注` : contextAssessments.length > 0 ? '暂未发现明确的文档负担' : '当前证据不足'}</p>
          <p className="mt-2 text-xs leading-5 text-muted-foreground">{contextAttention[0]?.optimization || contextAttention[0]?.observation || (contextHelpful.length > 0 ? `${contextHelpful.length} 类文档表现为有效帮助，继续保持当前边界。` : '生成更多跨项目证据后再判断是否需要调整。')}</p>
          <div className="mt-3 flex gap-5 text-[10px] vibe-mono"><span>需关注 {contextAttention.length}</span><span>有帮助 {contextHelpful.length}</span><span>证据不足 {contextAssessments.filter((item) => item.assessment === 'uncertain').length}</span></div>
        </div>
        <details className="border-b">
          <summary className="cursor-pointer py-4 text-xs font-semibold text-[#365D8D]">展开全部文档分析 · {contextAssessments.length} 项</summary>
          <div className="border-t">{contextAssessments.length ? contextAssessments.map((item) => { const source = dataset?.contextDocuments.items.find((document) => document.documentRef === item.documentRef); return <article key={item.documentRef} className="border-b py-5"><div className="flex items-start justify-between gap-3"><div><h3 className="text-sm font-semibold">{item.name}</h3><p className="mt-1 text-[10px] text-muted-foreground vibe-mono">项目：{source?.projects.join('、') || '来源项目未识别'}</p></div><span className="vibe-mono text-[10px] text-muted-foreground">{item.assessment === 'helpful' ? '有帮助' : item.assessment === 'mixed' ? '利弊并存' : item.assessment === 'costly' ? '上下文成本偏高' : '证据不足'}</span></div><p className="mt-2 text-xs leading-5 text-muted-foreground">{item.observation}</p><p className="mt-2 text-xs"><strong>上下文成本：</strong>{item.tokenCost}</p>{item.optimization && <p className="mt-2 text-xs text-[#365D8D]"><strong>可优化：</strong>{item.optimization}</p>}<EvidenceLinks refs={item.evidenceRefs} /></article>; }) : <p className="py-5 text-xs text-muted-foreground">没有足够证据支持文档优化建议。</p>}</div>
        </details>
      </div>
      <div className="py-9 lg:pl-9"><h2 className="vibe-serif text-2xl">Token 使用效率</h2><p className="mt-2 text-xs leading-5 text-muted-foreground">目标是在不牺牲必要上下文、验证和安全边界的前提下减少重复输入；Token 变少本身不等于质量提升。</p><div className="mt-4 grid grid-cols-2 border-y text-xs"><div className="border-r p-3"><span className="text-muted-foreground">缓存读取占比</span><strong className="mt-1 block vibe-mono">{Math.round((dataset?.tokenEfficiency?.cacheReadShare ?? 0) * 100)}%</strong></div><div className="p-3"><span className="text-muted-foreground">发生压缩的会话</span><strong className="mt-1 block vibe-mono">{dataset?.tokenEfficiency?.sessionsWithCompaction ?? 0}</strong></div></div><div className="border-t">{(report.tokenEfficiencyFindings ?? []).length ? (report.tokenEfficiencyFindings ?? []).map((item) => <article key={item.title} className="border-b py-5"><h3 className="text-sm font-semibold">{item.title}</h3><p className="mt-2 text-xs leading-5 text-muted-foreground">{item.observation}</p><p className="mt-2 text-xs"><strong>节省机制：</strong>{item.savingMechanism}</p><p className="mt-2 text-xs"><strong>适用场景：</strong>{item.applicability}</p><EvidenceLinks refs={item.evidenceRefs} /></article>) : <p className="border-b py-5 text-xs text-muted-foreground">当前没有可靠、且不损害质量的 Token 优化建议。</p>}</div></div>
    </section>}

    {report && (report.skillOpportunities ?? []).length > 0 && <section className="border-b py-9"><div className="grid gap-8 lg:grid-cols-[250px_1fr]"><div><p className="vibe-mono text-[10px] tracking-[.14em] text-muted-foreground">ONLY WHEN NECESSARY</p><h2 className="vibe-serif mt-2 text-2xl">Skill 机会</h2><p className="mt-2 text-xs leading-5 text-muted-foreground">只有重复证据表明确实能减少返工或稳定流程时才显示；不为了凑建议而推荐。</p></div><div className="grid border-t md:grid-cols-2">{(report.skillOpportunities ?? []).map((item) => <article key={`${item.type}-${item.name}`} className="border-b py-5 md:odd:border-r md:odd:pr-7 md:even:pl-7"><div className="flex justify-between gap-3"><h3 className="text-sm font-semibold">{item.name}</h3><span className="vibe-mono text-[10px] text-muted-foreground">{item.type === 'existing-skill' ? '现有 Skill' : '可创建 Skill'} · {item.necessity === 'high' ? '必要性高' : '必要性中'}</span></div><p className="mt-3 text-xs"><strong>触发场景：</strong>{item.trigger}</p><p className="mt-2 text-xs leading-5 text-muted-foreground">{item.evidence}</p><p className="mt-2 text-xs text-[#365D8D]"><strong>预期收益：</strong>{item.expectedBenefit}</p><EvidenceLinks refs={item.evidenceRefs} /></article>)}</div></div></section>}

    {report && <section className="border-b py-9"><div className="grid gap-8 lg:grid-cols-[250px_1fr]"><div><Target className="h-5 w-5 text-[#D86F4B]" /><p className="vibe-mono mt-4 text-[10px] tracking-[.14em] text-muted-foreground">LONG-TERM GUIDANCE / 使用建议</p><h2 className="vibe-serif mt-2 text-2xl">下一阶段工作方式</h2><p className="mt-3 text-sm leading-6 text-muted-foreground">{report.developmentPlan.northStar}</p><div className="mt-5 border-t">{report.developmentPlan.operatingRules.map((rule, index) => <p key={rule} className="border-b py-3 text-xs leading-5"><span className="mr-2 text-muted-foreground vibe-mono">{String(index + 1).padStart(2, '0')}</span>{rule}</p>)}</div></div><div><div className="mb-4 flex items-center gap-2"><FlaskConical className="h-4 w-4 text-[#365D8D]" /><h2 className="vibe-serif text-2xl">建议验证计划</h2></div><div className="grid auto-rows-fr border-t md:grid-cols-2">{report.developmentPlan.experiments.map((item, index) => <article key={`${item.title}-${index}`} className="flex h-full flex-col border-b py-5 md:odd:border-r md:odd:pr-7 md:even:pl-7"><span className="vibe-mono text-[10px] text-[#D86F4B]">建议 {String(index + 1).padStart(2, '0')}</span><h3 className="mt-3 text-sm font-semibold">{item.title}</h3><p className="mt-2 text-xs leading-5 text-muted-foreground">{item.hypothesis}</p><div className="mt-4 flex-1 space-y-2 border-t pt-3 text-xs leading-5"><p><strong>适用任务：</strong>{item.eligibleCohort}</p><p><strong>观察结果：</strong>{item.observableOutcome}</p><p><strong>保护条件：</strong>{item.guardrail}</p><p><strong>复盘时间：</strong>{item.reviewAfter}</p></div><EvidenceLinks refs={item.evidenceRefs} /></article>)}</div></div></div><div className="mt-9 grid gap-5 border-t pt-7 lg:grid-cols-[250px_1fr]"><div><p className="vibe-mono text-[10px] tracking-[.14em] text-muted-foreground">REUSABLE TASK CONTRACT</p><h3 className="vibe-serif mt-2 text-xl">下一项复杂任务模板</h3></div><pre className="overflow-x-auto border bg-primary/[.025] p-5 text-xs leading-6 whitespace-pre-wrap vibe-mono">{report.developmentPlan.taskTemplate}</pre></div><p className="mt-6 border-l-2 pl-4 text-xs leading-5 text-muted-foreground"><strong>判断边界：</strong>{report.uncertainty}</p></section>}

    <details className="mt-8 border-y"><summary className="cursor-pointer py-4 text-sm font-semibold">证据与模型运行记录</summary><div className="border-t py-5"><AnalysisRunTrace analysisType="behavior_report" /></div></details>
  </div>;
}
