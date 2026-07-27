import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchRuntimeStatus, retryPendingAnalysis } from '@/lib/api';

export function useRuntimeStatus() {
  return useQuery({
    queryKey: ['runtimeStatus'],
    queryFn: fetchRuntimeStatus,
    refetchInterval: 10_000,
  });
}

export function useRetryPendingAnalysis() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: retryPendingAnalysis,
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['runtimeStatus'] });
      void client.invalidateQueries({ queryKey: ['analysisQueue'] });
    },
  });
}
