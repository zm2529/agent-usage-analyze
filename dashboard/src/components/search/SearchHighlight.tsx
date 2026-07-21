interface SearchHighlightProps {
  text: string;
  query: string;
  className?: string;
}

/**
 * Renders text with query matches highlighted as bold text.
 * Uses text-foreground font-medium for the match (not yellow highlighter — developer aesthetic).
 */
export function SearchHighlight({ text, query, className }: SearchHighlightProps) {
  if (!query.trim()) {
    return <span className={className}>{text}</span>;
  }

  const parts: Array<{ text: string; highlight: boolean }> = [];
  const lower = text.toLowerCase();
  const queryLower = query.trim().toLowerCase();
  let cursor = 0;

  while (cursor < text.length) {
    const idx = lower.indexOf(queryLower, cursor);
    if (idx === -1) {
      parts.push({ text: text.slice(cursor), highlight: false });
      break;
    }
    if (idx > cursor) {
      parts.push({ text: text.slice(cursor, idx), highlight: false });
    }
    parts.push({ text: text.slice(idx, idx + queryLower.length), highlight: true });
    cursor = idx + queryLower.length;
  }

  return (
    <span className={className}>
      {parts.map((part, i) =>
        part.highlight ? (
          <span key={i} className="text-foreground font-medium">
            {part.text}
          </span>
        ) : (
          <span key={i}>{part.text}</span>
        )
      )}
    </span>
  );
}
