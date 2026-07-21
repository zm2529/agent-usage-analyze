import { useState } from 'react';
import { format } from 'date-fns';
import { BellRing, MessageSquare, ChevronDown, ChevronRight } from 'lucide-react';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { cn } from '@/lib/utils';
import { TEAMMATE_BORDER_COLORS, TEAMMATE_DEFAULT_COLORS } from '@/lib/constants/colors';
import { AssistantMarkdown } from './markdown/AssistantMarkdown';
import type { ParsedAgentMessage, ParsedTaskNotification, ParsedTeammateMessage } from './preprocess';

interface AgentMessageBubbleProps {
  parsed: ParsedAgentMessage;
  timestamp: string;
}

export function AgentMessageBubble({ parsed, timestamp }: AgentMessageBubbleProps) {
  if (parsed.kind === 'task-notification') {
    return <TaskNotificationCard parsed={parsed} timestamp={timestamp} />;
  }
  return <TeammateMessageCard parsed={parsed} timestamp={timestamp} />;
}

// ─── TaskNotificationCard ─────────────────────────────────────────────────────

function getStatusBadgeClass(status?: string): string {
  if (!status) return 'bg-gray-500/10 text-gray-500 border-gray-500/20';
  const lower = status.toLowerCase();
  if (lower === 'completed' || lower === 'success') {
    return 'bg-green-500/10 text-green-600 border-green-500/20';
  }
  if (lower === 'failed' || lower === 'error') {
    return 'bg-red-500/10 text-red-600 border-red-500/20';
  }
  return 'bg-gray-500/10 text-gray-500 border-gray-500/20';
}

function TaskNotificationCard({
  parsed,
  timestamp,
}: {
  parsed: ParsedTaskNotification;
  timestamp: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const hasResult = Boolean(parsed.result);
  const hasUsage = Boolean(parsed.usage?.tokens || parsed.usage?.duration || parsed.usage?.toolUses);

  const usageParts: string[] = [];
  if (parsed.usage?.tokens) usageParts.push(`${parsed.usage.tokens} tokens`);
  if (parsed.usage?.duration) usageParts.push(parsed.usage.duration);
  if (parsed.usage?.toolUses) usageParts.push(`${parsed.usage.toolUses} tool uses`);

  return (
    <div className="border-l-4 border-amber-500/40 bg-amber-500/5 rounded-lg p-3 mx-4 my-2">
      {/* Header row */}
      <div className="flex items-center gap-2">
        <BellRing className="h-4 w-4 text-amber-500 shrink-0" />
        <span className="text-sm font-medium flex-1 min-w-0 truncate">
          {parsed.summary ?? 'Task notification'}
        </span>
        {parsed.status && (
          <span
            className={cn(
              'shrink-0 text-xs px-1.5 py-0.5 rounded border',
              getStatusBadgeClass(parsed.status)
            )}
          >
            {parsed.status}
          </span>
        )}
        <span className="shrink-0 text-xs text-muted-foreground">
          {format(new Date(timestamp), 'h:mm a')}
        </span>
      </div>

      {/* Collapsible result section */}
      {hasResult && (
        <div className="mt-2">
          <button
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            {expanded ? (
              <ChevronDown className="h-3 w-3" />
            ) : (
              <ChevronRight className="h-3 w-3" />
            )}
            {expanded ? 'Hide result' : 'Show result'}
          </button>
          {expanded && parsed.result && (
            <div className="mt-2">
              <AssistantMarkdown content={parsed.result} codeStyle={oneDark} />
            </div>
          )}
        </div>
      )}

      {/* Usage footer */}
      {hasUsage && (
        <div className="mt-2 text-xs text-muted-foreground">
          {usageParts.join(' · ')}
        </div>
      )}
    </div>
  );
}

// ─── TeammateMessageCard ──────────────────────────────────────────────────────

function TeammateMessageCard({
  parsed,
  timestamp,
}: {
  parsed: ParsedTeammateMessage;
  timestamp: string;
}) {
  // Resolve color tokens from the color attribute, fallback to gray
  const colors =
    parsed.color && parsed.color in TEAMMATE_BORDER_COLORS
      ? TEAMMATE_BORDER_COLORS[parsed.color]
      : TEAMMATE_DEFAULT_COLORS;

  const displayName = parsed.from ?? parsed.teammateId ?? 'Agent';

  return (
    <div className={cn('border-l-4 rounded-lg p-3 mx-4 my-2', colors.border, colors.bg)}>
      {/* Header row */}
      <div className="flex items-center gap-2">
        <MessageSquare className={cn('h-4 w-4 shrink-0', colors.text)} />
        <span className="text-sm font-medium flex-1 min-w-0 truncate">{displayName}</span>
        {parsed.type && (
          <span className="shrink-0 text-xs px-1.5 py-0.5 rounded border bg-muted/50 text-muted-foreground border-border">
            {parsed.type}
          </span>
        )}
        <span className="shrink-0 text-xs text-muted-foreground">
          {format(new Date(timestamp), 'h:mm a')}
        </span>
      </div>

      {/* Message body — prefer summary, then content, then raw */}
      {(parsed.summary ?? parsed.content ?? parsed.rawContent) && (
        <div className="mt-1.5 text-sm text-foreground/80 whitespace-pre-wrap break-words">
          {parsed.summary ?? parsed.content ?? parsed.rawContent}
        </div>
      )}
    </div>
  );
}
