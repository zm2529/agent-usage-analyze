import { useQuery } from '@tanstack/react-query';
import { fetchCodexAccountUsage, fetchDashboardStats, fetchOverviewAnalytics } from '@/lib/api';
import type { OverviewRange } from '@/lib/types';

type Range = '7d' | '30d' | '90d' | 'all';

export function useDashboardStats(range: Range = '7d') {
  return useQuery({
    queryKey: ['analytics', 'dashboard', range],
    queryFn: () => fetchDashboardStats(range).then((r) => r.stats),
    refetchInterval: 60_000,
  });
}

export function useCodexAccountUsage() {
  return useQuery({
    queryKey: ['codex', 'account-usage'],
    queryFn: fetchCodexAccountUsage,
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
}

export function useOverviewAnalytics(range: OverviewRange) {
  return useQuery({
    queryKey: ['analytics', 'overview', range],
    queryFn: () => fetchOverviewAnalytics(range),
    refetchInterval: 30_000,
  });
}
