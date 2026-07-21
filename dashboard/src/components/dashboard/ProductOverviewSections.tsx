import { ArrowRight, BellRing, Scale, TrendingUp } from 'lucide-react';
import { Link } from 'react-router';
import { useAdvice } from '@/hooks/useAdvice';
import { useScorecards } from '@/hooks/useScorecards';
import { eventAnchorHref } from '@/lib/event-links';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export function ProductOverviewSections() {
  const advice = useAdvice();
  const activeAdvice = advice.data?.active[0];

  return (
    <div className="grid gap-2 lg:grid-cols-2">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle role="heading" aria-level={2} className="flex items-center gap-2 text-sm">
            <TrendingUp className="h-4 w-4" />Period changes
          </CardTitle>
        </CardHeader>
        <CardContent className="text-xs">
          <p className="text-muted-foreground">Compare equal observation windows with coverage, unknown, and incomparable states intact.</p>
          <Link className="mt-2 inline-flex items-center gap-1 font-medium underline-offset-2 hover:underline" to="/patterns">
            Review observed changes <ArrowRight className="h-3 w-3" />
          </Link>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle role="heading" aria-level={2} className="flex items-center gap-2 text-sm">
            <BellRing className="h-4 w-4" />Active suggestions
          </CardTitle>
        </CardHeader>
        <CardContent className="text-xs">
          {advice.isLoading ? <p className="text-muted-foreground">Loading suggestions…</p>
            : advice.isError ? <p className="text-destructive">Suggestions unavailable.</p>
              : activeAdvice ? <>
                <p>{activeAdvice.triggerFact}</p>
                <p className="mt-1 text-muted-foreground">Non-blocking · coverage {(activeAdvice.coverage * 100).toFixed(0)}%</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {activeAdvice.evidenceRefs.map((eventId) => (
                    <Link key={eventId} className="font-mono underline" to={eventAnchorHref(activeAdvice.taskId, eventId)}>
                      Evidence {eventId}
                    </Link>
                  ))}
                  <Link className="font-medium underline" to="/advice">All advice</Link>
                </div>
              </> : <p className="text-muted-foreground">No active suggestions.</p>}
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
