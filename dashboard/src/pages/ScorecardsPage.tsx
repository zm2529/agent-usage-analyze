import { Link } from 'react-router';
import { AlertCircle, CheckCircle2, Scale } from 'lucide-react';
import { useScorecards } from '@/hooks/useScorecards';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ErrorCard } from '@/components/ErrorCard';
import { Skeleton } from '@/components/ui/skeleton';
import type { ScorecardResult, ScorecardStatus, ScorecardVersion } from '@/lib/types';
import { eventAnchorHref } from '@/lib/event-links';

const STATUS_LABEL: Record<ScorecardStatus, string> = {
  draft: 'Draft', calibrating: 'Calibrating', active: 'Active', retired: 'Retired',
};
const REASON_LABEL: Record<NonNullable<ScorecardResult['unavailableReason']>, string> = {
  'scorecard-not-active': 'The scorecard is not active.',
  'calibration-not-passed': 'Calibration has not passed.',
  'quality-gate-failed': 'The quality gate failed.',
  'safety-gate-failed': 'The safety gate failed.',
  'insufficient-coverage': 'Evidence coverage is below the version threshold.',
  'missing-feature': 'A required feature is unknown.',
  'task-not-found': 'The analyzed task is not present in canonical evidence.',
  'out-of-scope': 'The task is outside this scorecard version scope.',
};

function VersionCard({ version }: { version: ScorecardVersion }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <div><CardTitle className="text-sm">{version.name}</CardTitle><p className="text-xs text-muted-foreground">{version.version}</p></div>
          <Badge variant={version.status === 'active' ? 'default' : 'secondary'}>{STATUS_LABEL[version.status]}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 text-xs">
        <section><p className="font-medium">Features and missing rules</p><div className="mt-1 flex flex-wrap gap-1">{version.features.map((feature) => <Badge key={feature.key} variant="outline">{feature.label} · {(feature.weight * 100).toFixed(0)}% · {feature.key} → {version.missingRules[feature.key]}</Badge>)}</div></section>
        <section><p className="font-medium">Quality gates</p><div className="mt-1 flex flex-wrap gap-1">{version.qualityGates.map((gate) => <Badge key={gate} variant="outline">{gate}</Badge>)}</div></section>
        <section><p className="font-medium">Safety gates</p><div className="mt-1 flex flex-wrap gap-1">{version.safetyGates.map((gate) => <Badge key={gate} variant="outline">{gate}</Badge>)}</div></section>
        <p className="text-muted-foreground">Scope {version.scope.kind}{version.scope.taskRole ? ` · role ${version.scope.taskRole}` : ' · all observed task roles'} · coverage ≥ {(version.thresholds.minimumCoverage * 100).toFixed(0)}% · calibration {version.calibrationDataVersion ?? 'not set'}</p>
        <details><summary className="cursor-pointer font-medium">Version evidence</summary><p className="mt-1 break-all text-muted-foreground">{version.evidenceRefs.join(', ')}</p></details>
      </CardContent>
    </Card>
  );
}

function ResultCard({ result, version }: { result: ScorecardResult; version?: ScorecardVersion }) {
  const available = result.indexValue !== null;
  return (
    <Card>
      <CardContent className="flex items-start gap-3 p-3">
        {available ? <CheckCircle2 className="mt-0.5 h-4 w-4 text-emerald-600" /> : <AlertCircle className="mt-0.5 h-4 w-4 text-amber-600" />}
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div><Link className="text-sm font-medium underline-offset-2 hover:underline" to={`/tasks/${encodeURIComponent(result.rootTaskId)}`}>{result.taskId}</Link><p className="text-xs text-muted-foreground">{version?.version ?? result.scorecardVersionId}</p></div>
            {available ? <span className="text-xl font-bold tabular-nums">{result.indexValue!.toFixed(1)}</span> : <Badge variant="secondary">No effective delivery index</Badge>}
          </div>
          <p className="mt-2 text-xs">{available
            ? `${version?.version ?? 'Version'} · quality, safety, coverage, and calibration gates passed.`
            : REASON_LABEL[result.unavailableReason!]}</p>
          <p className="mt-1 text-xs text-muted-foreground">Coverage {(result.coverage * 100).toFixed(0)}% · uncertainty {(result.uncertainty * 100).toFixed(0)}% · evidence {result.evidenceRefs.join(', ')}</p>
          <div className="mt-2 flex flex-wrap gap-1">
            <Badge variant={result.gateResults.quality ? 'outline' : 'destructive'}>Quality {result.gateResults.quality ? 'passed' : 'failed'}</Badge>
            <Badge variant={result.gateResults.safety ? 'outline' : 'destructive'}>Safety {result.gateResults.safety ? 'passed' : 'failed'}</Badge>
            <Badge variant={result.gateResults.calibration ? 'outline' : 'destructive'}>Calibration {result.gateResults.calibration ? 'passed' : 'failed'}</Badge>
          </div>
          <div className="mt-2 flex flex-wrap gap-1">{Object.entries(result.rawFeatures).map(([key, value]) => <Badge key={key} variant="outline">{key}: {value === null ? 'unknown' : value.toFixed(2)}</Badge>)}</div>
          <details className="mt-2"><summary className="cursor-pointer text-xs font-medium">Result evidence</summary><div className="mt-1 flex flex-wrap gap-1">{result.evidenceRefs.map((ref) => {
            const links = result.evidenceLinks.filter((link) => link.ref === ref);
            return links.length > 0
              ? links.map((link) => <Link key={`${ref}:${link.eventId}`} className="break-all text-xs underline" to={eventAnchorHref(link.rootTaskId, link.eventId)}>{ref} → {link.eventId}</Link>)
              : <code key={ref} className="break-all text-xs">{ref} (reference only)</code>;
          })}</div></details>
        </div>
      </CardContent>
    </Card>
  );
}

export default function ScorecardsPage() {
  const { data, isLoading, isError, refetch } = useScorecards();
  const versions = data?.versions ?? [];
  const versionById = new Map(versions.map((version) => [version.id, version]));
  return (
    <div className="space-y-4 p-3 lg:p-4">
      <div><div className="flex items-center gap-2"><Scale className="h-5 w-5" /><h1 className="text-lg font-bold">Scorecards</h1></div><p className="mt-1 text-xs text-muted-foreground">Versioned, evidence-linked diagnostics. A personal index appears only for an active, calibrated, fully gated result.</p></div>
      {isError ? <ErrorCard message="Failed to load scorecards" onRetry={() => { void refetch(); }} />
        : isLoading ? <Skeleton className="h-40 w-full" /> : <>
        <section><h2 className="mb-2 text-sm font-semibold">Versions</h2><div className="grid gap-3 lg:grid-cols-2">{versions.map((version) => <VersionCard key={version.id} version={version} />)}{versions.length === 0 && <p className="text-sm text-muted-foreground">No scorecard versions yet.</p>}</div></section>
        <section><h2 className="mb-2 text-sm font-semibold">Results</h2><div className="space-y-2">{data?.results.map((result) => <ResultCard key={result.id} result={result} version={versionById.get(result.scorecardVersionId)} />)}{data?.results.length === 0 && <p className="text-sm text-muted-foreground">No scorecard results yet.</p>}</div></section>
      </>}
    </div>
  );
}
