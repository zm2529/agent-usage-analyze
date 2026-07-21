import { MessageSquare } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';

export function EmptySessions() {
  return (
    <Card>
      <CardContent className="flex flex-col items-center justify-center py-12 text-center">
        <MessageSquare className="h-12 w-12 text-muted-foreground mb-4" />
        <h3 className="text-lg font-semibold mb-2">No sessions found</h3>
        <p className="text-muted-foreground max-w-md">
          Run <code className="bg-muted px-1.5 py-0.5 rounded text-sm">agent-analytics sync</code> to
          import your AI coding sessions. They&apos;ll appear here once synced.
        </p>
      </CardContent>
    </Card>
  );
}
