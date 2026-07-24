import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchBehaviorReport, runBehaviorReport } from '@/lib/api';

export function useBehaviorReport() {
  return useQuery({
    queryKey: ['behaviorReport'],
    queryFn: fetchBehaviorReport,
    refetchInterval: (query) => query.state.data?.generation?.running ? 2_000 : false,
  });
}

export function useRunBehaviorReport() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: runBehaviorReport,
    onSuccess: (data) => {
      client.setQueryData(['behaviorReport'], data);
      client.invalidateQueries({ queryKey: ['analysisRuns'] });
    },
  });
}
