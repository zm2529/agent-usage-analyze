import { Link, useLocation } from 'react-router';
import { BookOpenText, Footprints, LibraryBig, Sprout, Target } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ThemeToggle } from './ThemeToggle';
import { LanguageToggle } from './LanguageToggle';
import { useLanguage } from '@/i18n/LanguageProvider';
import { useRuntimeStatus } from '@/hooks/useRuntimeStatus';
import { ProductMark, SettingsMark } from './BrandIcons';

export const NAV_ITEMS = [
  { href: '/dashboard', label: '总览', fallback: 'Overview', icon: BookOpenText, exact: true },
  { href: '/analysis', label: '分析', fallback: 'Analysis', icon: Sprout, exact: false },
  { href: '/improvements', label: '改进追踪', fallback: 'Tracking', icon: Target, exact: false },
  { href: '/practices', label: '实践库', fallback: 'Practices', icon: LibraryBig, exact: false },
  { href: '/sessions', label: '活动记录', fallback: 'Activity', icon: Footprints, exact: false },
];

export function Header() {
  const { pathname } = useLocation();
  const { language } = useLanguage();
  const chinese = language === 'zh-CN';
  const { data: runtime } = useRuntimeStatus();
  const isActive = (href: string, exact: boolean) => exact ? pathname === href : pathname.startsWith(href);
  const currentItem = NAV_ITEMS.find(({ href, exact }) => isActive(href, exact));
  const currentLabel = pathname.startsWith('/settings')
    ? (language === 'zh-CN' ? '设置' : 'Settings')
    : language === 'zh-CN' ? currentItem?.label : currentItem?.fallback;
  const stages = runtime?.stages;
  const reportRunning = stages?.behaviorReport.state === 'running';
  const knowledgeRunning = stages?.knowledgeResearch.state === 'running';
  const stageClass = (state?: string) => cn(
    'vibe-stage',
    state === 'healthy' && 'is-ready',
    state === 'running' && 'is-running',
    (state === 'failed' || state === 'stale') && 'is-warning',
  );

  return (
    <>
      <aside data-onboarding="primary-navigation" className="vibe-rail hidden md:flex" aria-label={language === 'zh-CN' ? '主导航' : 'Primary navigation'}>
        <Link to="/dashboard" className="vibe-wordmark" aria-label={chinese ? 'Agent 使用分析首页' : 'Agent Usage Analytics home'}>
          <span className="vibe-brand-mark"><ProductMark colored className="h-[23px] w-[23px]" /></span>
          <span className="vibe-brand-copy"><strong>{chinese ? 'Agent 使用分析' : 'Agent Usage Analytics'}</strong></span>
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
      </nav>
      <Link
        to="/settings"
        aria-label={language === 'zh-CN' ? '设置' : 'Settings'}
        className={cn('vibe-mobile-settings md:hidden', pathname.startsWith('/settings') && 'is-active')}
      >
        <SettingsMark className="h-5 w-5" />
      </Link>

      <header className="vibe-topbar hidden md:flex">
        <div className="vibe-breadcrumb">
          <span>{chinese ? 'Agent 使用分析' : 'Agent Usage Analytics'}</span>
          <span aria-hidden>/</span>
          <strong>{currentLabel ?? (language === 'zh-CN' ? '本地工作台' : 'Local workspace')}</strong>
        </div>
        <div data-onboarding="pipeline" className="vibe-pipeline" aria-label={chinese ? '自动采集与分析流水线' : 'Automatic capture and analysis pipeline'}>
          <Link to={stages?.hook.action?.href ?? '/settings'} className={stageClass(stages?.hook.state)}>
            <i aria-hidden />
            <b>Hook</b>
            <span>{stages?.hook.label ?? (chinese ? '读取中' : 'Loading')}</span>
          </Link>
          <span className="vibe-pipe-arrow" aria-hidden>→</span>
          <Link to={stages?.ingestion.action?.href ?? '/settings'} className={stageClass(stages?.ingestion.state)}>
            <i aria-hidden />
            <b>{chinese ? '导入' : 'Import'}</b>
            <span>{stages?.ingestion.state === 'running'
              ? stages.ingestion.detail
              : stages?.ingestion.label ?? (chinese ? '读取中' : 'Loading')}</span>
          </Link>
          <span className="vibe-pipe-arrow" aria-hidden>→</span>
          <Link to={stages?.semanticAnalysis.action?.href ?? '/settings'} className={stageClass(stages?.semanticAnalysis.state)}>
            <i aria-hidden />
            <b>{chinese ? '任务分析' : 'Task analysis'}</b>
            <span>{stages?.semanticAnalysis.detail || stages?.semanticAnalysis.label || (chinese ? '读取中' : 'Loading')}</span>
          </Link>
          <span className="vibe-pipe-arrow" aria-hidden>→</span>
          <Link to={stages?.behaviorReport.action?.href ?? '/analysis'} className={stageClass(stages?.behaviorReport.state)}>
            <i aria-hidden />
            <b>{chinese ? '跨任务报告' : 'Cross-task report'}</b>
            <span>{stages?.behaviorReport.label ?? (chinese ? '读取中' : 'Loading')}</span>
          </Link>
          <span className="vibe-pipe-arrow" aria-hidden>→</span>
          <Link to={stages?.knowledgeResearch.action?.href ?? '/practices'} className={stageClass(stages?.knowledgeResearch.state)}>
            <i aria-hidden />
            <b>{chinese ? '实践快照' : 'Practice snapshot'}</b>
            <span>{stages?.knowledgeResearch.label ?? (chinese ? '读取中' : 'Loading')}</span>
          </Link>
        </div>
      </header>

      {(reportRunning || knowledgeRunning) && <div className="vibe-global-report hidden md:flex" role="status">
        <div><i aria-hidden /><strong>{reportRunning ? (chinese ? '正在分析最近的会话' : 'Analyzing recent sessions') : (chinese ? '正在更新公开实践快照' : 'Updating the public practice snapshot')}</strong><span>{chinese ? '切换页面不会中断；完成后会自动更新结果。' : 'You can change pages; results update automatically when complete.'}</span></div>
        <span className="vibe-report-track" aria-hidden><i /></span>
      </div>}
    </>
  );
}
