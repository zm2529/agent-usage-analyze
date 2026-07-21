import { useQuery } from '@tanstack/react-query';
import { fetchIngestionHealth } from '@/lib/api';

export function useIngestionHealth() {
  return useQuery({
    queryKey: ['ingestion', 'health'],
    queryFn: fetchIngestionHealth,
    refetchInterval: 30_000,
  });
}
