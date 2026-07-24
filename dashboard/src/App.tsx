import { useEffect, useRef } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation, useSearchParams } from 'react-router';
import { capturePageView, captureDashboardLoaded } from '@/lib/telemetry';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { Layout } from '@/components/layout/Layout';
import DashboardPage from '@/pages/DashboardPage';
import SessionsPage from '@/pages/SessionsPage';
import SessionDetailPage from '@/pages/SessionDetailPage';
import InsightsPage from '@/pages/InsightsPage';
import AnalyticsPage from '@/pages/AnalyticsPage';
import SettingsPage from '@/pages/SettingsPage';
import ExportPage from '@/pages/ExportPage';
import JournalPage from '@/pages/JournalPage';
import PatternsPage from '@/pages/PatternsPage';
import TasksPage from '@/pages/TasksPage';
import TaskDetailPage from '@/pages/TaskDetailPage';
import DeliveriesPage from '@/pages/DeliveriesPage';
import DeliveryDetailPage from '@/pages/DeliveryDetailPage';
import ScorecardsPage from '@/pages/ScorecardsPage';
import AdvicePage from '@/pages/AdvicePage';
import ImprovePage from '@/pages/ImprovePage';
import { useLanguage } from '@/i18n/LanguageProvider';

const ROUTE_TITLES: Record<string, string> = {
  '/dashboard': 'Overview',
  '/sessions': 'Sessions',
  '/tasks': 'Tasks',
  '/deliveries': 'Deliveries',
  '/insights': 'Insights',
  '/analytics': 'Analytics',
  '/patterns': 'Patterns',
  '/scorecards': 'Scorecards',
  '/advice': 'Advice',
  '/improve': 'Improve',
  '/export': 'Export',
  '/journal': 'Journal',
  '/settings': 'Settings',
};

function RouteEffects() {
  const { pathname } = useLocation();
  const [searchParams] = useSearchParams();
  const insightParam = searchParams.get('insight');
  const navStartRef = useRef<number>(Date.now());
  const { language } = useLanguage();

  // Scroll to top on route change, unless deep-linking to a specific insight
  useEffect(() => {
    const isInsightDeepLink = pathname === '/insights' && insightParam;
    if (!isInsightDeepLink) {
      window.scrollTo(0, 0);
    }
  }, [pathname, insightParam]);

  // Update document.title per route, track page views, and capture dashboard_loaded
  useEffect(() => {
    const segment = '/' + pathname.split('/')[1];
    const page = ROUTE_TITLES[segment];
    const localizedPage = language === 'zh-CN' ? ({
      Overview: '总览', Sessions: '活动记录', Tasks: '任务与交付', Deliveries: '交付证据',
      Insights: '洞察', Analytics: '统计', Patterns: '行为模式', Scorecards: '评分卡',
      Advice: '行动计划', Improve: '能力分析', Export: '导出', Journal: '日志', Settings: '设置',
    } as Record<string, string>)[page] ?? page : page;
    const product = language === 'zh-CN' ? 'Agent 使用分析' : 'Agent Usage Analytics';
    document.title = localizedPage ? `${localizedPage} — ${product}` : product;

    // Track page view on every route change
    capturePageView(pathname);

    // Capture dashboard_loaded with time since navigation started
    if (page) {
      const loadTimeMs = Date.now() - navStartRef.current;
      captureDashboardLoaded(page.toLowerCase(), loadTimeMs);
    }
    // Reset nav start for next navigation
    navStartRef.current = Date.now();
  }, [pathname, language]);

  return null;
}

export default function App() {
  return (
    <ErrorBoundary>
    <BrowserRouter>
      <RouteEffects />
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/sessions" element={<SessionsPage />} />
          <Route path="/sessions/:id" element={<SessionDetailPage />} />
          <Route path="/tasks" element={<TasksPage />} />
          <Route path="/tasks/:id" element={<TaskDetailPage />} />
          <Route path="/deliveries" element={<DeliveriesPage />} />
          <Route path="/deliveries/:id" element={<DeliveryDetailPage />} />
          <Route path="/insights" element={<InsightsPage />} />
          <Route path="/analytics" element={<AnalyticsPage />} />
          <Route path="/patterns" element={<PatternsPage />} />
          <Route path="/scorecards" element={<ScorecardsPage />} />
          <Route path="/advice" element={<AdvicePage />} />
          <Route path="/improve" element={<ImprovePage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/export" element={<ExportPage />} />
          <Route path="/journal" element={<JournalPage />} />
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
    </ErrorBoundary>
  );
}
