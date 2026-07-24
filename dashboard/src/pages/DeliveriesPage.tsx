import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';
import { fetchDeliveries, recordTaskArtifact } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/i18n/LanguageProvider';
import { deliveryDisplayTitle, deliveryExplanation, readableSessionTitle } from '@/lib/presentation';

export default function DeliveriesPage() {
  const { language, t } = useLanguage();
  const queryClient = useQueryClient();
  const [taskId, setTaskId] = useState('');
  const [relativePath, setRelativePath] = useState('');
  const [page, setPage] = useState(0);
  const pageSize = 50;
  const query = useQuery({ queryKey: ['deliveries'], queryFn: async () => (await fetchDeliveries()).deliveries });
  const artifact = useMutation({
    mutationFn: () => recordTaskArtifact(taskId, relativePath),
    onSuccess: async () => {
      setRelativePath('');
      await queryClient.invalidateQueries({ queryKey: ['deliveries'] });
    },
  });
  return (
    <main className="mx-auto max-w-5xl space-y-4 p-6">
      <div><h1 className="text-2xl font-semibold">{t('delivery.title', 'Deliveries')}</h1><p className="text-sm text-muted-foreground">{t('delivery.subtitle', 'Only results with usable task evidence are shown here.')}</p></div>
      <details className="rounded-lg border p-3 text-sm">
        <summary className="cursor-pointer font-medium">{t('delivery.advancedArtifact', 'Advanced: record an existing local artifact')}</summary>
        <p className="mt-2 max-w-3xl text-xs leading-5 text-muted-foreground">
          {t('delivery.advancedArtifactExplain', 'Use this only when automatic evidence cannot see an existing file such as an APK, app bundle, archive, or test report. The task ID and repository-relative path create an explicit local evidence link; the file is hashed locally and is not uploaded or copied.')}
        </p>
        <section className="mt-3 flex flex-wrap items-end gap-2">
          <label>{t('delivery.taskId', 'Task ID')} <input className="ml-1 rounded border bg-background px-2 py-1 font-mono" value={taskId} onChange={(event) => setTaskId(event.target.value)} /></label>
          <label>{t('delivery.artifactPath', 'Artifact path')} <input className="ml-1 rounded border bg-background px-2 py-1" placeholder="build/app.bundle" value={relativePath} onChange={(event) => setRelativePath(event.target.value)} /></label>
          <Button variant="outline" disabled={!taskId || !relativePath || artifact.isPending} onClick={() => artifact.mutate()}>{t('delivery.recordArtifact', 'Record local artifact')}</Button>
        </section>
      </details>
      {artifact.isError && <p className="text-sm text-destructive">{t('delivery.recordFailed', 'The task-scoped artifact could not be recorded.')}</p>}
      {query.isLoading && <p className="text-sm text-muted-foreground">{t('delivery.loading', 'Loading deliveries…')}</p>}
      {query.isError && <p className="text-sm text-destructive">{t('delivery.listUnavailable', 'Delivery list is unavailable.')}</p>}
      {query.data?.length === 0 && <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">{t('delivery.empty', 'No task-linked delivery results yet. Sync history after completing work to refresh this list.')}</p>}
      {query.data?.slice(page * pageSize, (page + 1) * pageSize).map((delivery) => (
        <Card key={delivery.id}>
          <CardHeader className="flex flex-row items-start justify-between gap-3">
            <CardTitle className="text-base">{deliveryDisplayTitle(delivery, t)}</CardTitle>
            <Link className="shrink-0 text-xs font-medium text-primary underline" to={`/deliveries/${encodeURIComponent(delivery.id)}`}>{t('delivery.openDetail', 'View details')}</Link>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-muted-foreground">
            <p>{deliveryExplanation(delivery, t)}</p>
            <p>{new Date(delivery.occurredAt).toLocaleString(language === 'zh-CN' ? 'zh-CN' : 'en-US')}</p>
            {delivery.taskRefs && delivery.taskRefs.length > 0 && <div className="flex flex-wrap items-center gap-2"><span>{t('delivery.linkedTasks', 'Linked task')}:</span>{delivery.taskRefs.slice(0, 3).map((task) => <Link key={task.id} className="rounded bg-muted px-2 py-1 text-xs text-foreground hover:underline" to={`/tasks/${encodeURIComponent(task.id)}`}>{readableSessionTitle(task.title, t('work.unnamedTask', 'Unnamed task'), t)}</Link>)}</div>}
            <details className="pt-1 text-xs"><summary className="cursor-pointer font-medium text-foreground">{t('delivery.technicalDetails', 'Technical details')}</summary><p className="mt-2 break-all font-mono">{delivery.resultIdentity}</p></details>
          </CardContent>
        </Card>
      ))}
      {(query.data?.length ?? 0) > pageSize && <div className="flex items-center justify-between border-t pt-4 text-sm"><span className="text-muted-foreground">{page * pageSize + 1}–{Math.min((page + 1) * pageSize, query.data!.length)} / {query.data!.length}</span><div className="flex gap-2"><Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage((value) => Math.max(0, value - 1))}>{t('work.previous', 'Previous')}</Button><Button variant="outline" size="sm" disabled={(page + 1) * pageSize >= query.data!.length} onClick={() => setPage((value) => value + 1)}>{t('work.next', 'Next')}</Button></div></div>}
    </main>
  );
}
