import { useQuery } from '@tanstack/react-query';
import { fetchAnalysisUsageSummary } from '@/lib/api';

export function useAnalysisUsageSummary() {
  return useQuery({
    queryKey: ['analysisUsageSummary'],
    queryFn: fetchAnalysisUsageSummary,
    staleTime: 30_000,
  });
}
