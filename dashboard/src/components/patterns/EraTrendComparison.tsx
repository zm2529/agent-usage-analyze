import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchPatternTrends } from '@/lib/api';
import type { TrendComparison } from '@/lib/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Link } from 'react-router';
import { eventAnchorHref } from '@/lib/event-links';

function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

export function formatDateTimeLocal(iso: string, offsetMinutes = new Date(iso).getTimezoneOffset()): string {
  const timestamp = Date.parse(iso);
  if (!Number.isFinite(timestamp)) return '';
  return new Date(timestamp - offsetMinutes * 60_000).toISOString().slice(0, 16);
}

export function parseDateTimeLocal(value: string, offsetMinutes?: number): string | null {
  if (!value) return null;
  const localAsUtc = Date.parse(`${value}:00.000Z`);
  if (!Number.isFinite(localAsUtc)) return null;
  const effectiveOffset = offsetMinutes ?? new Date(`${value}:00`).getTimezoneOffset();
  return new Date(localAsUtc + effectiveOffset * 60_000).toISOString();
}

export function TrendComparisonCard({ comparison }: { comparison: TrendComparison }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Observed pattern changes</CardTitle>
        <p className="text-sm text-muted-foreground">
          Equal adjacent windows · {comparison.previousWindow.taskCount} vs {comparison.currentWindow.taskCount} tasks · {comparison.eraCompatibility}
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {comparison.trends.length === 0 && <p className="text-sm text-muted-foreground">No evidence-closed pattern claims in these windows.</p>}
        {comparison.trends.map((trend) => {
          const evidence = [
            ...(trend.previous?.evidence ?? []), ...(trend.current?.evidence ?? []),
            ...trend.conflictingEvidence,
          ];
          return (
            <article key={trend.pattern} className="rounded-lg border p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-medium">{trend.label}</h3>
                <span className="rounded-full border px-2 py-0.5 text-xs">{trend.state}</span>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">{trend.observableFact}</p>
              <p className="mt-2 text-xs text-muted-foreground">
                previous {trend.previous?.sampleCount ?? 0}/{trend.previous?.totalTaskCount ?? comparison.previousWindow.taskCount}
                {' · '}current {trend.current?.sampleCount ?? 0}/{trend.current?.totalTaskCount ?? comparison.currentWindow.taskCount}
                {' · '}change {trend.change === null ? 'unknown' : `${trend.change > 0 ? '+' : ''}${percent(trend.change)}`}
                {' · '}coverage {percent(Math.min(comparison.previousWindow.coverage, comparison.currentWindow.coverage))}
              </p>
              {trend.unknownReason && <p className="mt-1 text-xs text-amber-700">Unknown direction: {trend.unknownReason}</p>}
              {[...new Set([...(trend.previous?.sampleTaskRefs ?? []), ...(trend.current?.sampleTaskRefs ?? [])])].length > 0 && (
                <p className="mt-2 text-xs">Samples: {[...new Set([...(trend.previous?.sampleTaskRefs ?? []), ...(trend.current?.sampleTaskRefs ?? [])])].map((taskId) => (
                  <Link className="ml-1 underline" key={taskId} to={`/tasks/${encodeURIComponent(taskId)}`}>{taskId}</Link>
                ))}</p>
              )}
              {evidence.length > 0 && (
                <details className="mt-2 text-xs">
                  <summary className="cursor-pointer">Evidence ({evidence.length})</summary>
                  <ul className="mt-1 space-y-1 font-mono text-muted-foreground">
                    {evidence.map((record) => <li key={record.id}>{record.id}<ul className="ml-4">{record.facts.map((fact) => <li key={fact.eventId}><Link className="underline" to={eventAnchorHref(fact.taskId, fact.eventId)}>{fact.eventId}</Link></li>)}</ul></li>)}
                  </ul>
                </details>
              )}
            </article>
          );
        })}
      </CardContent>
    </Card>
  );
}

export function EraTrendComparison() {
  const now = useMemo(() => new Date(), []);
  const [days, setDays] = useState(7);
  const [currentEnd, setCurrentEnd] = useState(now.toISOString());
  const [currentStart, setCurrentStart] = useState(new Date(now.getTime() - days * 86_400_000).toISOString());
  const comparison = useQuery({
    queryKey: ['pattern-trends', currentStart, currentEnd],
    queryFn: async () => (await fetchPatternTrends(currentStart, currentEnd)).comparison,
  });
  const changeDays = (nextDays: number) => {
    setDays(nextDays);
    setCurrentStart(new Date(Date.parse(currentEnd) - nextDays * 86_400_000).toISOString());
  };
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-end gap-2 text-sm">
        <label>Window
          <select className="ml-2 rounded border bg-background px-2 py-1" value={days} onChange={(event) => changeDays(Number(event.target.value))}>
            <option value={7}>7 days</option><option value={30}>30 days</option>
          </select>
        </label>
        <label>Start <input className="ml-1 rounded border bg-background px-2 py-1" type="datetime-local" value={formatDateTimeLocal(currentStart)} onChange={(event) => {
          const value = parseDateTimeLocal(event.target.value); if (value) setCurrentStart(value);
        }} /></label>
        <label>End <input className="ml-1 rounded border bg-background px-2 py-1" type="datetime-local" value={formatDateTimeLocal(currentEnd)} onChange={(event) => {
          const value = parseDateTimeLocal(event.target.value); if (value) setCurrentEnd(value);
        }} /></label>
      </div>
      {comparison.isLoading && <p className="text-sm text-muted-foreground">Comparing observed patterns…</p>}
      {comparison.isError && <p className="text-sm text-destructive">Pattern comparison is unavailable.</p>}
      {comparison.data && <TrendComparisonCard comparison={comparison.data} />}
    </section>
  );
}
