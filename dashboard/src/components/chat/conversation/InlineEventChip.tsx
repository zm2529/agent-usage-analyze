import { format } from 'date-fns';
import { Terminal } from 'lucide-react';

interface InlineEventChipProps {
  command: string; // e.g., "/compact", "/plan", "/review"
  timestamp: string; // ISO 8601
}

/**
 * Centered inline chip for user-initiated slash commands.
 * Lightweight — no background or border — just icon + monospace command + timestamp.
 * Used for /compact (user-initiated) and all other slash commands.
 */
export function InlineEventChip({ command, timestamp }: InlineEventChipProps) {
  const formattedTime = format(new Date(timestamp), 'h:mm a');

  return (
    <div
      aria-label={`Slash command ${command} at ${formattedTime}`}
      className="flex justify-center items-center gap-1.5 py-1.5 px-4"
    >
      <Terminal className="h-3 w-3 text-muted-foreground" />
      <span className="text-xs font-mono text-muted-foreground transition-colors hover:text-foreground">
        {command}
      </span>
      <span className="text-xs text-muted-foreground ml-1">{formattedTime}</span>
    </div>
  );
}
