import { Activity, Bot, Database, Timer } from 'lucide-react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import type { ObserverOverhead } from '@/lib/types';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function ObserverOverheadCard({ overhead }: { overhead: ObserverOverhead }) {
  const tokens = overhead.totals.inputTokens === null || overhead.totals.outputTokens === null
    ? null : overhead.totals.inputTokens + overhead.totals.outputTokens;
  const metrics = [
    { icon: Timer, value: `${Math.round(overhead.totals.wallMs)} ms wall`, sub: `${Math.round(overhead.totals.cpuMs)} ms CPU` },
    { icon: Database, value: `${formatBytes(overhead.totals.dbBytesDelta)} DB growth`, sub: `${overhead.eventCount} observer events` },
    { icon: Bot, value: tokens === null ? 'Token usage unknown' : `${tokens.toLocaleString()} tokens`, sub: overhead.totals.costUsd === null ? 'Cost unknown' : `$${overhead.totals.costUsd.toFixed(6)}` },
    { icon: Activity, value: `${overhead.advisory.shown} shown · ${overhead.advisory.adopted} adopted`, sub: `${Math.round(overhead.totals.sidecarMs)} ms sidecar` },
  ];
  return (
    <Card>
      <CardHeader className="pb-2">
        <h2 className="text-sm font-semibold">Observer overhead</h2>
        <p className="text-xs text-muted-foreground">Observer-only; excluded from task usage and scorecards.</p>
        {overhead.degraded && <p className="text-xs text-destructive">Observer accounting degraded · {overhead.diagnostics.map((item) => `${item.category}:${item.code}`).join(', ')}</p>}
      </CardHeader>
      <CardContent className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {metrics.map(({ icon: Icon, value, sub }) => (
          <div key={value} className="rounded-md border p-2">
            <div className="flex items-center gap-1.5 text-xs font-medium"><Icon className="h-3.5 w-3.5" />{value}</div>
            <p className="mt-1 text-[11px] text-muted-foreground">{sub}</p>
          </div>
        ))}
        {(overhead.byCategory.length > 0 || overhead.recentEvents.length > 0) && (
          <details className="sm:col-span-2 lg:col-span-4 rounded-md border p-2 text-xs">
            <summary className="cursor-pointer font-medium">Overhead details</summary>
            <div className="mt-2 space-y-2">
              <div className="flex flex-wrap gap-1">
                {overhead.byCategory.map((category) => (
                  <span key={category.category} className="rounded bg-muted px-2 py-1">
                    {category.category.toUpperCase()} · {category.eventCount} {category.eventCount === 1 ? 'event' : 'events'} · {Math.round(category.wallMs)} ms
                  </span>
                ))}
              </div>
              {overhead.recentEvents.map((event) => (
                <div key={event.id} className="rounded border p-2">
                  <p className="font-medium">{event.observerRunId}</p>
                  <p className="text-muted-foreground">{event.category} · {event.occurredAt}</p>
                  <p className="break-all text-muted-foreground">Evidence: {event.evidenceRefs.join(', ')}</p>
                </div>
              ))}
            </div>
          </details>
        )}
      </CardContent>
    </Card>
  );
}
