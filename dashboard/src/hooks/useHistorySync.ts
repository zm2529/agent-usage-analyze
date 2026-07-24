import { useMutation, useQueryClient } from '@tanstack/react-query';
import { syncHistory } from '@/lib/api';

export function useHistorySync() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ force = false }: { force?: boolean } = {}) => syncHistory(force),
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: ['sessions'] }),
        client.invalidateQueries({ queryKey: ['insights'] }),
        client.invalidateQueries({ queryKey: ['tasks'] }),
        client.invalidateQueries({ queryKey: ['deliveries'] }),
        client.invalidateQueries({ queryKey: ['ingestion'] }),
        client.invalidateQueries({ queryKey: ['behaviorReport'] }),
      ]);
    },
  });
}
