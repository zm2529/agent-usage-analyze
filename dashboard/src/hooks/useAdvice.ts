import { useQuery } from '@tanstack/react-query';
import { fetchAdvice } from '@/lib/api';

export function useAdvice() {
  return useQuery({ queryKey: ['advice'], queryFn: () => fetchAdvice() });
}
