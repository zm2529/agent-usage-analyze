import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'react-router';
import { appendDeliveryCorrection, fetchDelivery } from '@/lib/api';
import { DeliveryCandidateCard } from '@/components/deliveries/DeliveryCandidateCard';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/i18n/LanguageProvider';
import { deliveryDisplayTitle, deliveryExplanation } from '@/lib/presentation';

export default function DeliveryDetailPage() {
  const { language, t } = useLanguage();
  const { id } = useParams();
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ['delivery', id], queryFn: async () => (await fetchDelivery(id!)).delivery, enabled: Boolean(id) });
  const correction = useMutation({
    mutationFn: ({ candidateId, decision }: { candidateId: string; decision: 'confirmed' | 'rejected' | 'pending' }) =>
      appendDeliveryCorrection(id!, candidateId, decision),
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: ['delivery', id] }),
  });
  if (query.isLoading) return <main className="p-6 text-sm text-muted-foreground">{t('delivery.loading', 'Loading delivery evidence…')}</main>;
  if (query.isError) return <main className="p-6 text-sm text-destructive">{t('delivery.listUnavailable', 'Delivery evidence is unavailable.')}</main>;
  if (!query.data) return <main className="p-6">{t('delivery.notFound', 'Delivery not found.')}</main>;
  return (
    <main className="mx-auto max-w-5xl space-y-4 p-6">
      <div>
        <h1 className="text-xl font-semibold">{deliveryDisplayTitle(query.data, t)}</h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">{deliveryExplanation(query.data, t)}</p>
        <p className="mt-1 text-xs text-muted-foreground">{new Date(query.data.occurredAt).toLocaleString(language === 'zh-CN' ? 'zh-CN' : 'en-US')}</p>
      </div>
      {query.data.candidates.length === 0 && <p className="text-sm text-muted-foreground">{t('delivery.noCandidate', 'No task candidate has enough evidence to display.')}</p>}
      {correction.isError && <p className="text-sm text-destructive">{t('delivery.correctionFailed', 'The correction could not be appended; existing evidence was not changed.')}</p>}
      {query.data.candidates.map((candidate) => (
        <section key={candidate.id} className="space-y-2">
          <DeliveryCandidateCard candidate={candidate} showTaskLink taskTitle={query.data.taskRefs?.find((task) => task.id === candidate.taskId)?.title} />
          <div className="flex gap-2">
            {(['confirmed', 'rejected', 'pending'] as const).map((decision) => (
              <Button key={decision} size="sm" variant="outline" disabled={correction.isPending}
                onClick={() => correction.mutate({ candidateId: candidate.id, decision })}>{t(`delivery.action.${decision}`, decision)}</Button>
            ))}
          </div>
        </section>
      ))}
      <details className="rounded-lg border p-3 text-xs text-muted-foreground">
        <summary className="cursor-pointer font-medium text-foreground">{t('delivery.technicalDetails', 'Technical details')}</summary>
        <p className="mt-2 break-all font-mono">{t('delivery.resultId', 'Result ID')}: {query.data.resultIdentity}</p>
      </details>
    </main>
  );
}
