import { useEffect, useRef, useState } from 'react';
import { LoaderCircle } from 'lucide-react';
import type { IngestionHealth } from '@/lib/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useLanguage } from '@/i18n/LanguageProvider';
import { estimateRemainingMs, type ProgressSample } from '@/lib/ingestion-eta';

function durationLabel(milliseconds: number, language: 'en' | 'zh-CN'): string {
  const seconds = Math.max(1, Math.round(milliseconds / 1_000));
  if (seconds < 60) return language === 'zh-CN' ? `${seconds} 秒` : `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  if (language === 'zh-CN') return remainder ? `${minutes} 分 ${remainder} 秒` : `${minutes} 分钟`;
  return remainder ? `${minutes}m ${remainder}s` : `${minutes}m`;
}

export function IngestionProgressCard({ health }: { health: IngestionHealth }) {
  const { language, t } = useLanguage();
  const total = health.coverage.discovered;
  const completed = Math.min(health.processedSources, total);
  const percent = total > 0 ? Math.round((completed / total) * 100) : 0;
  const elapsed = health.startedAt ? Math.max(0, Date.now() - Date.parse(health.startedAt)) : 0;
  const samples = useRef<ProgressSample[]>([]);
  const [remaining, setRemaining] = useState<number | null>(null);
  useEffect(() => {
    const at = Date.now();
    const previous = samples.current.at(-1);
    if (!previous || previous.completed !== completed) {
      samples.current = [...samples.current, { completed, at }].slice(-12);
    }
    setRemaining(estimateRemainingMs(samples.current, total));
  }, [completed, total]);

  return (
    <Card className="border-primary/30 bg-primary/[0.04]" aria-label={t('import.title', 'Importing Codex history in the background')}>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <LoaderCircle className="h-4 w-4 animate-spin text-primary" />
          {t('import.title', 'Importing Codex history in the background')}
          <span className="ml-auto text-sm font-semibold tabular-nums">{percent}%</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        <p className="text-muted-foreground">
          {t('import.what', 'Scanning local Codex sessions and building task, delivery-evidence, and behavior-analysis indexes. You can keep using the WebUI.')}
        </p>
        <div className="h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
          <div className="h-full rounded-full bg-primary transition-[width] duration-500" style={{ width: `${percent}%` }} />
        </div>
        <p className="text-xs text-muted-foreground">
          {t('import.progress', 'Processed')} {completed}/{total} {t('import.files', 'session files')}
          {' · '}{t('import.elapsed', 'elapsed')} {durationLabel(elapsed, language)}
          {' · '}{completed >= total && total > 0
            ? t('import.indexing', 'building the final task index')
            : remaining === null
            ? t('import.estimating', 'estimating time remaining')
            : `${t('import.eta', 'ETA')} ${durationLabel(remaining, language)}`}
        </p>
      </CardContent>
    </Card>
  );
}
