import { Gauge, RotateCcw } from 'lucide-react';
import { useCodexAccountUsage } from '@/hooks/useAnalytics';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useLanguage } from '@/i18n/LanguageProvider';

function resetLabel(epochSeconds: number | null, language: 'en' | 'zh-CN'): string {
  if (!epochSeconds) return language === 'zh-CN' ? '未知' : 'Unknown';
  return new Date(epochSeconds * 1_000).toLocaleString(language === 'zh-CN' ? 'zh-CN' : undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

export function CodexUsageCard() {
  const { language, t } = useLanguage();
  const usage = useCodexAccountUsage();
  if (usage.isLoading) return null;
  const data = usage.data;
  if (!data?.available) {
    return (
      <Card className="border-dashed">
        <CardContent className="py-3 text-xs text-muted-foreground">
          {t('codexUsage.unavailable', 'Codex quota is temporarily unavailable. Session token totals still come from local Codex rollout events.')}
        </CardContent>
      </Card>
    );
  }
  const primaryBucket = data.rateLimits.find((item) => item.limitId === 'codex') ?? data.rateLimits[0];
  if (!primaryBucket) return null;
  return (
    <Card aria-label={t('codexUsage.title', 'Codex usage')}>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Gauge className="h-4 w-4" />
          {t('codexUsage.title', 'Codex usage')}
          <Badge className="ml-auto" variant="secondary">
            {primaryBucket.planType ?? t('codexUsage.unknownPlan', 'Unknown plan')}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-xs">
        {primaryBucket.primary && (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span>{primaryBucket.limitName ?? t('codexUsage.mainWindow', 'Main usage window')}</span>
              <span className="font-semibold tabular-nums">{primaryBucket.primary.usedPercent}%</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={primaryBucket.primary.usedPercent}>
              <div className="h-full rounded-full bg-primary" style={{ width: `${primaryBucket.primary.usedPercent}%` }} />
            </div>
            <p className="flex items-center gap-1 text-muted-foreground">
              <RotateCcw className="h-3 w-3" />
              {t('codexUsage.resetAt', 'Resets at')} {resetLabel(primaryBucket.primary.resetsAt, language)}
            </p>
          </div>
        )}
        <p className="text-muted-foreground">
          {t('codexUsage.source', 'Quota comes from the official local Codex app-server API. Per-session tokens come from Codex token_count events; no private auth files are read.')}
        </p>
        {data.resetCreditsAvailable !== null && data.resetCreditsAvailable > 0 && (
          <div className="space-y-1">
            <p>{t('codexUsage.resets', 'Available full resets')}: {data.resetCreditsAvailable}</p>
            {data.resetCredits.map((credit, index) => (
              <p key={`${credit.grantedAt ?? 'unknown'}-${credit.expiresAt ?? index}`} className="pl-4 text-muted-foreground">
                {t('codexUsage.resetCredit', 'Reset')} {index + 1} · {t('codexUsage.grantedAt', 'granted')} {resetLabel(credit.grantedAt, language)} · {t('codexUsage.expiresAt', 'expires')} {resetLabel(credit.expiresAt, language)}
              </p>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
