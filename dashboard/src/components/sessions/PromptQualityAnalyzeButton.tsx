import { Button } from '@/components/ui/button';
import { useAnalysis } from '@/components/analysis/AnalysisContext';
import { useLlmConfig } from '@/hooks/useConfig';
import type { Session } from '@/lib/types';
import { Link } from 'react-router';
import { Loader2, Target } from 'lucide-react';
import { useLanguage } from '@/i18n/LanguageProvider';
import { isAutomaticAnalysisAvailable } from '@/lib/analysis-availability';

/** Minimal analyze button for the Prompt Quality empty state. */
export function PromptQualityAnalyzeButton({ session }: { session: Session }) {
  const { t } = useLanguage();
  const { getAnalysisState, startAnalysis } = useAnalysis();
  const { data: llmConfig } = useLlmConfig();
  const configured = isAutomaticAnalysisAvailable(llmConfig);

  const analysisState = getAnalysisState(session.id, 'prompt_quality');
  const isAnalyzing = analysisState?.status === 'analyzing';

  if (!configured) {
    return (
      <Link to="/settings" className="text-xs text-muted-foreground underline hover:text-foreground">
        {t('analysis.configure', 'Configure AI in Settings')}
      </Link>
    );
  }

  return (
    <Button
      onClick={() => startAnalysis(session, 'prompt_quality')}
      disabled={isAnalyzing}
      className="gap-2"
    >
      {isAnalyzing ? (
        <>
          <Loader2 className="h-4 w-4 animate-spin" />
          {t('analysis.analyzing', 'Analyzing…')}
        </>
      ) : (
        <>
          <Target className="h-4 w-4" />
          {t('analysis.analyze', 'Analyze')}
        </>
      )}
    </Button>
  );
}
