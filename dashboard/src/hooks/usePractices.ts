import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  authorizeKnowledgeResearch,
  fetchKnowledgePractices,
  fetchKnowledgeStatus,
  refreshKnowledgeResearch,
  setKnowledgeResearchAuthorization,
  trackKnowledgePractice,
  type KnowledgePractice,
} from '@/lib/api';

export function useKnowledgeStatus() {
  return useQuery({
    queryKey: ['knowledgeStatus'],
    queryFn: fetchKnowledgeStatus,
    refetchInterval: (query) => query.state.data?.generation.running ? 2_000 : 30_000,
  });
}

export function useKnowledgePractices(filters?: {
  snapshotId?: string;
  trust?: KnowledgePractice['sourceTrust'];
  relevance?: KnowledgePractice['localRelevance'];
  tag?: string;
}) {
  return useQuery({
    queryKey: ['knowledgePractices', filters ?? {}],
    queryFn: () => fetchKnowledgePractices(filters),
    refetchInterval: 30_000,
  });
}

export function useAuthorizeKnowledgeResearch() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: authorizeKnowledgeResearch,
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['knowledgeStatus'] });
      void client.invalidateQueries({ queryKey: ['knowledgePractices'] });
    },
  });
}

export function useSetKnowledgeResearchAuthorization() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: setKnowledgeResearchAuthorization,
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['knowledgeStatus'] });
      void client.invalidateQueries({ queryKey: ['knowledgePractices'] });
    },
  });
}

export function useRefreshKnowledgeResearch() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (topic?: string) => refreshKnowledgeResearch(topic),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['knowledgeStatus'] });
      void client.invalidateQueries({ queryKey: ['knowledgePractices'] });
    },
  });
}

export function useTrackKnowledgePractice() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: trackKnowledgePractice,
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['improvements'] });
    },
  });
}
