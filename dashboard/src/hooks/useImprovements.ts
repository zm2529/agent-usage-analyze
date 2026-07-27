import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  fetchImprovements,
  reviewImprovement,
  sendImprovementFeedback,
  updateImprovementStatus,
} from '@/lib/api';

export function useImprovements() {
  return useQuery({
    queryKey: ['improvements'],
    queryFn: fetchImprovements,
    refetchInterval: (query) => query.state.data?.generation.running ? 2_000 : 15_000,
    gcTime: 60 * 60_000,
  });
}

export function useReviewImprovement() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: reviewImprovement,
    onSuccess: () => { void client.invalidateQueries({ queryKey: ['improvements'] }); },
  });
}

export function useImprovementFeedback() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      planId: string;
      kind: 'judgment-wrong' | 'not-applicable' | 'continue-observing' | 'end-tracking';
      note?: string;
    }) => sendImprovementFeedback(input.planId, { kind: input.kind, note: input.note }),
    onSuccess: () => { void client.invalidateQueries({ queryKey: ['improvements'] }); },
  });
}

export function useUpdateImprovementStatus() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      planId: string;
      status: 'observing' | 'paused' | 'ended';
    }) => updateImprovementStatus(input.planId, input.status),
    onSuccess: () => { void client.invalidateQueries({ queryKey: ['improvements'] }); },
  });
}
