import { useQuery } from '@tanstack/react-query';
import { FlaskConical, ShieldAlert } from 'lucide-react';
import { fetchBuildermarkGateState } from '@/lib/api';
import type { BuildermarkGateState } from '@/lib/types';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

const STATUS_COPY: Record<BuildermarkGateState['status'], { label: string; detail: string }> = {
  disabled: {
    label: 'Disabled',
    detail: 'No isolated gate has run. Core structural analysis continues without Buildermark.',
  },
  testing: {
    label: 'Testing',
    detail: 'A local gate is running. Its candidates cannot affect product conclusions.',
  },
  passed: {
    label: 'Passed',
    detail: 'The latest gate passed. Experimental use still preserves evidence tiers and uncertainty.',
  },
  failed: {
    label: 'Failed',
    detail: 'The latest gate failed. The helper is disabled and core structural analysis remains available.',
  },
};

export function BuildermarkGateStatusCard({ state }: { state: BuildermarkGateState }) {
  const copy = STATUS_COPY[state.status];
  const report = state.latestRun;
  return (
    <Card aria-label="Buildermark historical helper gate">
      <CardHeader>
        <div className="flex items-center gap-2">
          <FlaskConical className="h-5 w-5" />
          <CardTitle className="text-base">Buildermark historical helper</CardTitle>
          <Badge className="ml-auto" variant={state.status === 'passed' ? 'default' : 'secondary'}>
            {copy.label}
          </Badge>
        </div>
        <CardDescription>{copy.detail}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div className="flex items-start gap-2 rounded-md border bg-muted/40 p-3">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <p>Buildermark candidates are experimental evidence, never certain ownership.</p>
        </div>
        <div className="grid gap-2 text-xs sm:grid-cols-3">
          <p>Synthetic gate: <strong>{state.syntheticGatePassed ? 'passed' : 'not passed'}</strong></p>
          <p>Real-history gate: <strong>{state.realGatePassed ? 'passed' : 'not passed'}</strong></p>
          <p>Experiment: <strong>{state.experimentalEnabled ? 'enabled' : 'disabled'}</strong></p>
        </div>
        {state.stateError === 'corrupt-report' && (
          <p className="text-xs text-destructive">Stored gate report failed integrity validation. The experiment is disabled.</p>
        )}
        {report && (
          <div className="space-y-1 text-xs text-muted-foreground">
            <p>{report.mode} run · {report.importedCommits}/{report.referencedCommits} commits · {report.candidates} candidates</p>
            <p>
              Evidence: exact {report.evidenceCounts.exact} · formatting {report.evidenceCounts.formatting}
              {' '}· fallback {report.evidenceCounts.fallback} · deletion {report.evidenceCounts.deletion}
            </p>
            {report.failureCodes.length > 0 && <p>Gate reasons: {report.failureCodes.join(', ')}</p>}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function BuildermarkGateCard() {
  const query = useQuery({ queryKey: ['buildermark-gate'], queryFn: fetchBuildermarkGateState, retry: false });
  if (query.isError) {
    return (
      <Card aria-label="Buildermark historical helper gate">
        <CardHeader>
          <div className="flex items-center gap-2">
            <FlaskConical className="h-5 w-5" />
            <CardTitle className="text-base">Buildermark historical helper</CardTitle>
            <Badge className="ml-auto" variant="secondary">Status unavailable</Badge>
          </div>
          <CardDescription>The helper is treated as disabled until local state can be read.</CardDescription>
        </CardHeader>
      </Card>
    );
  }
  if (!query.data) {
    return <Card><CardContent className="p-4 text-sm text-muted-foreground">Loading Buildermark gate status…</CardContent></Card>;
  }
  return <BuildermarkGateStatusCard state={query.data} />;
}
