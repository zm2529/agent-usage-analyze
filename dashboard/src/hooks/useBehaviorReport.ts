import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchBehaviorReport, fetchBehaviorReportSummary, runBehaviorReport } from '@/lib/api';
import type { BehaviorReportState } from '@/lib/types';

export function useBehaviorReport() {
  return useQuery({
    queryKey: ['behaviorReport'],
    queryFn: fetchBehaviorReport,
    refetchInterval: (query) => query.state.data?.generation?.running ? 2_000 : false,
  });
}

export function useBehaviorReportSummary() {
  return useQuery({
    queryKey: ['behaviorReportSummary'],
    queryFn: fetchBehaviorReportSummary,
    refetchInterval: (query) => query.state.data?.generation.running ? 2_000 : false,
    staleTime: 5 * 60_000,
    gcTime: 60 * 60_000,
  });
}

export function useRunBehaviorReport() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: runBehaviorReport,
    onMutate: () => {
      client.setQueryData(['behaviorReport'], (current: BehaviorReportState | undefined) => ({
        ...(current ?? {
          report: null,
          eligibility: null,
          evidence: null,
        } as unknown as BehaviorReportState),
        generation: { running: true, startedAt: new Date().toISOString() },
      }));
    },
    onSuccess: (data) => {
      client.setQueryData(['behaviorReport'], (current: BehaviorReportState | undefined) =>
        current ? { ...current, generation: data.generation } : current);
      client.invalidateQueries({ queryKey: ['behaviorReport'] });
      client.invalidateQueries({ queryKey: ['behaviorReportSummary'] });
      client.invalidateQueries({ queryKey: ['analysisRuns'] });
    },
  });
}
