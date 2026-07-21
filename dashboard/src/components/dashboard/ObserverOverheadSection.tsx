import { useObserverOverhead } from '@/hooks/useScorecards';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorCard } from '@/components/ErrorCard';
import { ObserverOverheadCard } from './ObserverOverheadCard';

export function ObserverOverheadSection() {
  const { data, isLoading, isError, refetch } = useObserverOverhead();
  if (isLoading) return <Card><CardContent className="p-4"><Skeleton className="h-16 w-full" /></CardContent></Card>;
  if (isError) return <ErrorCard message="Failed to load observer overhead" onRetry={() => { void refetch(); }} />;
  return data ? <ObserverOverheadCard overhead={data} /> : null;
}
