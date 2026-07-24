import { Link } from 'react-router';
import type { TaskDeliveryCandidate } from '@/lib/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { eventAnchorHref } from '@/lib/event-links';
import { useLanguage } from '@/i18n/LanguageProvider';
import { deliveryExplanation, deliveryKindLabel, readableSessionTitle } from '@/lib/presentation';

export function DeliveryCandidateCard({
  candidate,
  showTaskLink = false,
  showDeliveryLink = false,
  taskTitle,
}: {
  candidate: TaskDeliveryCandidate;
  showTaskLink?: boolean;
  showDeliveryLink?: boolean;
  taskTitle?: string | null;
}) {
  const { t } = useLanguage();
  const evidenceLabel = (key: string) => t(`delivery.evidence.${key}`, key);
  const statusLabel = t(`delivery.relationship.${candidate.status}`, candidate.status);
  return (
    <Card>
      <CardHeader className="space-y-1">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-sm">
            {showDeliveryLink
              ? <Link className="underline" to={`/deliveries/${encodeURIComponent(candidate.delivery.id)}`}>{deliveryKindLabel(candidate.delivery, t)} · {t('delivery.openDetail', 'View details')}</Link>
              : deliveryKindLabel(candidate.delivery, t)}
          </CardTitle>
          <span className="rounded-full border px-2 py-0.5 text-xs">{statusLabel}</span>
        </div>
        {showTaskLink && <p className="text-xs">{t('delivery.linkedTasks', 'Linked task')}: <Link className="font-medium underline" to={`/tasks/${encodeURIComponent(candidate.taskId)}`}>{readableSessionTitle(taskTitle, t('work.unnamedTask', 'Unnamed task'), t)}</Link></p>}
      </CardHeader>
      <CardContent className="space-y-2 text-xs text-muted-foreground">
        <p className="leading-5">{deliveryExplanation(candidate.delivery, t)}</p>
        <div className="flex flex-wrap gap-1.5">
          {candidate.evidence.slice(0, 4).map((record) => <span key={record.id} className="rounded bg-muted px-2 py-1 text-foreground">{evidenceLabel(record.evidenceType)}</span>)}
        </div>
        <details className="rounded border px-3 py-2">
          <summary className="cursor-pointer font-medium text-foreground">{t('delivery.technicalDetails', 'Technical details')}</summary>
          <div className="mt-2 space-y-2 break-all font-mono">
            <p>{t('delivery.resultId', 'Result ID')}: {candidate.delivery.resultIdentity}</p>
            <p>{t('delivery.confidence', 'Confidence')} {Math.round(candidate.confidence * 100)}% · {t('delivery.coverage', 'Coverage')} {Math.round(candidate.coverage * 100)}% · {candidate.algorithmVersion}</p>
            {candidate.evidence.map((record) => <div key={record.id} className="space-y-0.5 border-t pt-2">
              <p>{evidenceLabel(record.evidenceType)} · {evidenceLabel(record.position)} · {evidenceLabel(record.sourceCategory)} · {Math.round(record.confidence * 100)}%</p>
              <p>{evidenceLabel(record.eraCompatibility)} · {record.eraIds.length > 0 ? record.eraIds.join(', ') : t('delivery.eraUnknown', 'era unknown')}</p>
              {record.facts.map((fact) => <p key={`${record.id}:${fact.taskId}:${fact.factRef ?? fact.deliveryId}`}>
                {fact.factRef?.startsWith('git-ai-note:')
                  ? <span>{t('delivery.provenance', 'Provenance digest')} {fact.factRef.slice('git-ai-note:'.length)}</span>
                  : fact.factRef && <Link className="underline" to={eventAnchorHref(fact.taskId, fact.factRef)}>{t('delivery.openRawEvent', 'Open raw event')}</Link>}
              </p>)}
            </div>)}
          </div>
        </details>
      </CardContent>
    </Card>
  );
}
