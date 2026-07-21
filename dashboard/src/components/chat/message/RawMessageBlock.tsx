import { useState } from 'react';
import { Code } from 'lucide-react';

interface RawMessageBlockProps {
  label: string;    // e.g., "Skill Load", "Command Output", "Exit Command"
  content: string;  // Raw message content
}

const CHAR_LIMIT = 500;

/**
 * Renders hidden protocol messages (skill-load, command-frame, exit-command)
 * when the "Show raw messages" toggle is on. Displays as a dashed-border
 * monospace block with a type label, truncated at 3 lines or 500 chars with expand.
 */
export function RawMessageBlock({ label, content }: RawMessageBlockProps) {
  const [expanded, setExpanded] = useState(false);
  const lines = content.split('\n');
  const needsTruncation = lines.length > 3 || content.length > CHAR_LIMIT;
  const displayContent = expanded
    ? content
    : lines.length > 3
      ? lines.slice(0, 3).join('\n')
      : content.slice(0, CHAR_LIMIT);

  return (
    <div
      className="mx-4 my-1 rounded-lg border border-dashed border-border bg-muted/30 p-3"
      aria-label={`Raw system message: ${label}`}
    >
      <div className="flex items-center gap-1 mb-1">
        <Code className="h-3 w-3 text-muted-foreground/60" />
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground/60 font-medium">
          {label}
        </span>
      </div>
      <div className="font-mono text-xs text-muted-foreground whitespace-pre-wrap break-words">
        {displayContent}
        {needsTruncation && !expanded && '...'}
      </div>
      {needsTruncation && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-1 text-xs text-muted-foreground hover:text-foreground cursor-pointer transition-colors"
        >
          {expanded ? 'Show less' : 'Show more'}
        </button>
      )}
    </div>
  );
}
