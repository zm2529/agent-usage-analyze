import { useQuery } from '@tanstack/react-query';
import { fetchAnalysisRuns } from '@/lib/api';

export function useAnalysisRuns(params?: {
  sessionId?: string;
  analysisType?: string;
  limit?: number;
  poll?: boolean;
}) {
  return useQuery({
    queryKey: ['analysisRuns', params],
    queryFn: () => fetchAnalysisRuns(params).then((response) => response.runs),
    refetchInterval: params?.poll ? 2_000 : false,
  });
}
