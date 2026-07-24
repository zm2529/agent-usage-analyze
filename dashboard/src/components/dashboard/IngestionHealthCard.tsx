import { Database, History, ShieldCheck, TriangleAlert } from 'lucide-react';
import type { IngestionHealth } from '@/lib/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useLanguage } from '@/i18n/LanguageProvider';

export function IngestionHealthCard({ health }: { health: IngestionHealth }) {
  const { t } = useLanguage();
  const { coverage } = health;

  return (
    <Card aria-label="Canonical ingestion coverage">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <ShieldCheck className="h-4 w-4 text-emerald-600" />
          <span role="heading" aria-level={2}>{t('ingestion.health', 'Ingestion health')}</span>
          <span className="ml-auto text-xs font-normal text-muted-foreground">
            {health.status === 'never-run'
              ? t('ingestion.never', 'Not run')
              : health.status === 'running'
                ? t('ingestion.running', 'Running')
              : health.status === 'completed-with-errors'
                ? t('ingestion.completedErrors', 'Completed with errors')
                : health.status === 'failed'
                  ? t('ingestion.failed', 'Failed')
                  : t('ingestion.completed', 'Completed')}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3 text-xs sm:grid-cols-3">
        <div className="flex items-start gap-2">
          <Database className="mt-0.5 h-4 w-4 text-muted-foreground" />
          <div>
            <p className="font-medium">{coverage.parsed} {t('ingestion.parsed', 'parsed events')}</p>
            <p className="text-muted-foreground">{health.eventCount} {t('ingestion.eventsFrom', 'events from')} {health.sourceCount} {t('ingestion.sources', 'sources')}</p>
          </div>
        </div>
        <div className="flex items-start gap-2">
          <TriangleAlert className="mt-0.5 h-4 w-4 text-amber-600" />
          <div>
            <p className="font-medium">{coverage.unknown} {t('ingestion.unmodeled', 'unmodeled protocol events')}</p>
            <p className="text-muted-foreground">{coverage.failed} {t('ingestion.failedCount', 'failed')} · {coverage.skipped} {t('ingestion.skipped', 'skipped')}</p>
            <p className="mt-1 text-[11px] leading-4 text-muted-foreground">
              {t('ingestion.unmodeledExplain', 'Recognized as source protocol events but not mapped into the analysis model. They are not failures and are excluded from scoring.')}
            </p>
          </div>
        </div>
        <div className="flex items-start gap-2">
          <History className="mt-0.5 h-4 w-4 text-muted-foreground" />
          <div className="space-y-1">
            {health.eras.length === 0 ? (
              <p className="text-muted-foreground">{t('ingestion.noEra', 'No observation era yet')}</p>
            ) : health.eras.map((era) => (
              <div key={era.id}>
                <p className="font-medium">
                  {era.mode === 'historical-backfill' ? t('ingestion.backfill', 'Historical backfill') : t('ingestion.continuous', 'Continuous observation')}
                </p>
                <p className="text-muted-foreground">{era.parserVersion}</p>
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
