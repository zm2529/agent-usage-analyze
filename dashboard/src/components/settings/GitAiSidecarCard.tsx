import { useQuery } from '@tanstack/react-query';
import { GitBranch, ShieldAlert } from 'lucide-react';
import { fetchGitAiSidecarState } from '@/lib/api';
import type { GitAiSidecarState } from '@/lib/types';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

const STATUS_COPY: Record<GitAiSidecarState['status'], { label: string; detail: string }> = {
  disabled: { label: 'Disabled', detail: 'No prospective gate has run. Core analysis continues without Git AI.' },
  testing: { label: 'Testing', detail: 'The disposable prospective matrix is still under evaluation.' },
  passed: { label: 'Passed', detail: 'The safety matrix passed; consumption still requires explicit local configuration.' },
  failed: { label: 'Failed', detail: 'The sidecar evidence path is disabled; structural analysis remains available.' },
};

export function GitAiSidecarStatusCard({ state }: { state: GitAiSidecarState }) {
  const copy = STATUS_COPY[state.status];
  return (
    <Card aria-label="Git AI prospective sidecar">
      <CardHeader>
        <div className="flex items-center gap-2">
          <GitBranch className="h-5 w-5" />
          <CardTitle className="text-base">Git AI prospective sidecar</CardTitle>
          <Badge className="ml-auto" variant={state.status === 'passed' ? 'default' : 'secondary'}>{copy.label}</Badge>
        </div>
        <CardDescription>{copy.detail}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div className="flex items-start gap-2 rounded-md border bg-muted/40 p-3">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <p>Git AI provenance is candidate evidence, never a quality score or certain ownership.</p>
        </div>
        <div className="grid gap-2 text-xs sm:grid-cols-2">
          <p>Frozen source: <strong>{state.sourceVersion}</strong> · {state.notesSchema}</p>
          <p>Notes policy: <strong>{state.notesExportPolicy}</strong></p>
          <p>Gate: <strong>{state.gatePassed ? 'passed' : 'not passed'}</strong></p>
          <p>Consumption: <strong>{state.consumptionEnabled ? 'enabled' : 'disabled'}</strong></p>
          <p>Binary health: <strong>{state.binaryHealthy ? `healthy · ${state.binaryVersion}` : 'unknown or failed'}</strong></p>
        </div>
        <p className="text-xs text-muted-foreground">
          Product configuration does not install hooks or push Notes; repository activation and any export remain explicit local actions.
        </p>
        {state.stateError && (
          <p className="text-xs text-destructive">
            {state.stateError === 'corrupt-report'
              ? 'Stored gate report failed integrity validation.'
              : state.stateError === 'corrupt-config'
                ? 'Sidecar configuration is corrupt.'
                : state.stateError === 'config-unavailable'
                  ? 'Sidecar configuration cannot be read.'
                  : 'Sidecar source or binary health could not be verified.'} Sidecar consumption is disabled.
          </p>
        )}
        {state.latestRun && (
          <div className="space-y-1 text-xs text-muted-foreground">
            <p>{state.latestRun.candidateEvidence} candidate evidence · {state.latestRun.abstentions} abstentions</p>
            {state.latestRun.scenarios.map((scenario) => (
              <p key={scenario.kind}>
                {scenario.kind} · {scenario.support} · {scenario.outcome}
                {scenario.reason ? ` · ${scenario.reason}` : ''}
              </p>
            ))}
            {state.latestRun.failureCodes.length > 0 && <p>Gate reasons: {state.latestRun.failureCodes.join(', ')}</p>}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function GitAiSidecarCard() {
  const query = useQuery({ queryKey: ['git-ai-sidecar'], queryFn: fetchGitAiSidecarState, retry: false });
  if (query.isError) {
    return (
      <Card aria-label="Git AI prospective sidecar">
        <CardHeader>
          <div className="flex items-center gap-2">
            <GitBranch className="h-5 w-5" />
            <CardTitle className="text-base">Git AI prospective sidecar</CardTitle>
            <Badge className="ml-auto" variant="secondary">Status unavailable</Badge>
          </div>
          <CardDescription>Sidecar consumption is treated as disabled until local state can be read.</CardDescription>
        </CardHeader>
      </Card>
    );
  }
  if (!query.data) return <Card><CardContent className="p-4 text-sm text-muted-foreground">Loading Git AI sidecar status…</CardContent></Card>;
  return <GitAiSidecarStatusCard state={query.data} />;
}
