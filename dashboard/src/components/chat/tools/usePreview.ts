import { useMemo, useState } from 'react';

interface PreviewTextResult {
  showFull: boolean;
  toggle: () => void;
  hasMore: boolean;
  resultLines: string[];
  previewText: string;
}

interface PreviewLinesResult {
  showFull: boolean;
  toggle: () => void;
  hasMore: boolean;
  previewLines: string[];
}

export function usePreviewText(resultText: string, previewLines: number): PreviewTextResult {
  const [showFull, setShowFull] = useState(false);

  const normalizedText = useMemo(() => resultText.trimEnd(), [resultText]);
  const resultLinesArr = useMemo(
    () => (normalizedText ? normalizedText.split('\n') : []),
    [normalizedText]
  );
  const hasMore = resultLinesArr.length > previewLines;
  const previewText = hasMore && !showFull
    ? resultLinesArr.slice(0, previewLines).join('\n')
    : resultText;

  const toggle = () => setShowFull((prev) => !prev);

  return { showFull, toggle, hasMore, resultLines: resultLinesArr, previewText };
}

export function usePreviewLines(lines: string[], previewCount: number): PreviewLinesResult {
  const [showFull, setShowFull] = useState(false);
  const hasMore = lines.length > previewCount;
  const previewLines = hasMore && !showFull
    ? lines.slice(0, previewCount)
    : lines;
  const toggle = () => setShowFull((prev) => !prev);

  return { showFull, toggle, hasMore, previewLines };
}
