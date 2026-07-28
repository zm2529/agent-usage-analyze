import { lazy, Suspense, useEffect, useRef } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation, useSearchParams } from 'react-router';
import { capturePageView, captureDashboardLoaded } from '@/lib/telemetry';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { Layout } from '@/components/layout/Layout';
import { useLanguage } from '@/i18n/LanguageProvider';

const loadDashboardPage = () => import('@/pages/DashboardPage');
const loadSessionsPage = () => import('@/pages/SessionsPage');
const loadAnalysisPage = () => import('@/pages/ImprovePage');
const loadImprovementTrackingPage = () => import('@/pages/ImprovementTrackingPage');
const loadPracticeLibraryPage = () => import('@/pages/PracticeLibraryPage');
const DashboardPage = lazy(loadDashboardPage);
const SessionsPage = lazy(loadSessionsPage);
const SessionDetailPage = lazy(() => import('@/pages/SessionDetailPage'));
const InsightsPage = lazy(() => import('@/pages/InsightsPage'));
const AnalyticsPage = lazy(() => import('@/pages/AnalyticsPage'));
const SettingsPage = lazy(() => import('@/pages/SettingsPage'));
const ExportPage = lazy(() => import('@/pages/ExportPage'));
const JournalPage = lazy(() => import('@/pages/JournalPage'));
const PatternsPage = lazy(() => import('@/pages/PatternsPage'));
const TasksPage = lazy(() => import('@/pages/TasksPage'));
const TaskDetailPage = lazy(() => import('@/pages/TaskDetailPage'));
const DeliveriesPage = lazy(() => import('@/pages/DeliveriesPage'));
const DeliveryDetailPage = lazy(() => import('@/pages/DeliveryDetailPage'));
const ScorecardsPage = lazy(() => import('@/pages/ScorecardsPage'));
const AnalysisPage = lazy(loadAnalysisPage);
const ImprovementTrackingPage = lazy(loadImprovementTrackingPage);
const PracticeLibraryPage = lazy(loadPracticeLibraryPage);

function RoutePrefetch() {
  useEffect(() => {
    const preload = () => {
      void Promise.allSettled([
        loadDashboardPage(),
        loadSessionsPage(),
        loadAnalysisPage(),
        loadImprovementTrackingPage(),
        loadPracticeLibraryPage(),
      ]);
    };
    const id = window.requestAnimationFrame(preload);
    return () => window.cancelAnimationFrame(id);
  }, []);
  return null;
}

const ROUTE_TITLES: Record<string, string> = {
  '/dashboard': 'Overview',
  '/sessions': 'Sessions',
  '/tasks': 'Tasks',
  '/deliveries': 'Deliveries',
  '/insights': 'Insights',
  '/analytics': 'Analytics',
  '/patterns': 'Patterns',
  '/scorecards': 'Scorecards',
  '/analysis': 'Analysis',
  '/improvements': 'Improvement Tracking',
  '/practices': 'Practice Library',
  '/export': 'Export',
  '/journal': 'Journal',
  '/settings': 'Settings',
};

function RouteEffects() {
  const { pathname, hash } = useLocation();
  const [searchParams] = useSearchParams();
  const insightParam = searchParams.get('insight');
  const navStartRef = useRef<number>(Date.now());
  const { language } = useLanguage();

  // Scroll to top on route change, unless deep-linking to a specific insight
  useEffect(() => {
    if (hash) {
      requestAnimationFrame(() => document.getElementById(hash.slice(1))?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
      return;
    }
    const isInsightDeepLink = pathname === '/insights' && insightParam;
    if (!isInsightDeepLink) {
      window.scrollTo(0, 0);
    }
  }, [pathname, hash, insightParam]);

  // Update document.title per route, track page views, and capture dashboard_loaded
  useEffect(() => {
    const segment = '/' + pathname.split('/')[1];
    const page = ROUTE_TITLES[segment];
    const localizedPage = language === 'zh-CN' ? ({
      Overview: '总览', Sessions: '活动记录', Tasks: '任务与交付', Deliveries: '交付证据',
      Insights: '洞察', Analytics: '统计', Patterns: '行为模式', Scorecards: '评分卡',
      Analysis: '分析', Export: '导出', Journal: '日志', Settings: '设置',
      'Improvement Tracking': '改进追踪', 'Practice Library': '实践库',
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
      <RoutePrefetch />
      <Suspense fallback={<div className="vibe-page" role="status" aria-label="正在打开页面">
        <div className="h-9 animate-pulse border-y bg-muted/20" />
        <div className="mt-10 h-14 max-w-2xl animate-pulse bg-muted/30" />
        <div className="mt-5 h-5 max-w-3xl animate-pulse bg-muted/20" />
        <div className="mt-10 h-48 animate-pulse border-y bg-muted/15" />
      </div>}>
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
          <Route path="/analysis" element={<AnalysisPage />} />
          <Route path="/improvements" element={<ImprovementTrackingPage />} />
          <Route path="/practices" element={<PracticeLibraryPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/export" element={<ExportPage />} />
          <Route path="/journal" element={<JournalPage />} />
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Route>
      </Routes>
      </Suspense>
    </BrowserRouter>
    </ErrorBoundary>
  );
}
