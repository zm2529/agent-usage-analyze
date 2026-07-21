import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';
import { discoverDeliveries, fetchDeliveries, recordTaskArtifact } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

export default function DeliveriesPage() {
  const queryClient = useQueryClient();
  const [taskId, setTaskId] = useState('');
  const [relativePath, setRelativePath] = useState('');
  const query = useQuery({ queryKey: ['deliveries'], queryFn: async () => (await fetchDeliveries()).deliveries });
  const discovery = useMutation({ mutationFn: discoverDeliveries, onSuccess: async () => queryClient.invalidateQueries({ queryKey: ['deliveries'] }) });
  const artifact = useMutation({
    mutationFn: () => recordTaskArtifact(taskId, relativePath),
    onSuccess: async () => {
      setRelativePath('');
      await queryClient.invalidateQueries({ queryKey: ['deliveries'] });
    },
  });
  return (
    <main className="mx-auto max-w-5xl space-y-4 p-6">
      <div className="flex flex-wrap items-end justify-between gap-3"><div><h1 className="text-2xl font-semibold">Deliveries</h1><p className="text-sm text-muted-foreground">Immutable local results and evidence-first task candidates.</p></div><Button variant="outline" disabled={discovery.isPending} onClick={() => discovery.mutate()}>{discovery.isPending ? 'Discovering…' : 'Discover local results'}</Button></div>
      {discovery.data && <p className="text-xs text-muted-foreground">Scanned {discovery.data.repositories} repositories · {discovery.data.deliveries} results · {discovery.data.failed} unavailable</p>}
      {discovery.isError && <p className="text-sm text-destructive">Local discovery failed; no existing delivery evidence was changed.</p>}
      <section className="flex flex-wrap items-end gap-2 rounded-lg border p-3 text-sm">
        <label>Task ID <input className="ml-1 rounded border bg-background px-2 py-1 font-mono" value={taskId} onChange={(event) => setTaskId(event.target.value)} /></label>
        <label>Artifact path <input className="ml-1 rounded border bg-background px-2 py-1" placeholder="build/app.bundle" value={relativePath} onChange={(event) => setRelativePath(event.target.value)} /></label>
        <Button variant="outline" disabled={!taskId || !relativePath || artifact.isPending} onClick={() => artifact.mutate()}>Record local artifact</Button>
      </section>
      {artifact.isError && <p className="text-sm text-destructive">The task-scoped artifact could not be recorded.</p>}
      {query.isLoading && <p className="text-sm text-muted-foreground">Loading deliveries…</p>}
      {query.isError && <p className="text-sm text-destructive">Delivery list is unavailable.</p>}
      {query.data?.length === 0 && <p className="text-sm text-muted-foreground">No Git commits, test runs, or local artifacts discovered yet.</p>}
      {query.data?.map((delivery) => (
        <Link key={delivery.id} className="block" to={`/deliveries/${encodeURIComponent(delivery.id)}`}>
          <Card><CardHeader><CardTitle className="font-mono text-sm">{delivery.resultIdentity}</CardTitle></CardHeader><CardContent className="text-sm text-muted-foreground">{delivery.kind} · {delivery.occurredAt}</CardContent></Card>
        </Link>
      ))}
    </main>
  );
}
