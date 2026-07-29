import { useEffect, useState } from 'react';
import { CheckCircle, ChevronDown, CircleHelp, Cpu, Loader2, RefreshCw, Coins } from 'lucide-react';
import { toast } from 'sonner';
import { useLlmConfig, useSaveLlmConfig } from '@/hooks/useConfig';
import { testLlmConfig } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { LocalRuntimeCard } from '@/components/settings/LocalRuntimeCard';
import { Switch } from '@/components/ui/switch';
import type { AnalysisCapabilities } from '@/lib/types';
import { useKnowledgeStatus, useSetKnowledgeResearchAuthorization } from '@/hooks/usePractices';
import { useRuntimeStatus, useRetryPendingAnalysis } from '@/hooks/useRuntimeStatus';
import { useAnalysisQueue } from '@/hooks/useAnalysisQueue';
import { HistorySyncButton } from '@/components/dashboard/HistorySyncButton';
import { useAnalysisUsageSummary } from '@/hooks/useAnalysisUsageSummary';
import { useLanguage } from '@/i18n/LanguageProvider';
import { requestFirstRunGuide } from '@/components/onboarding/FirstRunGuide';
import { ProductUpdateCard } from '@/components/settings/ProductUpdateCard';

function tokenLabel(value: number, language: 'en' | 'zh-CN'): string {
  return new Intl.NumberFormat(language === 'zh-CN' ? 'zh-CN' : 'en-US', {
    notation: value >= 100_000 ? 'compact' : 'standard',
    maximumFractionDigits: 1,
  }).format(value);
}

function AnalysisUsageCard() {
  const usage = useAnalysisUsageSummary();
  const { language } = useLanguage();
  const cn = language === 'zh-CN';
  const items: Array<[string, number]> = usage.data ? [
    [cn ? '调用' : 'Calls', usage.data.calls],
    [cn ? '非缓存输入' : 'Uncached input', usage.data.inputTokens],
    [cn ? '输出' : 'Output', usage.data.outputTokens],
    [cn ? '缓存写入' : 'Cache writes', usage.data.cacheCreationTokens],
    [cn ? '缓存命中' : 'Cache reads', usage.data.cacheReadTokens],
    ...(usage.data.estimatedCostUsd != null && usage.data.estimatedCostUsd > 0
      ? [[cn ? '估算成本' : 'Estimated cost', usage.data.estimatedCostUsd] as [string, number]]
      : []),
  ] : [];
  const updatedAt = usage.data?.updatedAt
    ? new Intl.DateTimeFormat(cn ? 'zh-CN' : 'en-US', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(usage.data.updatedAt))
    : null;
  return <section className="border-t border-foreground">
    <div className="flex flex-wrap items-center gap-3 border-b p-5">
      <Coins className="h-5 w-5" />
      <div>
        <h2 className="text-lg font-semibold">{cn ? '分析模型用量' : 'Analysis model usage'}</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          {cn ? '本工具运行会话分析、跨会话分析与翻译所记录的 Token。' : 'Tokens recorded for session analysis, cross-session analysis, and translations.'}
        </p>
      </div>
      {updatedAt && <time
        className="ml-auto text-xs tabular-nums text-muted-foreground"
        dateTime={usage.data?.updatedAt ?? undefined}
      >
        {cn ? '更新于 ' : 'Updated '}{updatedAt}
      </time>}
    </div>
    {usage.isLoading ? <div className="p-5 text-xs text-muted-foreground">{cn ? '正在读取…' : 'Loading…'}</div>
      : <div className="grid sm:grid-cols-3 xl:grid-cols-5">
        {items.map(([label, value]) => <div key={label} className="border-b p-5 sm:border-r sm:[&:nth-child(3n)]:border-r-0 xl:border-b-0 xl:[&:nth-child(3n)]:border-r xl:last:border-r-0">
          <span className="text-[10px] text-muted-foreground">{label}</span>
          <strong className="mt-2 block text-xl tabular-nums">
            {label === (cn ? '估算成本' : 'Estimated cost')
              ? `$${Number(value).toFixed(4)}`
              : tokenLabel(value, language)}
          </strong>
        </div>)}
      </div>}
  </section>;
}

type Provider = 'openai' | 'anthropic' | 'gemini' | 'ollama' | 'llamacpp';
const PROVIDERS: Array<{ id: Provider; label: string; needsKey: boolean; baseUrl?: string }> = [
  { id: 'openai', label: 'OpenAI', needsKey: true },
  { id: 'anthropic', label: 'Anthropic', needsKey: true },
  { id: 'gemini', label: 'Google Gemini', needsKey: true },
  { id: 'ollama', label: 'Ollama（本地）', needsKey: false, baseUrl: 'http://localhost:11434' },
  { id: 'llamacpp', label: 'llama.cpp（本地）', needsKey: false, baseUrl: 'http://localhost:8080' },
];

function PipelineStatusPanel() {
  const { language } = useLanguage();
  const cn = language === 'zh-CN';
  const runtime = useRuntimeStatus();
  const queue = useAnalysisQueue();
  const retryAnalysis = useRetryPendingAnalysis();
  const stages = runtime.data?.stages;
  const failedItems = queue.data?.items.filter((item) => item.status === 'failed') ?? [];
  const oversizedFailures = failedItems.filter((item) =>
    item.error_message?.includes('input-evidence-too-large')).length;
  const emptyFailures = failedItems.filter((item) =>
    item.error_message?.includes('no genuine user messages')).length;
  const retryable = (queue.data?.awaitingCapability ?? 0) + oversizedFailures;
  const items = [
    ['capture', cn ? '会话记录' : 'Session capture', stages?.hook],
    ['ingestion', cn ? '本地导入' : 'Local import', stages?.ingestion],
    ['analysis', cn ? '任务分析' : 'Task analysis', stages?.semanticAnalysis],
  ] as const;

  return <section id="pipeline-status" className="scroll-mt-24 border-t border-foreground bg-card">
    <div className="border-b p-5">
      <h2 className="text-lg font-semibold">{cn ? '自动处理状态' : 'Automatic processing'}</h2>
      <p className="mt-1 text-xs text-muted-foreground">{cn ? '查看采集、导入和分析是否正常。' : 'Check session capture, import, and analysis status.'}</p>
    </div>
    {runtime.isLoading ? <div className="p-5 text-xs text-muted-foreground">{cn ? '正在读取状态…' : 'Loading status…'}</div> : <div className="grid md:grid-cols-3">
      {items.map(([id, label, stage]) => <article key={id} className="border-b p-5 last:border-b-0 md:border-b-0 md:border-r md:last:border-r-0">
        <span className="text-[10px] text-muted-foreground">{label}</span>
        <strong className="mt-2 block text-sm">{stage?.label ?? (cn ? '状态暂不可用' : 'Status unavailable')}</strong>
        <p className="mt-2 min-h-10 text-xs leading-5 text-muted-foreground">{stage?.detail}</p>
        {id === 'ingestion' && <div className="mt-4"><HistorySyncButton /></div>}
        {id === 'analysis' && failedItems.length > 0 && <div className="mt-4 space-y-1 border-t pt-3 text-[10px] text-muted-foreground">
          {oversizedFailures > 0 && <p>{cn ? `${oversizedFailures} 条记录内容较长，可以按安全上限提炼后重试。` : `${oversizedFailures} records are large and can be retried with bounded evidence.`}</p>}
          {emptyFailures > 0 && <p>{cn ? `${emptyFailures} 条记录没有可分析的用户内容，无需处理。` : `${emptyFailures} records contain no analyzable user content; no action is needed.`}</p>}
          {failedItems.length > oversizedFailures + emptyFailures && <p>{cn ? `${failedItems.length - oversizedFailures - emptyFailures} 条记录需要查看具体错误。` : `${failedItems.length - oversizedFailures - emptyFailures} records need error review.`}</p>}
        </div>}
        {id === 'analysis' && retryable > 0 && <div className="mt-4">
          <Button
            variant="outline"
            size="sm"
            disabled={retryAnalysis.isPending}
            onClick={() => retryAnalysis.mutate(undefined, {
              onSuccess: (result) => toast.success(result.accepted ? (cn ? `已开始重试 ${result.retrying} 条分析` : `Started ${result.retrying} analyses`) : (cn ? '没有需要重试的分析' : 'Nothing to retry')),
              onError: () => toast.error(cn ? '任务分析重试失败' : 'Could not retry task analysis'),
            })}
          >
            <RefreshCw className={`mr-2 h-4 w-4 ${retryAnalysis.isPending ? 'animate-spin' : ''}`} />
            {cn ? '重试可恢复的分析' : 'Retry recoverable analyses'}
          </Button>
        </div>}
      </article>)}
    </div>}
  </section>;
}

export default function SettingsPage() {
  const { language } = useLanguage();
  const cn = language === 'zh-CN';
  const config = useLlmConfig();
  const save = useSaveLlmConfig();
  const [provider, setProvider] = useState<Provider>('openai');
  const [model, setModel] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [testing, setTesting] = useState(false);
  const knowledge = useKnowledgeStatus();
  const setKnowledgeAuthorization = useSetKnowledgeResearchAuthorization();

  useEffect(() => {
    if (!config.data) return;
    if (config.data.provider) setProvider(config.data.provider);
    setModel(config.data.model ?? '');
    setBaseUrl(config.data.baseUrl ?? '');
  }, [config.data]);

  const providerInfo = PROVIDERS.find((item) => item.id === provider)!;
  const capabilities = config.data?.capabilities;
  const saveCapabilities = async (patch: Partial<AnalysisCapabilities>) => {
    try {
      await save.mutateAsync({ capabilities: patch });
      toast.success(cn ? '自动化设置已更新' : 'Automation settings updated');
    } catch {
      toast.error(cn ? '设置保存失败' : 'Could not save settings');
    }
  };
  const improvementAnalysisEnabled = Boolean(
    capabilities?.contextDocumentAnalysis
    && capabilities.tokenEfficiencyAnalysis
    && capabilities.skillOpportunityAnalysis,
  );
  const saveProvider = async () => {
    if (!model.trim()) { toast.error(cn ? '请输入模型 ID' : 'Enter a model ID'); return; }
    if (providerInfo.needsKey && !apiKey && !config.data?.apiKey) { toast.error(cn ? '首次配置该服务需要 API Key' : 'An API key is required for initial setup'); return; }
    setTesting(true);
    try {
      if (apiKey || !providerInfo.needsKey) {
        const result = await testLlmConfig({ provider, model: model.trim(), apiKey: apiKey || undefined, baseUrl: baseUrl || undefined });
        if (!result.success) throw new Error(result.error || (cn ? '模型连接测试失败' : 'Model connection test failed'));
      }
      await save.mutateAsync({ provider, model: model.trim(), apiKey: apiKey || undefined, baseUrl: baseUrl || undefined });
      setApiKey('');
      toast.success(cn ? '模型配置已保存' : 'Model configuration saved');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : (cn ? '模型配置保存失败' : 'Could not save model configuration'));
    } finally { setTesting(false); }
  };

  if (config.isLoading) return <div className="flex min-h-[50vh] items-center justify-center"><Loader2 className="h-6 w-6 animate-spin" /></div>;

  return <div className="vibe-page space-y-7 pb-16 pt-8">
    <header className="border-b border-foreground/80 pb-6">
      <p className="vibe-mono text-[10px] tracking-[.18em] text-[#28666E]">LOCAL SYSTEM SETTINGS</p>
      <h1 className="mt-3 text-4xl font-semibold tracking-[-.035em]">{cn ? '设置' : 'Settings'}</h1>
      <p className="mt-2 max-w-2xl text-sm text-muted-foreground">{cn ? '管理自动处理、模型服务、公开实践研究和本地数据。' : 'Manage automatic processing, model services, public practice research, and local data.'}</p>
      <Button variant="outline" size="sm" className="mt-4 gap-2" onClick={requestFirstRunGuide}>
        <CircleHelp className="h-4 w-4" />
        {cn ? '重新查看首次引导' : 'View first-run guide again'}
      </Button>
    </header>

    <div className="grid gap-7 xl:grid-cols-[minmax(0,1fr)_340px]">
      <details className="group self-start border border-border bg-card">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-4 p-5">
          <div>
            <p className="vibe-mono text-[10px] tracking-[.14em] text-[#28666E]">OPTIONAL CUSTOM MODEL</p>
            <h2 className="mt-2 text-lg font-semibold">{cn ? '改用其他模型服务' : 'Use another model service'}</h2>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">{cn ? '默认使用本机已登录的 Codex；需要自定义服务时再配置。' : 'Codex on this computer is used by default. Configure this only for a custom service.'}</p>
          </div>
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
        </summary>
        <div className="space-y-4 border-t p-5">
          <div><label className="text-xs font-medium">{cn ? '服务提供方' : 'Provider'}</label><select value={provider} onChange={(event) => {
            const next = event.target.value as Provider; setProvider(next); setBaseUrl(PROVIDERS.find((item) => item.id === next)?.baseUrl ?? '');
          }} className="mt-1 h-10 w-full border border-input bg-background px-3 text-sm">{PROVIDERS.map((item) => <option key={item.id} value={item.id}>{!cn && !item.needsKey ? item.label.replace('（本地）', ' (local)') : item.label}</option>)}</select></div>
          <div><label className="text-xs font-medium">{cn ? '模型 ID' : 'Model ID'}</label><Input className="mt-1" value={model} onChange={(event) => setModel(event.target.value)} placeholder="gpt-5.4-mini, claude-sonnet-4-6, qwen3:14b" /><p className="mt-1 text-[10px] text-muted-foreground">{cn ? '填写服务提供方使用的真实模型 ID。' : 'Enter the exact model ID used by the provider.'}</p></div>
          {providerInfo.needsKey && <div><label className="text-xs font-medium">API Key</label><Input className="mt-1" type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder={config.data?.apiKey ? (cn ? '留空以保留现有密钥' : 'Leave empty to keep the current key') : (cn ? '输入 API Key' : 'Enter API Key')} /></div>}
          {!providerInfo.needsKey && <div><label className="text-xs font-medium">{cn ? '本地服务地址' : 'Local service URL'}</label><Input className="mt-1" value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} /></div>}
          <div className="flex items-center justify-between gap-4 border-t pt-4"><span className="flex items-center gap-2 text-xs text-muted-foreground">{config.data?.provider && config.data.model ? <><CheckCircle className="h-4 w-4 text-[#28666E]" />{cn ? '当前' : 'Current'}: {config.data.provider} · {config.data.model}</> : (cn ? '尚未配置独立模型服务' : 'No custom model service configured')}</span><Button onClick={() => { void saveProvider(); }} disabled={testing || save.isPending}>{testing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Cpu className="mr-2 h-4 w-4" />}{cn ? '保存并验证' : 'Save and verify'}</Button></div>
        </div>
      </details>
      <aside className="border border-border bg-primary/[.025] p-5">
        <p className="font-semibold">{cn ? '自动化设置' : 'Automation'}</p>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">{cn ? '选择自动运行的采集、分析与公开资料更新。' : 'Choose which capture, analysis, and public-source updates run automatically.'}</p>
        <div className="mt-4 border-t">
          <label className="flex items-start justify-between gap-4 border-b py-4">
            <span><strong className="block text-sm">{cn ? '自动记录新会话' : 'Capture new sessions automatically'}</strong><small className="mt-1 block leading-4 text-muted-foreground">{cn ? '监听 Codex 会话文件并更新记录页。' : 'Watch Codex session files and update Activity.'}</small></span>
            <Switch checked={capabilities?.hookCapture ?? true} onCheckedChange={(checked) => { void saveCapabilities({ hookCapture: checked }); }} aria-label={cn ? '自动记录新会话' : 'Capture new sessions automatically'} />
          </label>
          <label className="flex items-start justify-between gap-4 border-b py-4">
            <span><strong className="block text-sm">{cn ? '自动分析单个会话' : 'Analyze each session automatically'}</strong><small className="mt-1 block leading-4 text-muted-foreground">{cn ? '会话稳定后生成摘要、决策与 Skill 使用评价。' : 'Generate summaries, decisions, and Skill assessments after a session settles.'}</small></span>
            <Switch checked={capabilities?.sessionLlmAnalysis ?? true} onCheckedChange={(checked) => { void saveCapabilities({ sessionLlmAnalysis: checked }); }} aria-label={cn ? '自动分析单个会话' : 'Analyze each session automatically'} />
          </label>
          <label className="flex items-start justify-between gap-4 border-b py-4">
            <span><strong className="block text-sm">{cn ? '自动更新 30 天报告' : 'Update the 30-day report automatically'}</strong><small className="mt-1 block leading-4 text-muted-foreground">{cn ? '有足够新证据后更新报告。' : 'Refresh the report when enough new evidence is available.'}</small></span>
            <Switch checked={capabilities?.automaticBehaviorReport ?? true} onCheckedChange={(checked) => { void saveCapabilities({ automaticBehaviorReport: checked }); }} aria-label={cn ? '自动更新 30 天报告' : 'Update the 30-day report automatically'} />
          </label>
          <label className="flex items-start justify-between gap-4 py-4">
            <span><strong className="block text-sm">{cn ? '分析改进机会' : 'Analyze improvement opportunities'}</strong><small className="mt-1 block leading-4 text-muted-foreground">{cn ? '关注上下文文档、Token 使用和 Skill 机会。' : 'Review context documents, Token use, and Skill opportunities.'}</small></span>
            <Switch checked={improvementAnalysisEnabled} onCheckedChange={(checked) => { void saveCapabilities({ contextDocumentAnalysis: checked, tokenEfficiencyAnalysis: checked, skillOpportunityAnalysis: checked }); }} aria-label={cn ? '分析改进机会' : 'Analyze improvement opportunities'} />
          </label>
          <label className="flex items-start justify-between gap-4 border-t py-4">
            <span><strong className="block text-sm">{cn ? '允许公开实践研究' : 'Allow public practice research'}</strong><small className="mt-1 block leading-4 text-muted-foreground">{cn ? '定期更新实践库；关闭后不再检索公开资料。' : 'Update the Practice Library periodically; no new public searches run when off.'}</small></span>
            <Switch
              checked={knowledge.data?.authorization.enabled ?? false}
              disabled={knowledge.isLoading || setKnowledgeAuthorization.isPending}
              onCheckedChange={(checked) => {
                setKnowledgeAuthorization.mutate(checked, {
                  onSuccess: () => toast.success(checked ? (cn ? '公开实践研究已开启' : 'Public practice research enabled') : (cn ? '公开实践研究已关闭' : 'Public practice research disabled')),
                  onError: () => toast.error(cn ? '设置保存失败' : 'Could not save settings'),
                });
              }}
              aria-label={cn ? '允许公开实践研究' : 'Allow public practice research'}
            />
          </label>
        </div>
      </aside>
    </div>

    <PipelineStatusPanel />
    <AnalysisUsageCard />
    <ProductUpdateCard />
    <LocalRuntimeCard />
  </div>;
}
