import { useQuery } from '@tanstack/react-query';
import { fetchAnalysisRuns } from '@/lib/api';

export function useAnalysisRuns(params?: {
  sessionId?: string;
  analysisType?: string;
  limit?: number;
}) {
  return useQuery({
    queryKey: ['analysisRuns', params],
    queryFn: () => fetchAnalysisRuns(params).then((response) => response.runs),
  });
}
