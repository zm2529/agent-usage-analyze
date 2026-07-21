import { useEffect, useRef, useCallback } from 'react';

interface LoadMoreSentinelProps {
  onLoadMore?: () => void;
  loadingMore?: boolean;
}

/**
 * Sentinel element that triggers loadMore via IntersectionObserver
 * when it scrolls into view.
 */
export function LoadMoreSentinel({ onLoadMore, loadingMore }: LoadMoreSentinelProps) {
  const sentinelRef = useRef<HTMLDivElement>(null);

  const handleIntersect = useCallback(
    (entries: IntersectionObserverEntry[]) => {
      if (entries[0]?.isIntersecting && onLoadMore && !loadingMore) {
        onLoadMore();
      }
    },
    [onLoadMore, loadingMore]
  );

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(handleIntersect, { threshold: 0.1 });
    observer.observe(el);
    return () => observer.disconnect();
  }, [handleIntersect]);

  return <div ref={sentinelRef} className="h-1" />;
}
