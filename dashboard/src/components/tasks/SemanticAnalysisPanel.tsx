import { useCallback, useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { fetchSemanticClaims, previewSemanticAnalysis, recordAdvisoryOverhead, runSemanticAnalysis } from '@/lib/api';
import { eventAnchorHref } from '@/lib/event-links';

export function SemanticAnalysisPanel({ taskId }: { taskId: string }) {
  const queryClient = useQueryClient();
  const shownClaims = useRef(new Set<string>());
  const shownAttempts = useRef(new Set<string>());
  const [shownAccounting, setShownAccounting] = useState<Record<string, 'recording' | 'recorded' | 'degraded' | 'unavailable'>>({});
  const [claimActions, setClaimActions] = useState<Record<string, string>>({});
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
  const recordShown = useCallback((claimId: string) => {
    if (shownClaims.current.has(claimId) || shownAttempts.current.has(claimId)) return;
    shownAttempts.current.add(claimId);
    setShownAccounting((current) => ({ ...current, [claimId]: 'recording' }));
    void recordAdvisoryOverhead({ claimId, action: 'shown' }).then((result) => {
      shownAttempts.current.delete(claimId);
      if (result.recorded) shownClaims.current.add(claimId);
      setShownAccounting((current) => ({
        ...current, [claimId]: result.recorded ? 'recorded' : 'degraded',
      }));
    }).catch(() => {
      shownAttempts.current.delete(claimId);
      setShownAccounting((current) => ({ ...current, [claimId]: 'unavailable' }));
    });
  }, []);

  useEffect(() => {
    if (preview.data?.status !== 'ready') return;
    for (const claim of claims.data?.claims ?? []) {
      if (claim.claimType === 'improvement-advice') recordShown(claim.id);
    }
  }, [claims.data, preview.data, recordShown]);

  const recordAction = (claimId: string, action: 'adopted' | 'ignored' | 'dismissed') => {
    void recordAdvisoryOverhead({ claimId, action }).then((result) => {
      setClaimActions((current) => ({ ...current, [claimId]: result.recorded ? action : 'degraded' }));
    }).catch(() => {
      setClaimActions((current) => ({ ...current, [claimId]: 'unavailable' }));
    });
  };

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
              {claim.claimType === 'improvement-advice' && (
                <div className="mt-2 flex flex-wrap items-center gap-1">
                  <Button size="sm" variant="outline" onClick={() => recordAction(claim.id, 'adopted')}>Mark adopted</Button>
                  <Button size="sm" variant="ghost" onClick={() => recordAction(claim.id, 'ignored')}>Ignore</Button>
                  <Button size="sm" variant="ghost" onClick={() => recordAction(claim.id, 'dismissed')}>Dismiss</Button>
                  {shownAccounting[claim.id] === 'degraded' || shownAccounting[claim.id] === 'unavailable' ? (
                    <span className="text-xs text-destructive">
                      Display not recorded: {shownAccounting[claim.id]}.{' '}
                      <button className="underline" onClick={() => recordShown(claim.id)}>Retry display accounting</button>
                    </span>
                  ) : null}
                  {claimActions[claim.id] && (
                    <span className={claimActions[claim.id] === 'degraded' || claimActions[claim.id] === 'unavailable'
                      ? 'text-xs text-destructive' : 'text-xs text-muted-foreground'}>
                      {claimActions[claim.id] === 'degraded' || claimActions[claim.id] === 'unavailable'
                        ? `Not recorded: ${claimActions[claim.id]}` : `Recorded: ${claimActions[claim.id]}`}
                    </span>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
