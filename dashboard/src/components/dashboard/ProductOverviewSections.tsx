import { ArrowRight, Scale, TrendingUp } from 'lucide-react';
import { Link } from 'react-router';
import { useScorecards } from '@/hooks/useScorecards';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useLanguage } from '@/i18n/LanguageProvider';
import { useLlmConfig } from '@/hooks/useConfig';
import { Badge } from '@/components/ui/badge';

export function ProductOverviewSections() {
  const { t } = useLanguage();
  const config = useLlmConfig();
  const runner = config.data?.analysis;
  const llmEnabled = Boolean(runner && ['provider', 'codex-native', 'claude-native'].includes(runner.effectiveRunner));

  return (
    <div>
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center gap-2">
            <CardTitle role="heading" aria-level={2} className="flex items-center gap-2 text-sm">
              <TrendingUp className="h-4 w-4" />{t('analysis.change', 'Behavior analysis')}
            </CardTitle>
            <Badge className="ml-auto" variant={llmEnabled ? 'default' : 'secondary'}>
              {llmEnabled ? t('analysis.llmOn', 'LLM on') : t('analysis.localOnly', 'Local rules')}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="text-xs">
          <p className="text-muted-foreground">{t('analysis.changeDesc', 'LLM session insights run automatically when a supported runner is available. Cross-session patterns stay evidence-backed, and missing evidence remains visible.')}</p>
          {llmEnabled && runner && <p className="mt-1 text-muted-foreground">{runner.effectiveRunner} · {runner.authentication}</p>}
          <Link className="mt-2 inline-flex items-center gap-1 font-medium underline-offset-2 hover:underline" to="/analysis">
            {t('analysis.open', 'Open analysis and improvement tracking')} <ArrowRight className="h-3 w-3" />
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}

export function ActiveScorecardOverview() {
  const scorecards = useScorecards();
  const activeVersion = scorecards.data?.versions.find((version) => version.status === 'active');
  const activeResult = activeVersion
    ? scorecards.data?.results.find((result) =>
        result.scorecardVersionId === activeVersion.id && result.indexValue !== null)
    : undefined;
  if (!activeVersion || !activeResult) return null;
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle role="heading" aria-level={2} className="flex items-center gap-2 text-sm">
          <Scale className="h-4 w-4" />Active scorecard
        </CardTitle>
      </CardHeader>
      <CardContent className="text-xs">
        <p className="text-2xl font-bold tabular-nums">{activeResult.indexValue!.toFixed(1)}</p>
        <p className="text-muted-foreground">{activeVersion.name} · {activeVersion.version} · all gates passed</p>
        <Link className="mt-2 inline-block font-medium underline" to="/scorecards">Open evidence and gates</Link>
      </CardContent>
    </Card>
  );
}
