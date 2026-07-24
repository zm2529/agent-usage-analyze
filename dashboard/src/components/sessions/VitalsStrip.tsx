import { format } from 'date-fns';
import { formatDuration, formatTokenCount } from '@/lib/utils';
import type { Session } from '@/lib/types';

interface VitalsStripProps {
  session: Session;
}

/**
 * Format a start–end time range for a sublabel.
 * Same AM/PM: "7:17 – 8:12 AM"
 * Different AM/PM: "7:17 AM – 8:12 PM"
 */
function formatTimeRange(start: Date, end: Date): string {
  const startPeriod = format(start, 'a');
  const endPeriod = format(end, 'a');
  if (startPeriod === endPeriod) {
    return `${format(start, 'h:mm')} – ${format(end, 'h:mm a')}`;
  }
  return `${format(start, 'h:mm a')} – ${format(end, 'h:mm a')}`;
}

export function VitalsStrip({ session }: VitalsStripProps) {
  const startedAt = new Date(session.started_at);
  const endedAt = new Date(session.ended_at);

  // Build message sublabel with compact indicators
  const compactCount = session.compact_count ?? 0;
  const autoCompactCount = session.auto_compact_count ?? 0;
  const messageSublabelParts: string[] = [
    `${session.user_message_count} user \u00B7 ${session.assistant_message_count} asst`,
  ];
  if (compactCount > 0) {
    messageSublabelParts.push(`${compactCount} compact${compactCount > 1 ? 's' : ''}`);
  }
  if (autoCompactCount > 0) {
    messageSublabelParts.push(`${autoCompactCount} ctx overflow${autoCompactCount > 1 ? 's' : ''}`);
  }
  const messageSublabel = messageSublabelParts.join(' \u00B7 ');

  // Token calculations — fields are independent additive values per Anthropic API convention:
  // input_tokens = non-cached input; cache tokens are separate counts, not subsets of input
  const inputTokens = session.total_input_tokens ?? 0;
  const cacheCreation = session.cache_creation_tokens ?? 0;
  const cacheRead = session.cache_read_tokens ?? 0;
  const outputTokens = session.total_output_tokens ?? 0;
  const totalTokens = inputTokens + cacheCreation + cacheRead + outputTokens;
  const hasTokens = totalTokens > 0;

  // Build token sublabel: "359 in · 25.9M cch · 51.2K out"
  const tokenParts: string[] = [];
  if (inputTokens > 0) tokenParts.push(`${formatTokenCount(inputTokens)} in`);
  const cacheTotal = cacheCreation + cacheRead;
  if (cacheTotal > 0) tokenParts.push(`${formatTokenCount(cacheTotal)} cch`);
  if (outputTokens > 0) tokenParts.push(`${formatTokenCount(outputTokens)} out`);
  const tokenSublabel = tokenParts.join(' \u00B7 ');

  return (
    <div className="space-y-1.5">
      {/* Primary stats grid */}
      <div className="grid grid-cols-3 border-y">
        <StatCell
          label="Duration"
          value={formatDuration(startedAt, endedAt)}
          sublabel={formatTimeRange(startedAt, endedAt)}
        />
        <StatCell
          label="Messages"
          value={String(session.message_count)}
          sublabel={messageSublabel}
        />
        <StatCell
          label="Tokens"
          value={hasTokens ? formatTokenCount(totalTokens) : '--'}
          sublabel={hasTokens ? tokenSublabel : undefined}
        />
      </div>
    </div>
  );
}

function StatCell({
  label,
  value,
  sublabel,
}: {
  label: string;
  value: string;
  sublabel?: string;
}) {
  return (
    <div className="min-w-0 border-r px-3 py-3 text-left last:border-r-0">
      <div className="text-base font-semibold tabular-nums leading-tight">{value}</div>
      <div className="mt-1 text-[9px] text-muted-foreground uppercase tracking-[.08em]">{label}</div>
      {sublabel && (
        <div className="text-[10px] text-muted-foreground/60 leading-tight">{sublabel}</div>
      )}
    </div>
  );
}
