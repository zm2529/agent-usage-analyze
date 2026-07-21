import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchMissingFacetSessionIds, backfillFacets } from '@/lib/api';

export function useMissingFacets(params?: {
  project?: string;
  period?: string;
  source?: string;
}) {
  return useQuery({
    queryKey: ['facets', 'missing', params?.project, params?.period, params?.source],
    queryFn: () => fetchMissingFacetSessionIds(params),
    staleTime: 30_000,
  });
}

export function useBackfillFacets() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (sessionIds: string[]) => backfillFacets(sessionIds),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['facets'] });
    },
  });
}
