import { useQuery } from '@tanstack/react-query';
import { Database, Download, HardDrive, Server } from 'lucide-react';
import { fetchRuntimeConfig } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/i18n/LanguageProvider';

export function LocalRuntimeCard() {
  const { language, t } = useLanguage();
  const runtime = useQuery({ queryKey: ['config', 'runtime'], queryFn: fetchRuntimeConfig });
  const automaticLlmEnabled = runtime.data
    ? ['provider', 'codex-native', 'claude-native'].includes(runtime.data.analysis.effectiveRunner)
    : false;
  return (
    <section className="border-t border-foreground bg-card">
      <div className="border-b p-5">
        <h2 className="flex items-center gap-2 text-lg font-semibold"><HardDrive className="h-5 w-5" />{t('runtime.title', 'Local runtime and data')}</h2>
        <p className="mt-1 text-xs text-muted-foreground">只读状态与隐私导出；日常使用不需要在这里操作。</p>
      </div>
      <div className="space-y-3 p-5 text-sm">
        {runtime.isLoading && <p className="text-muted-foreground">{t('runtime.loading', 'Loading local runtime…')}</p>}
        {runtime.isError && <p className="text-destructive">{t('runtime.error', 'Local runtime status is unavailable.')}</p>}
        {runtime.data && <>
          <div className="grid border-y sm:grid-cols-2">
            <p className="flex gap-2 border-b p-4 sm:border-b-0 sm:border-r"><Database className="h-4 w-4 shrink-0" /><span><strong>{t('runtime.dataDir', 'Data directory')}</strong><br /><code className="break-all text-xs">{runtime.data.dataDirectory}</code></span></p>
            <p className="flex gap-2 p-4"><Server className="h-4 w-4 shrink-0" /><span><strong>{t('runtime.server', 'Loopback server')}</strong><br />{runtime.data.listenAddress}</span></p>
          </div>
          <dl className="border-t text-xs">
            <div className="grid grid-cols-[140px_1fr] border-b py-3"><dt className="text-muted-foreground">{t('runtime.sources', 'Sources')}</dt><dd>{runtime.data.sources.length === 0 ? t('runtime.none', 'none') : runtime.data.sources.map((source) => `${source.kind} (${source.count})`).join(', ')}</dd></div>
            <div className="grid grid-cols-[140px_1fr] border-b py-3"><dt className="text-muted-foreground">导入诊断日志</dt><dd><code className="break-all">{runtime.data.dataDirectory}/session-ingestion.log</code></dd></div>
            <div className="grid grid-cols-[140px_1fr] border-b py-3"><dt className="text-muted-foreground">{t('runtime.defaultLlm', 'Default session LLM analysis')}</dt><dd>{automaticLlmEnabled ? `${runtime.data.analysis.effectiveRunner} · ${runtime.data.analysis.authentication} · ${t('runtime.enabled', 'enabled')}` : `${runtime.data.analysis.effectiveRunner} · ${t('runtime.disabled', 'disabled')}`}</dd></div>
            <div className="grid grid-cols-[140px_1fr] border-b py-3"><dt className="text-muted-foreground">{t('runtime.migration', 'Migration')}</dt><dd>schema V{runtime.data.migration.databaseSchema} · {runtime.data.migration.status}</dd></div>
          </dl>
          <div className="border-t pt-3">
            <Button asChild size="sm"><a href={runtime.data.dataActions.exportPath} download><Download className="mr-2 h-4 w-4" />{t('runtime.export', 'Download sanitized export')}</a></Button>
            <p className="mt-2 text-xs text-muted-foreground">{language === 'zh-CN' ? t('runtime.scope') : runtime.data.dataActions.scope}</p>
          </div>
        </>}
      </div>
    </section>
  );
}
