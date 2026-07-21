import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'react-router';
import { appendDeliveryCorrection, fetchDelivery } from '@/lib/api';
import { DeliveryCandidateCard } from '@/components/deliveries/DeliveryCandidateCard';
import { Button } from '@/components/ui/button';

export default function DeliveryDetailPage() {
  const { id } = useParams();
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ['delivery', id], queryFn: async () => (await fetchDelivery(id!)).delivery, enabled: Boolean(id) });
  const correction = useMutation({
    mutationFn: ({ candidateId, decision }: { candidateId: string; decision: 'confirmed' | 'rejected' | 'pending' }) =>
      appendDeliveryCorrection(id!, candidateId, decision),
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: ['delivery', id] }),
  });
  if (query.isLoading) return <main className="p-6 text-sm text-muted-foreground">Loading delivery evidence…</main>;
  if (query.isError) return <main className="p-6 text-sm text-destructive">Delivery evidence is unavailable.</main>;
  if (!query.data) return <main className="p-6">Delivery not found.</main>;
  return (
    <main className="mx-auto max-w-5xl space-y-4 p-6">
      <div><h1 className="font-mono text-xl font-semibold">{query.data.resultIdentity}</h1><p className="text-sm text-muted-foreground">{query.data.kind} · {query.data.occurredAt}</p></div>
      {query.data.candidates.length === 0 && <p className="text-sm text-muted-foreground">No task candidate has enough evidence to display.</p>}
      {correction.isError && <p className="text-sm text-destructive">The correction could not be appended; existing evidence was not changed.</p>}
      {query.data.candidates.map((candidate) => (
        <section key={candidate.id} className="space-y-2">
          <DeliveryCandidateCard candidate={candidate} showTaskLink />
          <div className="flex gap-2">
            {(['confirmed', 'rejected', 'pending'] as const).map((decision) => (
              <Button key={decision} size="sm" variant="outline" disabled={correction.isPending}
                onClick={() => correction.mutate({ candidateId: candidate.id, decision })}>{decision}</Button>
            ))}
          </div>
        </section>
      ))}
    </main>
  );
}
