import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { BellRing } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useAdvice } from '@/hooks/useAdvice';
import { clearAdviceMute, recordAdviceEvent, setAdviceMute } from '@/lib/api';
import { eventAnchorHref } from '@/lib/event-links';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ErrorCard } from '@/components/ErrorCard';
import { Skeleton } from '@/components/ui/skeleton';
import type { AdvisorySuggestion } from '@/lib/types';

function SuggestionCard({ suggestion, muted, interventionId, onRefresh }: {
  suggestion: AdvisorySuggestion; muted: boolean; interventionId?: string; onRefresh: () => void;
}) {
  const [accounting, setAccounting] = useState<string | null>(null);
  const record = async (action: 'adopted' | 'ignored' | 'dismissed') => {
    if (!interventionId) return;
    try {
      const result = await recordAdviceEvent({
        taskId: suggestion.taskId, issueKey: suggestion.issueKey, action, interventionId,
      });
      setAccounting(result.recorded ? `Recorded: ${action}` : 'Not recorded: degraded');
    } catch { setAccounting('Not recorded: unavailable'); }
  };
  const toggleMute = async () => {
    if (muted) await clearAdviceMute({ scopeKind: 'issue', scopeKey: suggestion.issueKey });
    else await setAdviceMute({ scopeKind: 'issue', scopeKey: suggestion.issueKey, mutedUntil: null });
    onRefresh();
  };
  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-start gap-2">
          <div><CardTitle className="text-sm">{suggestion.issueKey}</CardTitle><p className="text-xs text-muted-foreground">Task {suggestion.taskId}</p></div>
          <Badge className="ml-auto" variant={muted ? 'secondary' : 'default'}>{muted ? 'Muted' : 'Active'}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        <p>{suggestion.triggerFact}</p>
        <p className="text-xs">Expected benefit: {suggestion.expectedBenefit}</p>
        <p className="text-xs">Verification: {suggestion.verification}</p>
        <p className="text-xs text-muted-foreground">Confidence {Math.round(suggestion.confidence * 100)}% · coverage {Math.round(suggestion.coverage * 100)}% · {suggestion.sourceCategory}</p>
        <div className="flex flex-wrap gap-2 text-xs">{suggestion.evidenceRefs.map((eventId) => (
          <Link key={eventId} className="underline" to={eventAnchorHref(suggestion.taskId, eventId)}>{eventId}</Link>
        ))}</div>
        <div className="flex flex-wrap items-center gap-1">
          {!muted && <>
            <Button size="sm" variant="outline" disabled={!interventionId} onClick={() => { void record('adopted'); }}>Mark adopted</Button>
            <Button size="sm" variant="ghost" disabled={!interventionId} onClick={() => { void record('ignored'); }}>Ignore</Button>
            <Button size="sm" variant="ghost" disabled={!interventionId} onClick={() => { void record('dismissed'); }}>Dismiss</Button>
          </>}
          <Button size="sm" variant="ghost" onClick={() => { void toggleMute(); }}>
            {muted ? `Unmute ${suggestion.issueKey}` : 'Mute issue'}
          </Button>
          {accounting && <span className="text-xs text-muted-foreground">{accounting}</span>}
        </div>
      </CardContent>
    </Card>
  );
}

export default function AdvicePage() {
  const query = useAdvice();
  const queryClient = useQueryClient();
  const shown = useRef(new Set<string>());
  const shownAttempts = useRef(new Set<string>());
  const [shownAccounting, setShownAccounting] = useState<Record<string, {
    status: 'recording' | 'recorded' | 'degraded' | 'unavailable'; interventionId?: string;
  }>>({});
  const refresh = () => { void queryClient.invalidateQueries({ queryKey: ['advice'] }); };
  const recordShown = useCallback((suggestion: AdvisorySuggestion) => {
    const key = `${suggestion.taskId}:${suggestion.issueKey}`;
    if (shown.current.has(key) || shownAttempts.current.has(key)) return;
    shownAttempts.current.add(key);
    setShownAccounting((current) => ({ ...current, [key]: { status: 'recording' } }));
    void recordAdviceEvent({
      taskId: suggestion.taskId, issueKey: suggestion.issueKey, action: 'shown',
    }).then((result) => {
      shownAttempts.current.delete(key);
      if (result.recorded) shown.current.add(key);
      setShownAccounting((current) => ({
        ...current,
        [key]: result.recorded
          ? { status: 'recorded', interventionId: result.interventionId }
          : { status: 'degraded' },
      }));
    }).catch(() => {
      shownAttempts.current.delete(key);
      setShownAccounting((current) => ({ ...current, [key]: { status: 'unavailable' } }));
    });
  }, []);
  useEffect(() => {
    for (const suggestion of query.data?.active ?? []) {
      recordShown(suggestion);
    }
  }, [query.data, recordShown]);
  if (query.isError) return <main className="p-4"><ErrorCard message="Failed to load advice" onRetry={() => { void query.refetch(); }} /></main>;
  if (!query.data) return <main className="p-4"><Skeleton className="h-40 w-full" /></main>;
  const state = query.data;
  return (
    <main className="space-y-4 p-3 lg:p-4">
      <div><div className="flex items-center gap-2"><BellRing className="h-5 w-5" /><h1 className="text-lg font-bold">Advice</h1></div><p className="mt-1 text-xs text-muted-foreground">Evidence-linked, non-blocking suggestions. The product never edits or sends your prompt.</p></div>
      {state.diagnostics.length > 0 && <p className="text-xs text-amber-700">Degraded: {state.diagnostics.join(', ')}</p>}
      {state.active.map((suggestion) => {
        const key = `${suggestion.taskId}:${suggestion.issueKey}`;
        const accounting = shownAccounting[key]?.status;
        return accounting === 'degraded' || accounting === 'unavailable' ? (
          <p key={`accounting:${key}`} className="text-xs text-destructive">
            Display not recorded: {accounting}{' '}
            <button className="underline" onClick={() => recordShown(suggestion)}>Retry display accounting</button>
          </p>
        ) : null;
      })}
      <section><h2 className="mb-2 text-sm font-semibold">Active suggestions</h2><div className="space-y-2">{state.active.map((item) => {
        const accounting = shownAccounting[`${item.taskId}:${item.issueKey}`];
        return <SuggestionCard key={`${item.taskId}:${item.issueKey}`} suggestion={item} muted={false}
          interventionId={accounting?.interventionId} onRefresh={refresh} />;
      })}{state.active.length === 0 && <p className="text-sm text-muted-foreground">No active suggestions.</p>}</div></section>
      <section><h2 className="mb-2 text-sm font-semibold">Muted suggestions</h2><div className="space-y-2">{state.muted.map((item) => <SuggestionCard key={`${item.taskId}:${item.issueKey}`} suggestion={item} muted onRefresh={refresh} />)}{state.muted.length === 0 && <p className="text-sm text-muted-foreground">No muted suggestions.</p>}</div></section>
      <Card><CardHeader><CardTitle className="text-sm">Observer attention overhead</CardTitle></CardHeader><CardContent className="text-xs">Shown {state.attention.shown} · adopted {state.attention.adopted} · ignored {state.attention.ignored} · dismissed {state.attention.dismissed}</CardContent></Card>
      <section><h2 className="mb-2 text-sm font-semibold">Interaction history</h2><div className="space-y-1 text-xs">{state.history.events.map((event) => <p key={event.id}>{event.issueKey} · {event.action}{event.outcome ? ` ${event.outcome}` : ''} · {event.observationEraId} · coverage {Math.round(event.coverage * 100)}%</p>)}{state.history.events.length === 0 && <p className="text-muted-foreground">No advisory interactions yet.</p>}</div></section>
      {state.history.comparisons.length > 0 && <section><h2 className="mb-2 text-sm font-semibold">Follow-up comparisons</h2>{state.history.comparisons.map((comparison) => <Card key={comparison.interventionId}><CardContent className="space-y-1 p-3 text-xs"><p>{comparison.issueKey}: {comparison.baseline.observationEraId} ({Math.round(comparison.baseline.coverage * 100)}%) → {comparison.followup.observationEraId} ({Math.round(comparison.followup.coverage * 100)}%) · {comparison.followup.outcome}</p><p className="text-muted-foreground">Observational before/after only; no causal claim.</p></CardContent></Card>)}</section>}
    </main>
  );
}
