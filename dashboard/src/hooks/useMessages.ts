import { useInfiniteQuery } from '@tanstack/react-query';
import { fetchMessages } from '@/lib/api';
import type { Message } from '@/lib/types';

const PAGE_SIZE = 50;

export function useMessages(sessionId: string | undefined) {
  return useInfiniteQuery({
    queryKey: ['messages', sessionId],
    queryFn: ({ pageParam = 0 }: { pageParam: number }) =>
      fetchMessages(sessionId!, { limit: PAGE_SIZE, offset: pageParam }).then((r) => r.messages),
    initialPageParam: 0,
    getNextPageParam: (lastPage: Message[], _allPages: Message[][], lastPageParam: number) => {
      // If the page returned fewer messages than requested, we've reached the end.
      if (lastPage.length < PAGE_SIZE) return undefined;
      return lastPageParam + PAGE_SIZE;
    },
    enabled: !!sessionId,
  });
}
