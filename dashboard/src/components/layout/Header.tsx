import { Link, useLocation } from 'react-router';
import { BookOpenText, Footprints, Sprout, Target } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ThemeToggle } from './ThemeToggle';
import { LanguageToggle } from './LanguageToggle';
import { useLanguage } from '@/i18n/LanguageProvider';
import { useIngestionHealth } from '@/hooks/useIngestionHealth';
import { useBehaviorReport } from '@/hooks/useBehaviorReport';
import { ProductMark, SettingsMark } from './BrandIcons';

export const NAV_ITEMS = [
  { href: '/dashboard', label: '总览', fallback: 'Overview', icon: BookOpenText, exact: true },
  { href: '/improve', label: '分析', fallback: 'Analysis', icon: Sprout, exact: false },
  { href: '/advice', label: '建议', fallback: 'Suggestions', icon: Target, exact: false },
  { href: '/sessions', label: '记录', fallback: 'Activity', icon: Footprints, exact: false },
];

export function Header() {
  const { pathname } = useLocation();
  const { language } = useLanguage();
  const { data: ingestion } = useIngestionHealth();
  const { data: behavior } = useBehaviorReport();
  const isActive = (href: string, exact: boolean) => exact ? pathname === href : pathname.startsWith(href);
  const currentItem = NAV_ITEMS.find(({ href, exact }) => isActive(href, exact));
  const currentLabel = pathname.startsWith('/settings')
    ? (language === 'zh-CN' ? '设置' : 'Settings')
    : language === 'zh-CN' ? currentItem?.label : currentItem?.fallback;
  const importRunning = ingestion?.status === 'running';
  const importAvailable = ingestion && ingestion.status !== 'never-run' && ingestion.status !== 'failed';
  const reportRunning = behavior?.generation.running ?? false;
  const importTotal = ingestion?.coverage.discovered ?? 0;
  const importCompleted = Math.min(ingestion?.processedSources ?? 0, importTotal);
  const importPercent = importTotal > 0
    ? Math.min(100, Math.round((importCompleted / importTotal) * 100))
    : 0;

  return (
    <>
      <aside data-onboarding="primary-navigation" className="vibe-rail hidden md:flex" aria-label={language === 'zh-CN' ? '主导航' : 'Primary navigation'}>
        <Link to="/dashboard" className="vibe-wordmark" aria-label="Agent 使用分析首页">
          <span className="vibe-brand-mark"><ProductMark colored className="h-[23px] w-[23px]" /></span>
          <span className="vibe-brand-copy"><strong>Agent 使用分析</strong></span>
        </Link>
        <nav className="vibe-rail-nav">
          {NAV_ITEMS.map(({ href, label, fallback, icon: Icon, exact }) => (
            <Link
              key={href}
              to={href}
              aria-current={isActive(href, exact) ? 'page' : undefined}
              className={cn('vibe-rail-link', isActive(href, exact) && 'is-active')}
            >
              <Icon aria-hidden className="h-4 w-4" />
              <span>{language === 'zh-CN' ? label : fallback}</span>
            </Link>
          ))}
        </nav>
        <div className="vibe-rail-tools">
          <LanguageToggle />
          <ThemeToggle />
          <Link to="/settings" className={cn('vibe-system-link', pathname.startsWith('/settings') && 'is-active')}>
            <SettingsMark className="h-4 w-4" />
            <span>{language === 'zh-CN' ? '设置' : 'Settings'}</span>
          </Link>
        </div>
      </aside>

      <nav className="vibe-mobile-nav md:hidden" aria-label={language === 'zh-CN' ? '主导航' : 'Primary navigation'}>
        {NAV_ITEMS.map(({ href, label, fallback, icon: Icon, exact }) => (
          <Link key={href} to={href} className={cn(isActive(href, exact) && 'is-active')}>
            <Icon className="h-4 w-4" />
            <span>{language === 'zh-CN' ? label : fallback}</span>
          </Link>
        ))}
        <Link to="/settings" className={cn(pathname.startsWith('/settings') && 'is-active')}>
          <SettingsMark className="h-4 w-4" />
          <span>{language === 'zh-CN' ? '设置' : 'Settings'}</span>
        </Link>
      </nav>

      <header className="vibe-topbar hidden md:flex">
        <div className="vibe-breadcrumb">
          <span>Agent 使用分析</span>
          <span aria-hidden>/</span>
          <strong>{currentLabel ?? (language === 'zh-CN' ? '本地工作台' : 'Local workspace')}</strong>
        </div>
        <div data-onboarding="pipeline" className="vibe-pipeline" aria-label="自动采集与分析流水线">
          <span className={cn('vibe-stage', importAvailable && 'is-ready')}>
            <i aria-hidden />
            <b>Hook</b>
            <span>{importAvailable ? '已连接' : '等待事件'}</span>
          </span>
          <span className="vibe-pipe-arrow" aria-hidden>→</span>
          <span
            className={cn('vibe-stage', importRunning ? 'is-running has-progress' : importAvailable && 'is-ready')}
            role={importRunning ? 'status' : undefined}
            aria-label={importRunning
              ? `导入进度 ${importPercent}%，已处理 ${importCompleted}/${importTotal} 个会话文件`
              : undefined}
          >
            <i aria-hidden />
            <b>导入</b>
            <span>{importRunning
              ? importTotal > 0 ? `${importPercent}% · ${importCompleted}/${importTotal}` : '正在扫描'
              : importAvailable ? '已稳定' : '等待'}</span>
            {importRunning && (
              <span className="vibe-stage-progress" aria-hidden>
                <span style={{ width: `${Math.max(4, importPercent)}%` }} />
              </span>
            )}
          </span>
          <span className="vibe-pipe-arrow" aria-hidden>→</span>
          <span className={cn('vibe-stage', reportRunning ? 'is-running' : behavior?.report && 'is-ready')}>
            <i aria-hidden />
            <b>LLM</b>
            <span>{reportRunning ? '报告生成中' : behavior?.report ? '异步就绪' : '等待证据'}</span>
          </span>
        </div>
      </header>

      {reportRunning && <div className="vibe-global-report hidden md:flex" role="status">
        <div><i aria-hidden /><strong>正在分析最近的会话</strong><span>切换页面不会中断；完成后会自动更新结果。</span></div>
        <span className="vibe-report-track" aria-hidden><i /></span>
      </div>}
    </>
  );
}
