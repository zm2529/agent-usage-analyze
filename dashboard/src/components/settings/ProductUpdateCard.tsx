import { AlertCircle, CheckCircle2, Copy, Download, Loader2, PackageCheck, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import {
  useApplyProductUpdate,
  useCheckForProductUpdates,
  useProductUpdateStatus,
  useSaveProductUpdateSettings,
} from '@/hooks/useProductUpdates';
import { useLanguage } from '@/i18n/LanguageProvider';
import type { ProductInstallationMode } from '@/lib/types';

function installationLabel(mode: ProductInstallationMode, cn: boolean): string {
  const labels: Record<ProductInstallationMode, [string, string]> = {
    source: ['源码运行', 'Source checkout'],
    'npm-global': ['npm 全局安装', 'Global npm install'],
    npx: ['npx 临时运行', 'Temporary npx install'],
    unsupported: ['本地安装', 'Local install'],
  };
  return labels[mode][cn ? 0 : 1];
}

function installationHelp(mode: ProductInstallationMode, cn: boolean): string {
  if (mode === 'source') {
    return cn
      ? '可检测 npm 最新版本，但不会改写源码仓库；请通过 Git 和 pnpm 更新源码。'
      : 'You can check the npm release, but this app will not rewrite a source checkout. Update it with Git and pnpm.';
  }
  if (mode === 'npx') {
    return cn
      ? 'npx 使用临时缓存，不能安全地原地更新。需要自动更新时请改用 npm install -g agent-usage-analyze。'
      : 'npx uses a temporary cache and cannot be safely updated in place. Install globally with npm to enable automatic updates.';
  }
  if (mode === 'unsupported') {
    return cn
      ? '当前安装不属于 npm 全局目录，只提供版本检测，不会修改该目录。'
      : 'This package is outside the global npm directory. Version checks are available, but the directory will not be modified.';
  }
  return cn
    ? '开启后每 6 小时检测一次正式 npm 版本，并在后台安装；不会强制中断当前页面。'
    : 'When enabled, the app checks the published npm release every 6 hours and installs it in the background without interrupting this page.';
}

function formatTime(value: string | null, cn: boolean): string {
  if (!value) return cn ? '尚未检测' : 'Not checked yet';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return cn ? '时间未知' : 'Unknown time';
  return new Intl.DateTimeFormat(cn ? 'zh-CN' : 'en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

export function ProductUpdateCard() {
  const { language } = useLanguage();
  const cn = language === 'zh-CN';
  const status = useProductUpdateStatus();
  const check = useCheckForProductUpdates();
  const save = useSaveProductUpdateSettings();
  const apply = useApplyProductUpdate();
  const data = status.data;
  const busy = Boolean(data?.checking || data?.updating || check.isPending || apply.isPending);
  const globalInstallCommand = 'npm install --global agent-usage-analyze && agent-usage-analyze start';

  const copyGlobalInstallCommand = async () => {
    try {
      if (!navigator.clipboard) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(globalInstallCommand);
      toast.success(cn ? '切换命令已复制' : 'Switch command copied');
    } catch {
      toast.error(cn ? '无法复制，请手动复制命令' : 'Could not copy; copy the command manually');
    }
  };

  return <section className="border-t border-foreground bg-card">
    <div className="flex flex-wrap items-start gap-4 border-b p-5">
      <PackageCheck className="mt-0.5 h-5 w-5" />
      <div>
        <h2 className="text-lg font-semibold">{cn ? '应用更新' : 'Application updates'}</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          {cn ? '检测已发布的 npm 版本，并控制是否自动安装。' : 'Check published npm releases and control automatic installation.'}
        </p>
      </div>
      {data && <span className="ml-auto border px-2 py-1 text-[10px] text-muted-foreground">
        {installationLabel(data.installationMode, cn)}
      </span>}
    </div>

    {status.isLoading ? <div className="flex items-center gap-2 p-5 text-xs text-muted-foreground">
      <Loader2 className="h-4 w-4 animate-spin" />{cn ? '正在读取更新状态…' : 'Loading update status…'}
    </div> : status.isError || !data ? <div className="p-5 text-sm text-destructive">
      {cn ? '更新状态暂不可用。' : 'Update status is unavailable.'}
    </div> : <div className="space-y-5 p-5">
      <div className="grid border-y sm:grid-cols-3">
        <div className="border-b p-4 sm:border-b-0 sm:border-r">
          <span className="text-[10px] text-muted-foreground">{cn ? '当前运行版本' : 'Running version'}</span>
          <strong className="mt-1 block font-mono text-sm">v{data.currentVersion}</strong>
        </div>
        <div className="border-b p-4 sm:border-b-0 sm:border-r">
          <span className="text-[10px] text-muted-foreground">{cn ? '最新发布版本' : 'Latest release'}</span>
          <strong className="mt-1 block font-mono text-sm">{data.latestVersion ? `v${data.latestVersion}` : '—'}</strong>
        </div>
        <div className="p-4">
          <span className="text-[10px] text-muted-foreground">{cn ? '上次检测' : 'Last checked'}</span>
          <strong className="mt-1 block text-xs">{formatTime(data.lastCheckedAt, cn)}</strong>
        </div>
      </div>

      {data.restartRequired && <div className="flex gap-3 border border-[#28666E] bg-[#28666E]/5 p-4 text-sm">
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[#28666E]" />
        <div>
          <strong>{cn ? `v${data.pendingVersion} 已安装，重启后生效` : `v${data.pendingVersion} is installed and will be used after restart`}</strong>
          <p className="mt-1 text-xs text-muted-foreground">
            {cn ? '当前页面不会被强制关闭。macOS 后台服务可再次运行 agent-usage-analyze start 完成重启。' : 'This page will not be closed automatically. On macOS, run agent-usage-analyze start again to restart the background service.'}
          </p>
        </div>
      </div>}

      {data.error && <div className="flex gap-2 border border-destructive/50 p-3 text-xs text-destructive">
        <AlertCircle className="h-4 w-4 shrink-0" />{data.error}
      </div>}

      <div>
        <strong className="text-sm">
          {data.updating
            ? (cn ? '正在后台安装更新…' : 'Installing update in the background…')
            : data.updateAvailable
              ? (cn ? `发现新版本 v${data.latestVersion}` : `New version v${data.latestVersion} is available`)
              : data.latestVersion
                ? (cn ? '当前已是最新发布版本' : 'You are running the latest published version')
                : (cn ? '尚未检测发布版本' : 'No release check has been run')}
        </strong>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">
          {installationHelp(data.installationMode, cn)}
        </p>
      </div>

      {data.installationMode === 'npx' && <div className="border border-[#BF7A45]/60 bg-[#BF7A45]/5 p-4 text-sm">
        <div className="flex gap-3">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-[#BF7A45]" />
          <div className="min-w-0 flex-1">
            <strong>{cn ? '当前页面仍由 npx 临时实例运行' : 'This page is still running from a temporary npx instance'}</strong>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              {cn
                ? '即使已经执行过 npm 安装，旧的 npx 后台服务也不会自动切换。请用全局安装命令重新启动；页面恢复后此开关即可使用。'
                : 'An existing npx background service does not switch automatically after npm install. Restart it from the global install; this control will then become available.'}
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <code className="max-w-full overflow-x-auto border bg-background px-2 py-1.5 text-[11px]">{globalInstallCommand}</code>
              <Button type="button" variant="outline" size="sm" onClick={() => { void copyGlobalInstallCommand(); }}>
                <Copy className="mr-2 h-3.5 w-3.5" />
                {cn ? '复制切换命令' : 'Copy switch command'}
              </Button>
            </div>
          </div>
        </div>
      </div>}

      <label className="flex items-start justify-between gap-4 border-y py-4">
        <span>
          <strong className="block text-sm">{cn ? '自动更新应用' : 'Update the app automatically'}</strong>
          <small className="mt-1 block leading-4 text-muted-foreground">
            {cn ? '仅 npm 全局安装支持；默认关闭，安装完成后下次启动生效。' : 'Available only for global npm installs. Off by default; installed updates take effect on next launch.'}
          </small>
        </span>
        <Switch
          checked={data.autoUpdate}
          disabled={(!data.canUpdate && !data.autoUpdate) || save.isPending}
          onCheckedChange={(enabled) => {
            save.mutate(enabled, {
              onSuccess: () => toast.success(enabled
                ? (cn ? '自动更新已开启' : 'Automatic updates enabled')
                : (cn ? '自动更新已关闭' : 'Automatic updates disabled')),
              onError: () => toast.error(cn ? '自动更新设置保存失败' : 'Could not save automatic update setting'),
            });
          }}
          aria-label={cn ? '自动更新应用' : 'Update the app automatically'}
        />
      </label>

      <div className="flex flex-wrap gap-3">
        <Button
          variant="outline"
          disabled={busy}
          onClick={() => check.mutate(undefined, {
            onSuccess: (next) => toast.success(next.updateAvailable
              ? (cn ? `发现新版本 v${next.latestVersion}` : `Version v${next.latestVersion} is available`)
              : (cn ? '当前已是最新版本' : 'You are up to date')),
            onError: () => toast.error(cn ? '检测更新失败' : 'Could not check for updates'),
          })}
        >
          <RefreshCw className={`mr-2 h-4 w-4 ${data.checking || check.isPending ? 'animate-spin' : ''}`} />
          {cn ? '检测更新' : 'Check for updates'}
        </Button>
        {data.canUpdate && data.updateAvailable && <Button
          disabled={busy}
          onClick={() => apply.mutate(undefined, {
            onSuccess: () => toast.success(cn ? '已开始后台安装' : 'Update installation started'),
            onError: () => toast.error(cn ? '无法开始安装更新' : 'Could not start update installation'),
          })}
        >
          <Download className="mr-2 h-4 w-4" />
          {cn ? '立即更新' : 'Update now'}
        </Button>}
      </div>
    </div>}
  </section>;
}
