import { useEffect, useRef, useMemo, useState } from 'react';
import { Eye } from 'lucide-react';
import { MessageBubble } from '../message/MessageBubble';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import type { Message, ToolResult } from '@/lib/types';
import { parseJsonField } from '@/lib/types';
import { DateSeparator } from './DateSeparator';
import { LoadMoreSentinel } from './LoadMoreSentinel';
import { classifyUserMessage, isAgentMessage } from '../message/preprocess';
import { useLanguage } from '@/i18n/LanguageProvider';

interface ChatConversationProps {
  messages: Message[];
  loading?: boolean;
  loadingMore?: boolean;
  hasMore?: boolean;
  onLoadMore?: () => void;
  error?: string | null;
  sourceTool?: string;
  highlightMessageId?: string | null;
  searchQuery?: string;
}

/**
 * Determines if a date separator should be shown before a message.
 * Shows a separator at the start and whenever the hour changes.
 */
function shouldShowDateSeparator(messages: Message[], index: number): boolean {
  if (index === 0) return true;
  const prev = messages[index - 1];
  const curr = messages[index];
  const prevHour = new Date(prev.timestamp);
  prevHour.setMinutes(0, 0, 0);
  const currHour = new Date(curr.timestamp);
  currHour.setMinutes(0, 0, 0);
  return prevHour.getTime() !== currHour.getTime();
}

export function ChatConversation({
  messages, loading, loadingMore, hasMore, onLoadMore, error, sourceTool, highlightMessageId, searchQuery,
}: ChatConversationProps) {
  const { t } = useLanguage();
  const highlightRef = useRef<HTMLDivElement>(null);

  // showRawMessages: when true, hidden protocol messages (skill-load, command-frame, exit-command)
  // render as RawMessageBlock — dashed-border monospace blocks with type labels.
  const [showRawMessages, setShowRawMessages] = useState(false);
  const hiddenProtocolMessageCount = useMemo(() => messages.filter((message) => {
    if (message.type !== 'user' || !message.content?.trim()) return false;
    const kind = classifyUserMessage(message.content).kind;
    return kind === 'exit-command' || kind === 'skill-load' || kind === 'command-frame';
  }).length, [messages]);

  // Only pass searchQuery to messages that actually match, so the highlight
  // walker doesn't run on every message in large conversations (1000+).
  const matchingMessageIds = useMemo(() => {
    if (!searchQuery) return new Set<string>();
    const lowerQuery = searchQuery.toLowerCase();
    return new Set(
      messages
        .filter((m) => m.content.toLowerCase().includes(lowerQuery))
        .map((m) => m.id)
    );
  }, [messages, searchQuery]);

  useEffect(() => {
    if (highlightMessageId && highlightRef.current) {
      highlightRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [highlightMessageId]);
  if (loading) {
    return (
      <div className="space-y-4 p-4">
        {[...Array(5)].map((_, i) => (
          <div key={i} className="flex gap-3">
            <Skeleton className="h-8 w-8 rounded-full" />
            <div className="space-y-2 flex-1">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-16 w-full" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4">
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-3">
          <p className="text-sm text-destructive">{error}</p>
        </div>
      </div>
    );
  }

  if (messages.length === 0) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground">
        No messages in this session
      </div>
    );
  }

  const shouldShowHeader = (index: number): boolean => {
    if (index === 0) return true;
    const prev = messages[index - 1];
    const curr = messages[index];
    if (prev.type !== curr.type) return true;
    // Break grouping when transitioning between real user messages and agent messages
    if (curr.type === 'user' && curr.content && prev.content) {
      const currIsAgent = isAgentMessage(curr.content);
      const prevIsAgent = isAgentMessage(prev.content);
      if (currIsAgent !== prevIsAgent) return true;
    }
    return false;
  };

  return (
    <div className="w-full">
      {/* Only offer the toggle when this normalized conversation actually contains hidden protocol rows. */}
      {hiddenProtocolMessageCount > 0 && <div className="flex items-center justify-end gap-2 px-4 py-2 border-b border-border">
          <Eye className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-xs text-muted-foreground">
            {t('sessions.rawMessages', 'Show protocol messages')} ({hiddenProtocolMessageCount})
          </span>
          <Switch
            checked={showRawMessages}
            onCheckedChange={setShowRawMessages}
            aria-label={t('sessions.rawMessages', 'Show protocol messages')}
          />
        </div>}

      <div className="px-2">
        {messages.map((message, index) => {
          const isHighlighted = highlightMessageId === message.id;
          return (
            <div
              key={message.id}
              id={`msg-${message.id}`}
              ref={isHighlighted ? highlightRef : undefined}
              className={cn(
                'py-1 transition-colors duration-300',
                isHighlighted && 'ring-2 ring-primary rounded-lg bg-primary/5'
              )}
            >
              {shouldShowDateSeparator(messages, index) && (
                <DateSeparator timestamp={message.timestamp} />
              )}
              <MessageBubble
                message={message}
                showHeader={shouldShowHeader(index)}
                sourceTool={sourceTool}
                searchQuery={matchingMessageIds.has(message.id) ? searchQuery : undefined}
                showRawMessages={showRawMessages}
                nextToolResults={
                  messages[index + 1]?.type === 'user'
                    ? parseJsonField<ToolResult[]>(messages[index + 1].tool_results, [])
                    : []
                }
              />
            </div>
          );
        })}

        {loadingMore && (
          <div className="space-y-4 p-4">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="flex gap-3">
                <Skeleton className="h-8 w-8 rounded-full" />
                <div className="space-y-2 flex-1">
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-12 w-full" />
                </div>
              </div>
            ))}
          </div>
        )}

        {hasMore && (
          <LoadMoreSentinel onLoadMore={onLoadMore} loadingMore={loadingMore} />
        )}
      </div>
    </div>
  );
}
