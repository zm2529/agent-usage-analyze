import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { fetchSemanticClaims, previewSemanticAnalysis, runSemanticAnalysis } from '@/lib/api';
import { eventAnchorHref } from '@/lib/event-links';

export function SemanticAnalysisPanel({ taskId }: { taskId: string }) {
  const queryClient = useQueryClient();
  const preview = useQuery({
    queryKey: ['semantic-preview', taskId],
    queryFn: () => previewSemanticAnalysis(taskId),
    retry: false,
  });
  const claims = useQuery({
    queryKey: ['semantic-claims', taskId],
    queryFn: () => fetchSemanticClaims(taskId),
    retry: false,
  });
  const analyze = useMutation({
    mutationFn: () => runSemanticAnalysis(taskId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['semantic-claims', taskId] }),
  });

  if (preview.isError) {
    return (
      <Card aria-label="Semantic analysis">
        <CardHeader><CardTitle>Semantic analysis unavailable</CardTitle></CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Deterministic patterns remain available; no semantic request was sent.
        </CardContent>
      </Card>
    );
  }
  if (!preview.data) {
    return <Card><CardContent className="p-4 text-sm text-muted-foreground">Loading semantic analysis status…</CardContent></Card>;
  }
  if (preview.data.status === 'disabled') {
    return (
      <Card aria-label="Semantic analysis">
        <CardHeader>
          <CardTitle>Semantic analysis disabled</CardTitle>
          <CardDescription>Deterministic patterns remain available. No evidence is sent to a model.</CardDescription>
        </CardHeader>
        <CardContent className="text-sm"><Link className="underline" to="/settings">Enable in Settings</Link></CardContent>
      </Card>
    );
  }
  const state = preview.data;
  return (
    <Card aria-label="Semantic analysis">
      <CardHeader>
        <div className="flex items-center gap-2">
          <CardTitle>Semantic analysis</CardTitle>
          <Badge className="ml-auto" variant="secondary">Explicit opt-in</Badge>
        </div>
        <CardDescription>{state.provider} · {state.model} · {state.locality}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p>
          {state.evidenceScope.firstTurn ?? 'no turn'} → {state.evidenceScope.lastTurn ?? 'no turn'} ·{' '}
          {state.evidenceScope.turnCount} turns · {state.evidenceScope.eventCount} events ·{' '}
          {Math.round(state.inputCoverage * 100)}% coverage
        </p>
        <p>
          Estimated input {state.estimatedInputTokens} tokens · estimated cost{' '}
          {state.estimatedCostUsd === null ? 'unavailable' : `$${state.estimatedCostUsd.toFixed(6)}`}
        </p>
        <p className="text-xs text-muted-foreground">
          Only a redacted, turn-safe evidence packet is sent. Historical text is treated as untrusted data.
        </p>
        <Button onClick={() => analyze.mutate()} disabled={analyze.isPending}>
          {analyze.isPending ? 'Analyzing…' : 'Run semantic analysis'}
        </Button>
        {analyze.data && analyze.data.status !== 'accepted' && (
          <p className="text-xs text-destructive">Semantic result: {analyze.data.status} · {analyze.data.reason}</p>
        )}
        {analyze.isError && (
          <p className="text-xs text-destructive">
            Semantic request failed. Deterministic patterns remain available.
          </p>
        )}
        {claims.isError && <p className="text-xs text-destructive">Stored semantic claims are unavailable.</p>}
        <div className="space-y-2">
          {claims.data?.claims.map((claim) => (
            <div key={claim.id} className="rounded-md border p-3">
              <div className="flex items-center gap-2">
                <Badge>LLM-semantic</Badge>
                <strong>{claim.title}</strong>
                <span className="ml-auto text-xs">{Math.round(claim.confidence * 100)}%</span>
              </div>
              <p className="mt-2">{claim.summary}</p>
              <p className="mt-1 text-xs">Expected benefit: {claim.expectedBenefit}</p>
              <p className="text-xs">Verification: {claim.verification}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {claim.run.rubricVersion} · {claim.run.analysisVersion} · {claim.evidenceRefs.length} evidence refs
              </p>
              <p className="mt-1 flex flex-wrap gap-2 text-xs">
                {claim.evidenceRefs.map((eventId) => (
                  <Link key={eventId} className="underline" to={eventAnchorHref(taskId, eventId)}>{eventId}</Link>
                ))}
              </p>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
