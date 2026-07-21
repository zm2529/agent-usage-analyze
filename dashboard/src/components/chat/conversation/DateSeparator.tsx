import { format } from 'date-fns';

interface DateSeparatorProps {
  timestamp: string;  // ISO 8601 string
}

export function DateSeparator({ timestamp }: DateSeparatorProps) {
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <div className="flex-1 border-t border-border" />
      <span className="text-xs text-muted-foreground shrink-0">
        {format(new Date(timestamp), 'MMM d, h:mm a')}
      </span>
      <div className="flex-1 border-t border-border" />
    </div>
  );
}
