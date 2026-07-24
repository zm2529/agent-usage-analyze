import { useState } from 'react';
import { toast } from 'sonner';
import { Switch } from '@/components/ui/switch';
import { useLlmConfig, useSaveLlmConfig } from '@/hooks/useConfig';
import type { AnalysisCapabilities } from '@/lib/types';

const rows: Array<{
  key: keyof AnalysisCapabilities;
  title: string;
  description: string;
}> = [
  {
    key: 'hookCapture',
    title: 'Hook 实时采集',
    description: 'Codex 每次 Stop 时登记会话；静默约 90 秒后导入本地数据库。不扫描目录，也不频繁轮询。',
  },
  {
    key: 'sessionLlmAnalysis',
    title: '会话级 LLM 分析',
    description: '基础导入完成后，在后台生成摘要、经验、决策和提示词质量。关闭后仍保留本地统计与会话内容。',
  },
  {
    key: 'automaticBehaviorReport',
    title: '每日跨会话报告',
    description: 'Stop Hook 完成稳定导入后检查；有新稳定证据且距上次生成尝试满 24 小时才自动生成，24 小时内最多一次。',
  },
  {
    key: 'contextDocumentAnalysis',
    title: '上下文文档分析',
    description: '评估 AGENTS.md 等工程指令的覆盖、重复、体积和可观察效果，识别会话固定上下文是否值得精简。',
  },
  {
    key: 'tokenEfficiencyAnalysis',
    title: 'Token 效率分析',
    description: '结合输入、输出、缓存、上下文压缩和长线程结构，只在有充分证据时给出节省 Token 的建议。',
  },
  {
    key: 'skillOpportunityAnalysis',
    title: 'Skill 机会分析',
    description: '评估已用 Skill 是否匹配，并在重复流程明显时才建议更合适的 Skill 或创建新 Skill。',
  },
];

export function AnalysisCapabilitiesCard() {
  const config = useLlmConfig();
  const save = useSaveLlmConfig();
  const [pendingKey, setPendingKey] = useState<keyof AnalysisCapabilities | null>(null);
  const capabilities = config.data?.capabilities;
  if (!capabilities) return null;

  const update = async (key: keyof AnalysisCapabilities, enabled: boolean) => {
    setPendingKey(key);
    try {
      await save.mutateAsync({ capabilities: { [key]: enabled } });
      toast.success('能力设置已更新');
    } catch {
      toast.error('无法更新能力设置');
    } finally {
      setPendingKey(null);
    }
  };

  return <section className="border border-border bg-card" aria-label="分析能力开关">
    <div className="border-b p-5">
      <p className="vibe-mono text-[10px] tracking-[.14em] text-[#28666E]">CAPABILITY CONTROLS</p>
      <h2 className="mt-2 text-lg font-semibold">分析能力</h2>
      <p className="mt-1 text-xs text-muted-foreground">控制采集、自动分析和报告中允许使用的分析维度。设置只保存在本机。</p>
    </div>
    <div>{rows.map((row) => <div key={row.key} className="grid grid-cols-[minmax(0,1fr)_auto] gap-6 border-b p-5 last:border-b-0">
      <div><h3 className="text-sm font-medium">{row.title}</h3><p className="mt-1 max-w-3xl text-xs leading-5 text-muted-foreground">{row.description}</p></div>
      <Switch
        checked={capabilities[row.key]}
        disabled={config.isLoading || save.isPending || pendingKey === row.key}
        onCheckedChange={(enabled) => { void update(row.key, enabled); }}
        aria-label={row.title}
      />
    </div>)}</div>
  </section>;
}
