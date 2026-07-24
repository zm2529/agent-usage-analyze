import { TerminalSquare } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';

export function EmptyDashboard() {
  return (
    <Card>
      <CardContent className="flex flex-col items-center justify-center py-12 text-center">
        <TerminalSquare className="h-12 w-12 text-muted-foreground mb-4" />
        <h3 className="text-lg font-semibold mb-2">No sessions synced yet</h3>
        <p className="text-muted-foreground max-w-md">
          Run <code className="bg-muted px-1.5 py-0.5 rounded text-sm">agent-usage-analyze sync</code> to
          import your AI coding sessions, then come back here to explore your data.
        </p>
      </CardContent>
    </Card>
  );
}
