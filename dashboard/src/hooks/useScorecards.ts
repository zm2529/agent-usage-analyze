import { useQuery } from '@tanstack/react-query';
import { fetchObserverOverhead, fetchScorecards } from '@/lib/api';

export function useScorecards() {
  return useQuery({ queryKey: ['scorecards'], queryFn: () => fetchScorecards() });
}

export function useObserverOverhead() {
  return useQuery({
    queryKey: ['observer-overhead'],
    queryFn: fetchObserverOverhead,
    refetchInterval: 30_000,
  });
}
