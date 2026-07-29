import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  applyProductUpdate,
  checkForProductUpdates,
  fetchProductUpdateStatus,
  saveProductUpdateSettings,
} from '@/lib/api';

const UPDATE_QUERY_KEY = ['product-updates'] as const;

export function useProductUpdateStatus() {
  return useQuery({
    queryKey: UPDATE_QUERY_KEY,
    queryFn: fetchProductUpdateStatus,
    refetchInterval: (query) => {
      const status = query.state.data;
      return status?.checking || status?.updating ? 1_000 : false;
    },
  });
}

export function useCheckForProductUpdates() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: checkForProductUpdates,
    onSuccess: (status) => client.setQueryData(UPDATE_QUERY_KEY, status),
    onSettled: () => client.invalidateQueries({ queryKey: UPDATE_QUERY_KEY }),
  });
}

export function useSaveProductUpdateSettings() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: saveProductUpdateSettings,
    onSuccess: (status) => client.setQueryData(UPDATE_QUERY_KEY, status),
    onSettled: () => client.invalidateQueries({ queryKey: UPDATE_QUERY_KEY }),
  });
}

export function useApplyProductUpdate() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: applyProductUpdate,
    onSuccess: ({ status }) => client.setQueryData(UPDATE_QUERY_KEY, status),
    onSettled: () => client.invalidateQueries({ queryKey: UPDATE_QUERY_KEY }),
  });
}
