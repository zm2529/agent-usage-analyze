import { useState, useMemo, useEffect, useCallback } from 'react';
import { useSession, useSessionMutation, useDeleteSession } from '@/hooks/useSessions';
import { useInsights } from '@/hooks/useInsights';
import { useMessages } from '@/hooks/useMessages';
import {
  getSessionTitle,
  formatDateRange,
  cn,
} from '@/lib/utils';
import { SESSION_CHARACTER_COLORS, SESSION_CHARACTER_LABELS, SOURCE_TOOL_COLORS, OUTCOME_DOT } from '@/lib/constants/colors';
import { parseJsonField } from '@/lib/types';
import { getScoreTier, extractPQScore } from '@/lib/score-utils';
import type { Insight, InsightMetadata, Session } from '@/lib/types';
import { Badge } from '@/components/ui/badge';
import { ErrorCard } from '@/components/ErrorCard';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { PromptQualityCard } from '@/components/insights/PromptQualityCard';
import { AnalyzeDropdown } from '@/components/analysis/AnalyzeDropdown';
import { AnalyzeButton } from '@/components/analysis/AnalyzeButton';
import { useAnalysis } from '@/components/analysis/AnalysisContext';
import { useMissingFacets, useBackfillFacets } from '@/hooks/useFacets';
import { analysisQueueKey, useQueuedSessionKeys } from '@/hooks/useAnalysisQueue';
import { exportSession } from '@/lib/export-session';
import { fetchMessages } from '@/lib/api';
import { CollapsibleInsightItem } from '@/components/sessions/CollapsibleInsightItem';
import { PromptQualityAnalyzeButton } from '@/components/sessions/PromptQualityAnalyzeButton';
import { RenameSessionDialog } from '@/components/sessions/RenameSessionDialog';
import { VitalsStrip } from '@/components/sessions/VitalsStrip';
import { AnalysisCostLine } from '@/components/sessions/AnalysisCostLine';
import { AnalysisRunTrace } from '@/components/analysis/AnalysisRunTrace';
import { ChatConversation } from '@/components/chat/conversation/ChatConversation';
import { ConversationSearch } from '@/components/chat/conversation/ConversationSearch';
import {
  AlertTriangle,
  Clock,
  Pencil,
  FileText,
  Download,
  BookOpen,
  GitBranch,
  GitCommit,
  GitPullRequest,
  BarChart2,
  Wrench,
  Target,
  Loader2,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import { useLanguage } from '@/i18n/LanguageProvider';

interface SessionDetailPanelProps {
  sessionId: string;
  onDelete?: () => void;
}

export function SessionDetailPanel({ sessionId, onDelete }: SessionDetailPanelProps) {
  const { t } = useLanguage();
  const { data: session, isLoading: loading, error } = useSession(sessionId);
  const { data: insights = [] } = useInsights({ sessionId });
  const messagesQuery = useMessages(sessionId);
  const sessionMutation = useSessionMutation();
  const deleteMutation = useDeleteSession();
  const [renameOpen, setRenameOpen] = useState(false);
  const [searchHighlightId, setSearchHighlightId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [loadingAllMessages, setLoadingAllMessages] = useState(false);
  const [exporting, setExporting] = useState(false);
  const { getAnalysisState } = useAnalysis();
  // Show cost indicator when either analysis type is actively running
  const sessionAnalysisState = getAnalysisState(sessionId, 'session');
  const pqAnalysisState = getAnalysisState(sessionId, 'prompt_quality');
  const isAnalyzingThisSession =
    sessionAnalysisState?.status === 'analyzing' || pqAnalysisState?.status === 'analyzing';
  const queuedSessionKeys = useQueuedSessionKeys();
  const isQueuedForAnalysis = session
    ? queuedSessionKeys.has(analysisQueueKey(session.source_tool ?? 'claude-code', session.id))
    : false;
  const { data: missingFacetsData } = useMissingFacets();
  const backfillMutation = useBackfillFacets();
  const missingFacetIds = useMemo(
    () => new Set(missingFacetsData?.sessionIds ?? []),
    [missingFacetsData]
  );
  const isMissingFacets = useMemo(
    () => insights.length > 0 && missingFacetIds.has(sessionId),
    [insights, missingFacetIds, sessionId]
  );

  const messages = messagesQuery.data?.pages.flat() ?? [];
  const loadingMessages = messagesQuery.isLoading;
  const loadingMore = messagesQuery.isFetchingNextPage;
  const hasMore = messagesQuery.hasNextPage ?? false;

  const fetchAllMessages = useCallback(async () => {
    if (loadingAllMessages || !messagesQuery.hasNextPage) return;
    setLoadingAllMessages(true);
    const MAX_PAGES = 50;
    for (let i = 0; i < MAX_PAGES; i++) {
      const result = await messagesQuery.fetchNextPage();
      if (!result.hasNextPage) break;
    }
    setLoadingAllMessages(false);
  }, [messagesQuery, loadingAllMessages]);

  const prLinks = useMemo(() => {
    const linkSet = new Set<string>();
    const prUrlPattern = /https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+/g;
    for (const msg of messages) {
      const matches = msg.content.match(prUrlPattern);
      if (matches) {
        for (const match of matches) linkSet.add(match);
      }
    }
    return [...linkSet];
  }, [messagesQuery.data]);

  if (loading) {
    return (
      <div className="flex flex-col h-full">
        <div className="shrink-0 border-b px-6 py-3 space-y-2">
          <div className="flex items-center gap-2">
            <Skeleton className="h-6 w-64" />
            <Skeleton className="h-5 w-20 rounded-full" />
          </div>
          <div className="flex items-center gap-2">
            <Skeleton className="h-3.5 w-20" />
            <Skeleton className="h-3.5 w-20" />
            <Skeleton className="h-3.5 w-32" />
          </div>
        </div>
        <div className="p-6 space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="rounded-lg border px-3 py-2.5">
                <Skeleton className="h-6 w-16 mx-auto" />
                <Skeleton className="h-3 w-12 mx-auto mt-1" />
              </div>
            ))}
          </div>
          <div className="space-y-3">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="rounded-lg border px-4 py-3 space-y-2">
                <div className="flex items-center gap-2">
                  <Skeleton className="h-5 w-20 rounded-full" />
                  <Skeleton className="h-4 w-2/5" />
                </div>
                <Skeleton className="h-3.5 w-full" />
                <Skeleton className="h-3.5 w-3/4" />
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (error || !session) {
    return (
      <div className="p-6">
        <ErrorCard
          message={error instanceof Error ? error.message : t('sessions.notFound', 'Session not found')}
        />
      </div>
    );
  }

  const nonPromptInsights = insights.filter(
    (i) => i.type !== 'prompt_quality' && i.type !== 'summary'
  );
  const hasPromptQuality = insights.some((i) => i.type === 'prompt_quality');
  const promptQualityInsight = insights.find((i) => i.type === 'prompt_quality') ?? null;
  const promptQualityScore = promptQualityInsight
    ? extractPQScore(parseJsonField<Record<string, unknown>>(promptQualityInsight.metadata, {}))
    : null;

  const summaryInsight = insights.find((i) => i.type === 'summary');
  const summaryMetadata = summaryInsight
    ? parseJsonField<InsightMetadata>(summaryInsight.metadata, {})
    : {};
  const sessionOutcome = summaryMetadata.outcome;
  const skillUsage = summaryMetadata.skill_usage ?? [];
  const observedSkillUsage = session.observed_skill_usage ?? [];
  const assessedSkillNames = new Set(skillUsage.map((item) => item.name.toLowerCase()));
  const skillCount = new Set([
    ...observedSkillUsage.map((item) => item.name),
    ...skillUsage.map((item) => item.name),
  ]).size;
  const summaryText = session.summary || summaryInsight?.content;
  const summaryBulletsRaw = summaryInsight
    ? parseJsonField<string[]>(summaryInsight.bullets, [])
    : [];
  const summaryBullets =
    summaryBulletsRaw.length > 0
      ? summaryBulletsRaw
      : session.summary
        ? session.summary
            .split('\n')
            .filter((l) => l.startsWith('- '))
            .map((l) => l.slice(2))
        : [];
  const summaryTitle =
    summaryInsight?.title ||
    (session.summary
      ? session.summary.split('\n').find((l) => !l.startsWith('- '))?.trim() ||
        t('sessions.summary', 'Session Summary')
      : t('sessions.summary', 'Session Summary'));

  const startedAt = new Date(session.started_at);
  const endedAt = new Date(session.ended_at);
  const durationMinutes = Math.round((endedAt.getTime() - startedAt.getTime()) / 60000);
  const characterColor = session.session_character
    ? SESSION_CHARACTER_COLORS[session.session_character]
    : null;
  const characterLabel = session.session_character
    ? t(`sessions.character.${session.session_character}`, SESSION_CHARACTER_LABELS[session.session_character])
    : null;

  async function handleExport(format: 'plain' | 'obsidian' | 'notion') {
    if (exporting) return;
    setExporting(true);
    try {
      const currentSession = session!;
      const response = await fetchMessages(currentSession.id, {
        limit: Math.max(currentSession.message_count + 10, 100),
      });
      exportSession(currentSession, insights, summaryText, response.messages, format);
      toast.success(`${t('sessions.exported', 'Exported as')} ${format === 'plain' ? 'Markdown' : format}`);
    } catch (exportError) {
      toast.error(exportError instanceof Error
        ? exportError.message
        : t('sessions.exportFailed', 'Session export failed'));
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="flex h-full flex-col bg-background">
      {/* Session dossier header */}
      <div className="shrink-0 border-b border-foreground px-6 py-6">
        <p className="vibe-mono mb-4 flex items-center gap-3 text-[10px] tracking-[.15em] text-muted-foreground">
          <span className="w-6 border-t-2 border-[#365D8D]" />SESSION DOSSIER / 会话档案
        </p>
        <div className="flex items-center gap-2 flex-wrap">
          <h1 className="vibe-serif max-w-3xl text-2xl leading-tight">{getSessionTitle(session)}</h1>
          {sessionOutcome && OUTCOME_DOT[sessionOutcome] && (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className={cn('w-2 h-2 rounded-full shrink-0', OUTCOME_DOT[sessionOutcome].color)} />
              </TooltipTrigger>
              <TooltipContent side="bottom" className="text-xs">{t(`sessions.${sessionOutcome}`, OUTCOME_DOT[sessionOutcome].label)}</TooltipContent>
            </Tooltip>
          )}
          {characterLabel && characterColor && (
            <Badge variant="outline" className={cn('text-xs shrink-0', characterColor)}>
              {characterLabel}
            </Badge>
          )}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 shrink-0"
                onClick={() => setRenameOpen(true)}
              >
                <Pencil className="h-3.5 w-3.5" />
                <span className="sr-only">{t('sessions.rename', 'Rename session')}</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">{t('sessions.rename', 'Rename session')}</TooltipContent>
          </Tooltip>
          <div className="ml-auto flex items-center gap-1">
            <AnalyzeDropdown
              session={session}
              hasExistingInsights={nonPromptInsights.length > 0}
              insightCount={nonPromptInsights.length}
              hasExistingPromptQuality={hasPromptQuality}
            />
            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-1.5 px-2.5 text-xs"
              disabled={exporting}
              onClick={() => { void handleExport('plain'); }}
            >
              {exporting
                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                : <Download className="h-3.5 w-3.5" />}
              {exporting ? '正在导出' : '导出 Markdown'}
            </Button>
            <AlertDialog>
              <Tooltip>
                <TooltipTrigger asChild>
                  <AlertDialogTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive">
                      <Trash2 className="h-3.5 w-3.5" />
                      <span className="sr-only">{t('sessions.hide', 'Hide session')}</span>
                    </Button>
                  </AlertDialogTrigger>
                </TooltipTrigger>
                <TooltipContent side="bottom">{t('sessions.hide', 'Hide session')}</TooltipContent>
              </Tooltip>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>{t('sessions.hideConfirm', 'Hide this session?')}</AlertDialogTitle>
                  <AlertDialogDescription>
                    {t('sessions.hideDesc', 'This session will no longer appear in your session list. You can restore it by running')}{' '}
                    <code className="font-mono text-xs bg-muted px-1 py-0.5 rounded">agent-usage-analyze sync --force</code>.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>{t('sessions.cancel', 'Cancel')}</AlertDialogCancel>
                  <AlertDialogAction
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    onClick={async () => {
                      try {
                        await deleteMutation.mutateAsync(session.id);
                        toast.success(t('sessions.hiddenToast', 'Session hidden'));
                        onDelete?.();
                      } catch (err) {
                        toast.error(err instanceof Error ? err.message : t('sessions.hideFailed', 'Failed to hide session'));
                      }
                    }}
                  >
                    {t('sessions.hide', 'Hide session')}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>

        <div className="mt-5 grid gap-x-6 gap-y-2 border-t pt-4 text-xs text-muted-foreground sm:grid-cols-2 xl:grid-cols-3">
          <div className="flex items-center gap-2">
          <Clock className="h-3.5 w-3.5" />
          <span>{formatDateRange(startedAt, endedAt)}</span>
          </div>
          <div className="flex min-w-0 items-center gap-2">
          <span className="vibe-mono text-[9px] tracking-[.12em]">PROJECT</span>
          {session.git_remote_url ? (
            <a
              href={session.git_remote_url}
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-foreground underline-offset-2 hover:underline"
            >
              {session.project_name}
            </a>
          ) : (
            <span>{session.project_name}</span>
          )}
          </div>
          {session.git_branch && (
              <span className="flex min-w-0 items-center gap-1">
                <GitBranch className="h-3 w-3" />
                <span className="font-mono text-[11px] truncate max-w-[160px]">{session.git_branch}</span>
              </span>
          )}
          {session.tool_call_count > 0 && (
              <span className="flex items-center gap-1">
                <Wrench className="h-3 w-3" />
                {session.tool_call_count} {t('sessions.tools', 'tools')}
              </span>
          )}
          {session.source_tool && (
              <Badge
                variant="outline"
                className={cn(
                  'text-xs capitalize',
                  SOURCE_TOOL_COLORS[session.source_tool] ?? 'bg-muted text-muted-foreground'
                )}
              >
                {session.source_tool}
              </Badge>
          )}
        </div>
      </div>

      {/* Six-part audit dossier: interpretation stays separate from source facts. */}
      <Tabs defaultValue="insights" className="flex flex-1 flex-col overflow-hidden">
        <TabsList variant="line" className="!flex !h-14 w-full shrink-0 justify-start gap-0 overflow-x-auto rounded-none border-b bg-background p-0">
          <TabsTrigger value="insights" className="h-full min-w-[108px] flex-none rounded-none border-r px-3 py-3 text-[11px] tracking-wide data-[state=active]:bg-primary/[.04]">
            洞察{nonPromptInsights.length > 0 && ` (${nonPromptInsights.length})`}
          </TabsTrigger>
          <TabsTrigger value="prompt-quality" className="h-full min-w-[142px] flex-none rounded-none border-r px-3 py-3 text-[11px] tracking-wide data-[state=active]:bg-primary/[.04]">
            <span className="flex items-center gap-1.5" aria-label={promptQualityScore != null ? `${t('sessions.promptQuality', 'Prompt Quality')} ${promptQualityScore}/100` : t('sessions.promptQuality', 'Prompt Quality')}>
              提示词质量
              {promptQualityScore != null && (
                <span className={cn(
                  'inline-flex items-center justify-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold leading-none',
                  { excellent: 'bg-green-500/15 text-green-600', good: 'bg-yellow-500/15 text-yellow-600', fair: 'bg-orange-500/15 text-orange-600', poor: 'bg-red-500/15 text-red-600' }[getScoreTier(promptQualityScore)]
                )}>
                  {promptQualityScore}
                </span>
              )}
            </span>
          </TabsTrigger>
          <TabsTrigger value="conversation" className="h-full min-w-[108px] flex-none rounded-none border-r px-3 py-3 text-[11px] tracking-wide data-[state=active]:bg-primary/[.04]">
            对话 ({session.message_count})
          </TabsTrigger>
          <TabsTrigger value="skills" className="h-full min-w-[108px] flex-none rounded-none border-r px-3 py-3 text-[11px] tracking-wide data-[state=active]:bg-primary/[.04]">
            Skill ({skillCount})
          </TabsTrigger>
          <TabsTrigger value="metadata" className="h-full min-w-[108px] flex-none rounded-none border-r px-3 py-3 text-[11px] tracking-wide data-[state=active]:bg-primary/[.04]">
            元数据
          </TabsTrigger>
          <TabsTrigger value="evidence" className="h-full min-w-[108px] flex-none rounded-none px-3 py-3 text-[11px] tracking-wide data-[state=active]:bg-primary/[.04]">
            证据
          </TabsTrigger>
        </TabsList>

        {/* Tab 1: Insights */}
        <TabsContent value="insights" className="mt-0 flex-1 space-y-8 overflow-y-auto p-6">
          <VitalsStrip session={session} />

          {/* Queue in-progress indicator — shown when session is awaiting background analysis */}
          {isQueuedForAnalysis && !isAnalyzingThisSession && (
            <div className="flex items-center gap-2 rounded-md border border-blue-500/30 bg-blue-500/5 px-4 py-2.5">
              <Loader2 className="h-4 w-4 text-blue-500 animate-spin shrink-0" />
              <p className="text-sm text-muted-foreground">
                {t('sessions.analysisRunning', 'Analysis in progress — results will appear shortly')}
              </p>
            </div>
          )}

          {/* Analysis cost indicator — only shown when analysis has been run or is running */}
          {(insights.length > 0 || isAnalyzingThisSession) && (
            <AnalysisCostLine sessionId={sessionId} isAnalyzing={isAnalyzingThisSession} />
          )}

          {/* Missing facets banner */}
          {isMissingFacets && (
            <div className="flex items-center justify-between gap-3 rounded-md border border-amber-500/30 bg-amber-500/5 px-4 py-2.5">
              <div className="flex items-center gap-2 min-w-0">
                <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" />
                <p className="text-sm text-muted-foreground">
                  {t('sessions.missingFacets', 'Missing pattern data for this session')}
                </p>
              </div>
              <Button
                size="sm"
                variant="outline"
                className="shrink-0 gap-1.5 text-xs"
                disabled={backfillMutation.isPending}
                onClick={() => {
                  backfillMutation.mutate([sessionId], {
                    onSuccess: () => toast.success(t('sessions.facetsDone', 'Facets extracted successfully')),
                    onError: (err) => toast.error(
                      err instanceof Error ? err.message : t('sessions.facetsFailed', 'Failed to extract facets')
                    ),
                  });
                }}
              >
                {backfillMutation.isPending ? (
                  <>
                    <Loader2 className="h-3 w-3 animate-spin" />
                    {t('sessions.extracting', 'Extracting...')}
                  </>
                ) : (
                  t('sessions.extractFacets', 'Extract Facets')
                )}
              </Button>
            </div>
          )}

          {/* Summary */}
          {summaryText && (
            <div>
              <div className="flex items-center gap-2 mb-2">
                <FileText className="h-4 w-4 text-purple-500 shrink-0" />
                <h3 className="text-sm font-medium">{t('activity.insight.summary', 'Summary')}</h3>
              </div>
              <p className="mb-2 text-xs text-muted-foreground">这次会话完成了什么；只概括任务结果，不把它当成跨项目规则。</p>
              <div className="border bg-muted/20 px-4 py-3">
                <p className="font-medium text-sm mb-1.5">{summaryTitle}</p>
                {summaryBullets.length > 0 ? (
                  <ul className="list-disc list-inside space-y-0.5 text-sm text-muted-foreground">
                    {summaryBullets.map((bullet, i) => (
                      <li key={i}>{bullet}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-muted-foreground">{summaryText}</p>
                )}
              </div>
            </div>
          )}

          {/* PR Links */}
          {prLinks.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-2">
                <GitPullRequest className="h-4 w-4 text-muted-foreground" />
                <h3 className="text-sm font-medium">{t('sessions.prs', 'Pull Requests')}</h3>
              </div>
              <div className="flex flex-wrap gap-2">
                {prLinks.map((url) => {
                  const match = url.match(/github\.com\/([\w.-]+)\/([\w.-]+)\/pull\/(\d+)/);
                  const label = match ? `${match[2]}#${match[3]}` : url;
                  return (
                    <a key={url} href={url} target="_blank" rel="noopener noreferrer">
                      <Badge variant="outline" className="text-xs hover:bg-accent cursor-pointer gap-1">
                        <GitPullRequest className="h-3 w-3" />
                        {label}
                      </Badge>
                    </a>
                  );
                })}
              </div>
            </div>
          )}

          {/* Learnings & Decisions */}
          {insights.filter((i) => i.type !== 'summary' && i.type !== 'prompt_quality').length === 0 ? (
            <div className="rounded-lg border border-dashed">
              <div className="flex flex-col items-center justify-center py-12 text-center space-y-3">
                <BarChart2 className="h-8 w-8 text-muted-foreground" />
                <p className="font-medium text-sm">{t('sessions.notAnalyzed', "This session hasn't been analyzed yet")}</p>
                <p className="text-xs text-muted-foreground">
                  {t('sessions.notAnalyzedHint', 'Generate AI insights to extract learnings, decisions, and a session summary.')}
                </p>
                <div className="pt-2">
                  <AnalyzeButton
                    session={session}
                    hasExistingInsights={false}
                    insightCount={0}
                  />
                </div>
              </div>
            </div>
          ) : (
            <>
              {(() => {
                const learningInsights = insights.filter(
                  (i) => i.type === 'learning' || i.type === 'technique'
                );
                if (learningInsights.length === 0) return null;
                return (
                  <div>
                    <div className="flex items-center gap-2 mb-3">
                      <BookOpen className="h-4 w-4 text-green-500" />
                      <h3 className="text-sm font-medium">{t('sessions.learnings', 'Learnings')}</h3>
                      <Badge variant="secondary" className="text-xs">
                        {learningInsights.length}
                      </Badge>
                    </div>
                    <p className="mb-2 text-xs text-muted-foreground">
                      {t('sessions.learningsDesc', 'Reusable technical or workflow lessons extracted by the model from this conversation. They describe what can be reused next time, not actions that were automatically executed.')}
                    </p>
                    <div className="rounded-md border">
                      {learningInsights.map((insight) => (
                        <CollapsibleInsightItem key={insight.id} insight={insight} />
                      ))}
                    </div>
                  </div>
                );
              })()}

              {(() => {
                const decisionInsights = insights.filter((i) => i.type === 'decision');
                if (decisionInsights.length === 0) return null;
                return (
                  <div>
                    <div className="flex items-center gap-2 mb-3">
                      <GitCommit className="h-4 w-4 text-blue-500" />
                      <h3 className="text-sm font-medium">{t('sessions.decisions', 'Decisions')}</h3>
                      <Badge variant="secondary" className="text-xs">
                        {decisionInsights.length}
                      </Badge>
                    </div>
                    <p className="mb-2 text-xs text-muted-foreground">
                      {t('sessions.decisionsDesc', 'Choices explicitly adopted or rejected in this conversation, together with their context. They record why this task proceeded that way; they are not permanent rules for every project.')}
                    </p>
                    <div className="rounded-md border">
                      {decisionInsights.map((insight) => (
                        <CollapsibleInsightItem key={insight.id} insight={insight} />
                      ))}
                    </div>
                  </div>
                );
              })()}
            </>
          )}
        </TabsContent>

        {/* Tab 2: Prompt Quality */}
        <TabsContent value="prompt-quality" className="flex-1 overflow-y-auto mt-0 p-5 space-y-4">
          {promptQualityInsight ? (
            <PromptQualityCard insight={promptQualityInsight} />
          ) : (
            <div className="rounded-lg border border-dashed">
              <div className="flex flex-col items-center justify-center py-16 text-center space-y-3">
                <Target className="h-8 w-8 text-muted-foreground" />
                <p className="font-medium text-sm">{t('sessions.noPromptQuality', 'No Prompt Quality Analysis')}</p>
                <p className="text-xs text-muted-foreground max-w-[280px]">
                  {t('sessions.promptQualityHint', 'Analyze your prompting patterns to improve efficiency.')}
                </p>
                <div className="pt-2">
                  <PromptQualityAnalyzeButton session={session} />
                </div>
              </div>
            </div>
          )}
          <AnalysisRunTrace sessionId={session.id} />
        </TabsContent>

        {/* Tab 3: Conversation */}
        <TabsContent
          value="conversation"
          className="flex flex-col flex-1 overflow-hidden mt-0 bg-muted/40 dark:bg-muted/20"
        >
          <ConversationSearch
            messages={messages}
            onHighlightMessage={setSearchHighlightId}
            onSearchQueryChange={setSearchQuery}
            fetchAllMessages={fetchAllMessages}
            isLoadingAll={loadingAllMessages}
          />
          <div className="flex-1 overflow-y-auto">
            <ChatConversation
              messages={messages}
              loading={loadingMessages}
              loadingMore={loadingMore}
              hasMore={hasMore}
              onLoadMore={() => messagesQuery.fetchNextPage()}
              sourceTool={session.source_tool ?? undefined}
              highlightMessageId={searchHighlightId}
              searchQuery={searchQuery}
            />
          </div>
        </TabsContent>

        {/* Tab 4: Skill evaluation */}
        <TabsContent value="skills" className="mt-0 flex-1 overflow-y-auto p-6">
          <div className="border-b border-foreground pb-4">
            <p className="vibe-mono text-[10px] tracking-[.12em] text-muted-foreground">SESSION-LOCAL SKILL REVIEW</p>
            <h2 className="vibe-serif mt-2 text-2xl">本次会话使用的 Skill</h2>
            <p className="mt-2 text-xs leading-5 text-muted-foreground">“用户指定”来自用户消息中的 $Skill；“Agent 自动启用”来自 Agent 读取 Skill 指令的记录。模型会结合本次任务分别评价两种来源是否合适，评价不计入调用次数。</p>
          </div>
          {observedSkillUsage.length > 0 && <div className="border-t">
            {observedSkillUsage.map((item) => <article key={item.name} className="grid gap-3 border-b py-5 sm:grid-cols-[150px_minmax(0,1fr)]">
              <strong className="vibe-mono text-xs">${item.name}</strong>
              <div className="flex flex-wrap gap-2 text-xs">
                {item.userInvocations > 0 && <Badge variant="outline">用户指定 · {item.userInvocations} 次</Badge>}
                {item.automaticInvocations > 0 && <Badge variant="secondary">Agent 自动启用 · {item.automaticInvocations} 次</Badge>}
                <span className="text-muted-foreground">Agent 读取指令 {item.agentInvocations} 次</span>
                {!assessedSkillNames.has(item.name.toLowerCase()) && <span className="text-[#BF7A45]">当前分析尚未评价；重新分析后补充</span>}
              </div>
            </article>)}
          </div>}
          {skillUsage.length > 0 && <div className="mt-8">
            <h3 className="border-b pb-3 text-sm font-semibold">模型对使用方式的评价</h3>
            {skillUsage.map((item) => <article key={item.name} className="grid gap-3 border-b py-5 sm:grid-cols-[120px_minmax(0,1fr)]">
              <div><strong className="vibe-mono text-xs">${item.name}</strong><Badge variant="outline" className="mt-2 block w-fit text-[10px]">{item.fit === 'appropriate' ? '匹配' : item.fit === 'mixed' ? '利弊并存' : '证据不足'}</Badge></div>
              <div><p className="text-xs leading-5 text-muted-foreground">{item.observation}</p>{item.issue && <p className="mt-2 text-xs"><strong>发现的问题：</strong>{item.issue}</p>}<p className="mt-2 text-xs text-[#28666E]"><strong>建议：</strong>{item.recommendation}</p>{item.evidence.length > 0 && <details className="mt-3 text-[10px] text-muted-foreground"><summary className="cursor-pointer">会话内证据 · {item.evidence.length} 项</summary><ul className="mt-2 space-y-1">{item.evidence.map((itemEvidence, index) => <li key={index}>{itemEvidence}</li>)}</ul></details>}</div>
            </article>)}
          </div>}
          {observedSkillUsage.length === 0 && skillUsage.length === 0 && <div className="border-b py-14 text-center"><p className="vibe-serif text-xl">没有识别到 Skill 使用记录</p><p className="mt-2 text-xs text-muted-foreground">当前会话中既没有用户指定记录，也没有 Agent 读取 Skill 指令的记录。</p></div>}
        </TabsContent>

        {/* Tab 5: Deterministic metadata */}
        <TabsContent value="metadata" className="mt-0 flex-1 overflow-y-auto p-6">
          <div className="border-b border-foreground pb-4"><p className="vibe-mono text-[10px] tracking-[.12em] text-muted-foreground">LOCAL SESSION METADATA</p><h2 className="vibe-serif mt-2 text-2xl">确定性元数据</h2><p className="mt-2 text-xs text-muted-foreground">以下字段来自本地会话记录，不是 LLM 推断。</p></div>
          <dl className="grid grid-cols-[130px_minmax(0,1fr)] border-t text-xs">
            {[
              ['会话 ID', session.id],
              ['项目', session.project_name],
              ['项目路径', session.project_path || '未记录'],
              ['来源', session.source_tool || '未记录'],
              ['分支', session.git_branch || '未记录'],
              ['开始时间', startedAt.toLocaleString()],
              ['结束时间', endedAt.toLocaleString()],
              ['消息', `${session.user_message_count} user · ${session.assistant_message_count} assistant`],
              ['工具调用', String(session.tool_call_count)],
              ['上下文压缩', `${session.compact_count} 次 · 自动 ${session.auto_compact_count} 次`],
              ['主模型', session.primary_model || '未记录'],
              ['最近同步', new Date(session.synced_at).toLocaleString()],
            ].map(([label, value]) => <div key={label} className="contents"><dt className="border-b border-r p-3 text-muted-foreground">{label}</dt><dd className="min-w-0 break-all border-b p-3 vibe-mono">{value}</dd></div>)}
          </dl>
        </TabsContent>

        {/* Tab 6: Provenance and analysis traces */}
        <TabsContent value="evidence" className="mt-0 flex-1 space-y-6 overflow-y-auto p-6">
          <div className="border-b border-foreground pb-4"><p className="vibe-mono text-[10px] tracking-[.12em] text-muted-foreground">PROVENANCE / ANALYSIS TRACE</p><h2 className="vibe-serif mt-2 text-2xl">证据链</h2><p className="mt-2 text-xs leading-5 text-muted-foreground">把本地事实、模型输入输出和未记录边界分开。出现“未记录”不等同于失败。</p></div>
          <ol className="border-t">
            {[
              ['01 · 会话发现', `${session.source_tool || '本地来源'} · ${startedAt.toLocaleString()}`],
              ['02 · 消息与工具导入', `${session.message_count} 条消息 · ${session.tool_call_count} 次工具调用`],
              ['03 · 会话稳定', `最近同步 ${new Date(session.synced_at).toLocaleString()}`],
              ['04 · LLM 解读', insights.length > 0 ? `${insights.length} 条分析结果 · 可核对运行记录` : '尚无模型分析；不生成默认结论'],
              ['05 · 外部验证与交付', '仅在结构化工具事件或已登记证据存在时显示；人工验证未登记时保持“未记录”'],
            ].map(([title, detail]) => <li key={title} className="grid grid-cols-[150px_minmax(0,1fr)] gap-4 border-b py-4 text-xs"><strong>{title}</strong><span className="text-muted-foreground">{detail}</span></li>)}
          </ol>
          <AnalysisRunTrace sessionId={session.id} />
        </TabsContent>
      </Tabs>

      {/* Rename dialog */}
      <RenameSessionDialog
        open={renameOpen}
        onOpenChange={setRenameOpen}
        sessionId={session.id}
        currentTitle={getSessionTitle(session)}
      />
    </div>
  );
}
