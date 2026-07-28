import { useState } from 'react';
import { Sparkles, Loader2, CheckCircle, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { analyzeSessionAutomatically } from '@/lib/api';
import { useLlmConfig } from '@/hooks/useConfig';
import { useQueryClient } from '@tanstack/react-query';
import type { Session } from '@/lib/types';
import { useLanguage } from '@/i18n/LanguageProvider';
import { isAutomaticAnalysisAvailable } from '@/lib/analysis-availability';

interface BulkAnalyzeButtonProps {
  sessions: Session[];
  onComplete?: () => void;
}

export function BulkAnalyzeButton({ sessions, onComplete }: BulkAnalyzeButtonProps) {
  const [open, setOpen] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [progress, setProgress] = useState({ completed: 0, total: 0 });
  const [result, setResult] = useState<{
    successful: number;
    failed: number;
    errors: string[];
  } | null>(null);
  const { data: llmConfig } = useLlmConfig();
  const { t } = useLanguage();
  const queryClient = useQueryClient();
  const eligibleSessions = sessions.filter((session) => session.user_message_count > 0
    && session.assistant_message_count > 0);

  const configured = isAutomaticAnalysisAvailable(llmConfig);

  const handleAnalyze = async () => {
    if (!configured || eligibleSessions.length === 0) return;

    setAnalyzing(true);
    setProgress({ completed: 0, total: eligibleSessions.length });
    setResult(null);

    let successful = 0;
    let failed = 0;
    const errors: string[] = [];

    for (const session of eligibleSessions) {
      try {
        await analyzeSessionAutomatically(session.id);
        successful++;
      } catch (error) {
        failed++;
        const message = error instanceof Error ? error.message : `Failed: ${session.id}`;
        errors.push(/API 422|no genuine user messages|insufficient.evidence/i.test(message)
          ? t('bulk.unavailable', 'This session has no complete real conversation and was skipped.')
          : message.replace(/^API \d+:\s*/, ''));
      }
      setProgress((prev) => ({ ...prev, completed: prev.completed + 1 }));
    }

    // Invalidate all insight queries
    queryClient.invalidateQueries({ queryKey: ['insights'] });
    queryClient.invalidateQueries({ queryKey: ['sessions'] });

    setResult({ successful, failed, errors });
    setAnalyzing(false);
    onComplete?.();
  };

  const resetAndClose = () => {
    setOpen(false);
    setResult(null);
    setProgress({ completed: 0, total: 0 });
  };

  if (!configured) {
    return (
      <Button variant="outline" disabled className="gap-2">
        <Sparkles className="h-4 w-4" />
        {t('bulk.selected', 'Analyze Selected')}
        <span className="text-xs text-muted-foreground ml-1">({t('bulk.runnerRequired', 'Automatic LLM runner required')})</span>
      </Button>
    );
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          className="gap-2"
          disabled={eligibleSessions.length === 0}
        >
          {analyzing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          {analyzing
            ? `${t('bulk.backgroundProgress', 'Analyzing in background')} ${progress.completed}/${progress.total}`
            : result
              ? `${result.successful} ${t('bulk.completedShort', 'analyzed')}`
              : `${t('bulk.analyze', 'Analyze')} ${eligibleSessions.length} ${eligibleSessions.length === 1 ? t('bulk.session', 'Session') : t('bulk.sessions', 'Sessions')}`}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('bulk.title', 'Bulk Analysis')}</DialogTitle>
          <DialogDescription>
            {t('bulk.generate', 'Generate AI insights for')} {eligibleSessions.length} {eligibleSessions.length === 1 ? t('bulk.selectedSession', 'selected session') : t('bulk.selectedSessions', 'selected sessions')}.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {!analyzing && !result && (
            <>
              <p className="text-sm text-muted-foreground">
                {t('bulk.desc', 'This uses the automatic analysis runner shown in Settings. With a ChatGPT login, Codex native analysis works without another API key.')}
              </p>
              <Button onClick={handleAnalyze} className="w-full gap-2">
                <Sparkles className="h-4 w-4" />
                {t('bulk.start', 'Start Analysis')}
              </Button>
            </>
          )}

          {analyzing && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span className="text-sm">
                  {t('bulk.progress', 'Analyzing session')} {progress.completed} {t('bulk.of', 'of')} {progress.total}...
                </span>
              </div>
              <div className="w-full bg-muted rounded-full h-2">
                <div
                  className="h-2 rounded-full bg-primary transition-[width]"
                  style={{ width: `${progress.total > 0 ? (progress.completed / progress.total) * 100 : 0}%` }}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                {t('bulk.backgroundHint', 'You can close this window and continue using the dashboard. Analysis will keep running in the background.')}
              </p>
              <Button variant="outline" onClick={() => setOpen(false)} className="w-full">
                {t('bulk.continueInBackground', 'Continue in background')}
              </Button>
            </div>
          )}

          {result && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-green-600">
                <CheckCircle className="h-4 w-4" />
                <span>
                  {result.successful} {result.successful === 1 ? t('bulk.sessionLower', 'session') : t('bulk.sessionsLower', 'sessions')} {t('bulk.success', 'analyzed successfully')}
                </span>
              </div>
              {result.failed > 0 && (
                <div className="space-y-1">
                  <div className="flex items-center gap-2 text-red-500">
                    <AlertCircle className="h-4 w-4" />
                    <span>{result.failed} {t('bulk.failed', 'failed')}</span>
                  </div>
                  <ul className="text-xs text-muted-foreground list-disc list-inside max-h-32 overflow-y-auto">
                    {result.errors.slice(0, 5).map((err, i) => (
                      <li key={i} className="truncate">{err}</li>
                    ))}
                    {result.errors.length > 5 && (
                      <li>...and {result.errors.length - 5} more</li>
                    )}
                  </ul>
                </div>
              )}
              <Button onClick={resetAndClose} className="w-full">
                {t('bulk.done', 'Done')}
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
