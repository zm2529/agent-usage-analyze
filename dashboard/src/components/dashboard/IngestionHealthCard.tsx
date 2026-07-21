import { Database, History, ShieldCheck, TriangleAlert } from 'lucide-react';
import type { IngestionHealth } from '@/lib/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export function IngestionHealthCard({ health }: { health: IngestionHealth }) {
  const { coverage } = health;

  return (
    <Card aria-label="Canonical ingestion coverage">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <ShieldCheck className="h-4 w-4 text-emerald-600" />
          <span role="heading" aria-level={2}>Ingestion health</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3 text-xs sm:grid-cols-3">
        <div className="flex items-start gap-2">
          <Database className="mt-0.5 h-4 w-4 text-muted-foreground" />
          <div>
            <p className="font-medium">{coverage.parsed} of {coverage.discovered} parsed</p>
            <p className="text-muted-foreground">{health.eventCount} events from {health.sourceCount} sources</p>
          </div>
        </div>
        <div className="flex items-start gap-2">
          <TriangleAlert className="mt-0.5 h-4 w-4 text-amber-600" />
          <div>
            <p className="font-medium">{coverage.unknown} unknown</p>
            <p className="text-muted-foreground">{coverage.failed} failed · {coverage.skipped} skipped</p>
          </div>
        </div>
        <div className="flex items-start gap-2">
          <History className="mt-0.5 h-4 w-4 text-muted-foreground" />
          <div className="space-y-1">
            {health.eras.length === 0 ? (
              <p className="text-muted-foreground">No observation era yet</p>
            ) : health.eras.map((era) => (
              <div key={era.id}>
                <p className="font-medium">
                  {era.mode === 'historical-backfill' ? 'Historical backfill' : 'Continuous observation'}
                </p>
                <p className="text-muted-foreground">{era.parserVersion}</p>
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
