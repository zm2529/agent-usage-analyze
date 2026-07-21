import { Sparkles } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';

export function EmptyInsights() {
  return (
    <Card>
      <CardContent className="flex flex-col items-center justify-center py-12 text-center">
        <Sparkles className="h-12 w-12 text-muted-foreground mb-4" />
        <h3 className="text-lg font-semibold mb-2">No insights yet</h3>
        <p className="text-muted-foreground max-w-md">
          Configure an AI provider in Settings and click <strong>Analyze Session</strong> on any session
          to generate insights about your coding patterns.
        </p>
      </CardContent>
    </Card>
  );
}
