import { BrainCircuit, LoaderCircle } from 'lucide-react';
import { useAnalysisQueue } from '@/hooks/useAnalysisQueue';
import { Card, CardContent } from '@/components/ui/card';
import { useLanguage } from '@/i18n/LanguageProvider';

export function AnalysisProgressCard() {
  const { t } = useLanguage();
  const queue = useAnalysisQueue();
  const active = (queue.data?.pending ?? 0) + (queue.data?.processing ?? 0);
  if (active === 0) return null;
  const processing = queue.data?.processing ?? 0;
  const etaMinutes = Math.max(1, Math.ceil(active * 45 / 60));
  return (
    <Card className="border-primary/30 bg-primary/[0.04]" aria-label={t('llmProgress.title', 'LLM behavior analysis is running')}>
      <CardContent className="flex items-start gap-3 py-3 text-sm">
        {processing > 0
          ? <LoaderCircle className="mt-0.5 h-4 w-4 animate-spin text-primary" />
          : <BrainCircuit className="mt-0.5 h-4 w-4 text-primary" />}
        <div>
          <p className="font-medium">{t('llmProgress.title', 'LLM behavior analysis is running')}</p>
          <p className="text-xs text-muted-foreground">
            {t('llmProgress.desc', 'The dashboard remains usable. Results appear automatically as sessions finish.')}
            {' · '}{active} {t('llmProgress.remaining', 'remaining')}
            {' · '}{t('llmProgress.eta', 'estimated')} {etaMinutes} {t('llmProgress.minutes', 'min')}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
