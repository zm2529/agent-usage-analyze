import { useEffect, useState } from 'react';
import { CheckCircle, Cpu, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useLlmConfig, useSaveLlmConfig } from '@/hooks/useConfig';
import { testLlmConfig } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { LocalRuntimeCard } from '@/components/settings/LocalRuntimeCard';
import { Switch } from '@/components/ui/switch';
import type { AnalysisCapabilities } from '@/lib/types';

type Provider = 'openai' | 'anthropic' | 'gemini' | 'ollama' | 'llamacpp';
const PROVIDERS: Array<{ id: Provider; label: string; needsKey: boolean; baseUrl?: string }> = [
  { id: 'openai', label: 'OpenAI', needsKey: true },
  { id: 'anthropic', label: 'Anthropic', needsKey: true },
  { id: 'gemini', label: 'Google Gemini', needsKey: true },
  { id: 'ollama', label: 'Ollama（本地）', needsKey: false, baseUrl: 'http://localhost:11434' },
  { id: 'llamacpp', label: 'llama.cpp（本地）', needsKey: false, baseUrl: 'http://localhost:8080' },
];

function Panel({ eyebrow, title, description, children }: {
  eyebrow: string; title: string; description: string; children: React.ReactNode;
}) {
  return <section className="border border-border bg-card">
    <div className="border-b p-5"><p className="vibe-mono text-[10px] tracking-[.14em] text-[#28666E]">{eyebrow}</p><h2 className="mt-2 text-lg font-semibold">{title}</h2><p className="mt-1 text-xs leading-5 text-muted-foreground">{description}</p></div>
    <div className="p-5">{children}</div>
  </section>;
}

export default function SettingsPage() {
  const config = useLlmConfig();
  const save = useSaveLlmConfig();
  const [provider, setProvider] = useState<Provider>('openai');
  const [model, setModel] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [testing, setTesting] = useState(false);

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
      toast.success('自动化设置已更新');
    } catch {
      toast.error('设置保存失败');
    }
  };
  const improvementAnalysisEnabled = Boolean(
    capabilities?.contextDocumentAnalysis
    && capabilities.tokenEfficiencyAnalysis
    && capabilities.skillOpportunityAnalysis,
  );
  const saveProvider = async () => {
    if (!model.trim()) { toast.error('请输入模型 ID'); return; }
    if (providerInfo.needsKey && !apiKey && !config.data?.apiKey) { toast.error('首次配置该服务需要 API Key'); return; }
    setTesting(true);
    try {
      if (apiKey || !providerInfo.needsKey) {
        const result = await testLlmConfig({ provider, model: model.trim(), apiKey: apiKey || undefined, baseUrl: baseUrl || undefined });
        if (!result.success) throw new Error(result.error || '模型连接测试失败');
      }
      await save.mutateAsync({ provider, model: model.trim(), apiKey: apiKey || undefined, baseUrl: baseUrl || undefined });
      setApiKey('');
      toast.success('模型配置已保存');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '模型配置保存失败');
    } finally { setTesting(false); }
  };

  if (config.isLoading) return <div className="flex min-h-[50vh] items-center justify-center"><Loader2 className="h-6 w-6 animate-spin" /></div>;

  return <div className="vibe-page space-y-7 pb-16 pt-8">
    <header className="border-b border-foreground/80 pb-6">
      <p className="vibe-mono text-[10px] tracking-[.18em] text-[#28666E]">LOCAL SYSTEM SETTINGS</p>
      <h1 className="mt-3 text-4xl font-semibold tracking-[-.035em]">设置</h1>
      <p className="mt-2 max-w-2xl text-sm text-muted-foreground">默认配置已经可以自动采集并复用 Codex 登录完成分析。只有想改用自己的模型服务时，才需要在这里设置。</p>
    </header>

    <div className="grid gap-7 xl:grid-cols-[minmax(0,1fr)_340px]">
      <Panel eyebrow="OPTIONAL CUSTOM MODEL" title="自定义模型（可选）" description="留空即可继续使用 Codex。保存后，新的会话分析和跨会话报告会优先使用这里配置的服务。">
        <div className="space-y-4">
          <div><label className="text-xs font-medium">服务提供方</label><select value={provider} onChange={(event) => {
            const next = event.target.value as Provider; setProvider(next); setBaseUrl(PROVIDERS.find((item) => item.id === next)?.baseUrl ?? '');
          }} className="mt-1 h-10 w-full border border-input bg-background px-3 text-sm">{PROVIDERS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></div>
          <div><label className="text-xs font-medium">模型 ID</label><Input className="mt-1" value={model} onChange={(event) => setModel(event.target.value)} placeholder="例如 gpt-5.4-mini、claude-sonnet-4-6、qwen3:14b" /><p className="mt-1 text-[10px] text-muted-foreground">按服务提供方的真实模型 ID 原样填写。</p></div>
          {providerInfo.needsKey && <div><label className="text-xs font-medium">API Key</label><Input className="mt-1" type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder={config.data?.apiKey ? '留空以保留现有密钥' : '输入 API Key'} /></div>}
          {!providerInfo.needsKey && <div><label className="text-xs font-medium">本地服务地址</label><Input className="mt-1" value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} /></div>}
          <div className="flex items-center justify-between gap-4 border-t pt-4"><span className="flex items-center gap-2 text-xs text-muted-foreground">{config.data?.provider && config.data.model ? <><CheckCircle className="h-4 w-4 text-[#28666E]" />当前：{config.data.provider} · {config.data.model}</> : '尚未配置独立模型服务'}</span><Button onClick={() => { void saveProvider(); }} disabled={testing || save.isPending}>{testing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Cpu className="mr-2 h-4 w-4" />}保存并验证</Button></div>
        </div>
      </Panel>
      <aside className="border border-border bg-primary/[.025] p-5">
        <p className="font-semibold">自动化设置</p>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">只保留直接影响产品行为的开关；模型不可用不会阻止本地记录。</p>
        <div className="mt-4 border-t">
          <label className="flex items-start justify-between gap-4 border-b py-4">
            <span><strong className="block text-sm">自动记录新会话</strong><small className="mt-1 block leading-4 text-muted-foreground">监听 Codex 会话文件并更新记录页。</small></span>
            <Switch checked={capabilities?.hookCapture ?? true} onCheckedChange={(checked) => { void saveCapabilities({ hookCapture: checked }); }} aria-label="自动记录新会话" />
          </label>
          <label className="flex items-start justify-between gap-4 border-b py-4">
            <span><strong className="block text-sm">自动分析单个会话</strong><small className="mt-1 block leading-4 text-muted-foreground">会话稳定后生成摘要、决策与 Skill 使用评价。</small></span>
            <Switch checked={capabilities?.sessionLlmAnalysis ?? true} onCheckedChange={(checked) => { void saveCapabilities({ sessionLlmAnalysis: checked }); }} aria-label="自动分析单个会话" />
          </label>
          <label className="flex items-start justify-between gap-4 border-b py-4">
            <span><strong className="block text-sm">自动更新 30 天报告</strong><small className="mt-1 block leading-4 text-muted-foreground">有足够新证据并经过冷却期后重新生成能力报告。</small></span>
            <Switch checked={capabilities?.automaticBehaviorReport ?? true} onCheckedChange={(checked) => { void saveCapabilities({ automaticBehaviorReport: checked }); }} aria-label="自动更新 30 天报告" />
          </label>
          <label className="flex items-start justify-between gap-4 py-4">
            <span><strong className="block text-sm">分析改进机会</strong><small className="mt-1 block leading-4 text-muted-foreground">关注上下文文档、Token 使用和 Skill 机会。</small></span>
            <Switch checked={improvementAnalysisEnabled} onCheckedChange={(checked) => { void saveCapabilities({ contextDocumentAnalysis: checked, tokenEfficiencyAnalysis: checked, skillOpportunityAnalysis: checked }); }} aria-label="分析改进机会" />
          </label>
        </div>
      </aside>
    </div>

    <section className="border-y border-foreground bg-card p-5">
      <div className="flex flex-col justify-between gap-3 md:flex-row md:items-end"><div><p className="vibe-mono text-[10px] tracking-[.14em] text-[#28666E]">AUTOMATIC LOCAL PIPELINE</p><h2 className="mt-2 text-lg font-semibold">自动导入与模型分析是两个阶段</h2></div><p className="max-w-xl text-xs leading-5 text-muted-foreground">模型服务不可用不会阻止本地会话进入记录；只有会话导入稳定且满足分析资格后，才会进入异步 LLM 队列。</p></div>
      <div className="mt-5 grid border-t text-xs md:grid-cols-[1fr_34px_1fr_34px_1fr]">
        <div className="border-b p-4 md:border-b-0"><strong className="vibe-mono text-[10px]">01 · EVENT REGISTERED</strong><p className="mt-2 text-muted-foreground">Hook 登记会话事件与时间。</p></div>
        <div className="hidden place-items-center border-x text-muted-foreground md:grid">→</div>
        <div className="border-b p-4 md:border-b-0"><strong className="vibe-mono text-[10px]">02 · LOCAL IMPORT</strong><p className="mt-2 text-muted-foreground">稳定后导入消息、工具、Token 与上下文记录。</p></div>
        <div className="hidden place-items-center border-x text-muted-foreground md:grid">→</div>
        <div className="p-4"><strong className="vibe-mono text-[10px]">03 · LLM QUEUE</strong><p className="mt-2 text-muted-foreground">满足资格后异步分析，不阻塞导入与统计。</p></div>
      </div>
    </section>

    <LocalRuntimeCard />
  </div>;
}
