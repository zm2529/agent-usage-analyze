import { useState } from 'react';
import { Sparkles, Loader2, X, ChevronDown, Target, Info } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Link } from 'react-router';
import { useAnalysis } from './AnalysisContext';
import { useLlmConfig } from '@/hooks/useConfig';
import { useAnalysisCost } from '@/hooks/useAnalysisCost';
import { estimateAnalysisCost, formatCost, formatEstimatedInputTokens } from '@/lib/cost-utils';
import type { Session } from '@/lib/types';
import { useLanguage } from '@/i18n/LanguageProvider';
import { isAutomaticAnalysisAvailable } from '@/lib/analysis-availability';

interface AnalyzeDropdownProps {
  session: Session;
  hasExistingInsights?: boolean;
  insightCount?: number;
  hasExistingPromptQuality?: boolean;
}

export function AnalyzeDropdown({
  session,
  hasExistingInsights,
  insightCount,
  hasExistingPromptQuality,
}: AnalyzeDropdownProps) {
  const { language, t } = useLanguage();
  const chinese = language === 'zh-CN';
  const [confirmSessionOpen, setConfirmSessionOpen] = useState(false);
  const [confirmPromptOpen, setConfirmPromptOpen] = useState(false);
  const { getAnalysisState, startAnalysis, cancelAnalysis } = useAnalysis();
  const { data: llmConfig } = useLlmConfig();
  const { data: costData } = useAnalysisCost(session.id);

  const configured = isAutomaticAnalysisAvailable(llmConfig);
  // Local providers with no per-token cost
  const isLocalFreeProvider = llmConfig?.provider === 'ollama' || llmConfig?.provider === 'llamacpp';
  const isOllama = isLocalFreeProvider;

  // Client-side cost estimates (shown in dropdown sublabels)
  const sessionCostEstimate =
    llmConfig?.provider && llmConfig?.model
      ? estimateAnalysisCost(session, llmConfig.provider, llmConfig.model, 'session')
      : null;

  const pqCostEstimate =
    llmConfig?.provider && llmConfig?.model
      ? estimateAnalysisCost(session, llmConfig.provider, llmConfig.model, 'prompt_quality')
      : null;

  // Anthropic cache hint: shown when session analysis has run but PQ has not
  const sessionAnalysisRan = costData?.usage.some(r => r.analysis_type === 'session') ?? false;
  const pqAnalysisRan = costData?.usage.some(r => r.analysis_type === 'prompt_quality') ?? false;
  const showCacheHint =
    llmConfig?.provider === 'anthropic' && sessionAnalysisRan && !pqAnalysisRan;

  const inputTokensLabel = formatEstimatedInputTokens(session);

  const sessionAnalysisState = getAnalysisState(session.id, 'session');
  const pqAnalysisState = getAnalysisState(session.id, 'prompt_quality');

  const isAnalyzingSession = sessionAnalysisState?.status === 'analyzing';
  const isAnalyzingPq = pqAnalysisState?.status === 'analyzing';
  // Either analysis type is running on this session
  const isAnalyzingThisSession = isAnalyzingSession || isAnalyzingPq;

  const isCompleteForSession =
    sessionAnalysisState?.status === 'complete';

  const handleSessionAnalyze = () => {
    startAnalysis(session, 'session');
  };

  const handlePromptAnalyze = () => {
    startAnalysis(session, 'prompt_quality');
  };

  const handleSessionClick = () => {
    if (hasExistingInsights && !isCompleteForSession) {
      setConfirmSessionOpen(true);
    } else {
      handleSessionAnalyze();
    }
  };

  const handlePromptClick = () => {
    const isCompleteForPrompt = pqAnalysisState?.status === 'complete';

    if (hasExistingPromptQuality && !isCompleteForPrompt) {
      setConfirmPromptOpen(true);
    } else {
      handlePromptAnalyze();
    }
  };

  if (!configured) {
    return (
      <Link
        to="/settings"
        className="text-xs text-muted-foreground underline hover:text-foreground"
      >
        {t('analysis.configure', 'Configure AI in Settings')}
      </Link>
    );
  }

  // Show spinner for whichever analysis is currently running on this session
  if (isAnalyzingThisSession) {
    const activeState = isAnalyzingSession ? sessionAnalysisState : pqAnalysisState;
    const activeType = isAnalyzingSession ? 'session' : 'prompt_quality';
    return (
      <div className="flex items-center gap-1.5">
        <Button disabled variant="outline" size="sm" className="h-8 gap-2">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          <span className="hidden sm:inline">
            {activeState?.progress?.message || t('analysis.analyzing', 'Analyzing…')}
          </span>
          <span className="sm:hidden">{t('analysis.analyzing', 'Analyzing…')}</span>
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-8 gap-1 text-muted-foreground hover:text-foreground"
          onClick={() => cancelAnalysis(session.id, activeType)}
        >
          <X className="h-3.5 w-3.5" />
          <span className="sr-only sm:not-sr-only">{t('sessions.cancel', 'Cancel')}</span>
        </Button>
      </div>
    );
  }

  const showPromptOption = session.user_message_count >= 2;
  return (
    <>
      <div className="flex items-center">
        <Button
          variant="outline"
          size="sm"
          className={`h-8 gap-1.5 ${showPromptOption ? 'rounded-r-none border-r-0' : ''}`}
          onClick={handleSessionClick}
        >
          <Sparkles className="h-3.5 w-3.5" />
          {hasExistingInsights
            ? t('analysis.reanalyze', 'Re-analyze')
            : t('analysis.analyze', 'Analyze')}
        </Button>
        {showPromptOption && <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className="h-8 rounded-l-none px-2"
              aria-label={chinese ? '选择其他分析' : 'Choose another analysis'}
            >
              <ChevronDown className="h-3 w-3 opacity-60" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={handlePromptClick}>
              <Target className="h-4 w-4" />
              {hasExistingPromptQuality ? t('analysis.reanalyzePromptQuality', 'Re-analyze prompt quality') : t('analysis.analyzePromptQuality', 'Analyze prompt quality')}
              {pqCostEstimate !== null && (
                <div className="w-full pb-0.5 pl-7 text-xs text-muted-foreground">
                  {isOllama
                    ? (chinese ? '本地运行' : 'Runs locally')
                    : (chinese ? `约 ${formatCost(pqCostEstimate)} · 使用同一会话` : `About ${formatCost(pqCostEstimate)} · same session`)}
                </div>
              )}
              {showCacheHint && (
                <div className="flex w-full items-center gap-1 pb-1 pl-7 text-[10px] italic text-muted-foreground/60">
                  <Info className="h-3 w-3 shrink-0" />
                  {chinese ? '紧接会话分析运行时可复用缓存' : 'Can reuse cache when run after session analysis'}
                </div>
              )}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>}
      </div>

      <AlertDialog open={confirmSessionOpen} onOpenChange={setConfirmSessionOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{chinese ? '重新分析这次会话？' : 'Re-analyze this session?'}</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div>
                <p>
                  {chinese
                    ? `将重新生成摘要、决策与 Skill 评价，并替换现有 ${insightCount ?? 0} 项分析结果。`
                    : `This regenerates the summary, decisions, and Skill assessment, replacing ${insightCount ?? 0} existing results.`}
                </p>
                {sessionCostEstimate !== null && !isOllama && (
                  <p className="text-sm text-muted-foreground mt-1">
                    {chinese
                      ? `预计使用 ${inputTokensLabel || '当前会话内容'}，费用约 ${formatCost(sessionCostEstimate)}`
                      : `Estimated input: ${inputTokensLabel || 'current session content'} · about ${formatCost(sessionCostEstimate)}`}
                  </p>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{chinese ? '取消' : 'Cancel'}</AlertDialogCancel>
            <AlertDialogAction onClick={handleSessionAnalyze}>{chinese ? '开始重新分析' : 'Start re-analysis'}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmPromptOpen} onOpenChange={setConfirmPromptOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Re-analyze prompt quality?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div>
                <p>
                  This will replace the current prompt quality score with a new one.
                  This uses LLM tokens and cannot be undone.
                </p>
                {pqCostEstimate !== null && !isOllama && (
                  <p className="text-sm text-muted-foreground mt-1">
                    Estimated cost: ~{formatCost(pqCostEstimate)}
                  </p>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handlePromptAnalyze}>Re-analyze</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
