import { useQuery } from '@tanstack/react-query';
import { fetchIngestionHealth } from '@/lib/api';

export function useIngestionHealth() {
  return useQuery({
    queryKey: ['ingestion', 'health'],
    queryFn: fetchIngestionHealth,
    // A bounded progress poll is used only while an explicit import is running.
    // New Codex sessions arrive through the Stop Hook, not a background file poll.
    refetchInterval: (query) => query.state.data?.status === 'running' ? 2_000 : false,
    refetchOnWindowFocus: true,
  });
}
