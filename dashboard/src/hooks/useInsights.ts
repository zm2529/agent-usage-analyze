import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchInsights, deleteInsight } from '@/lib/api';

interface InsightParams {
  projectId?: string;
  sessionId?: string;
  type?: string;
}

export function useInsights(params?: InsightParams) {
  return useQuery({
    queryKey: ['insights', params],
    queryFn: () => fetchInsights(params).then((r) => r.insights),
  });
}

export function useDeleteInsight() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteInsight(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['insights'] });
    },
  });
}
