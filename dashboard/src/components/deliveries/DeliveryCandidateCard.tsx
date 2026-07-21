import { Link } from 'react-router';
import type { TaskDeliveryCandidate } from '@/lib/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { eventAnchorHref } from '@/lib/event-links';

export function DeliveryCandidateCard({
  candidate,
  showTaskLink = false,
  showDeliveryLink = false,
}: {
  candidate: TaskDeliveryCandidate;
  showTaskLink?: boolean;
  showDeliveryLink?: boolean;
}) {
  return (
    <Card>
      <CardHeader className="space-y-1">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="font-mono text-sm">
            {showDeliveryLink
              ? <Link className="underline" to={`/deliveries/${encodeURIComponent(candidate.delivery.id)}`}>{candidate.delivery.resultIdentity}</Link>
              : candidate.delivery.resultIdentity}
          </CardTitle>
          <span className="rounded-full border px-2 py-0.5 text-xs">{candidate.status}</span>
        </div>
        {showTaskLink && <p className="text-xs">Task <Link className="font-mono underline" to={`/tasks/${encodeURIComponent(candidate.taskId)}`}>{candidate.taskId}</Link></p>}
      </CardHeader>
      <CardContent className="space-y-2 text-xs text-muted-foreground">
        <p>{candidate.delivery.kind} · confidence {Math.round(candidate.confidence * 100)}% · coverage {Math.round(candidate.coverage * 100)}% · {candidate.algorithmVersion}</p>
        <ul className="space-y-1">
          {candidate.evidence.map((record) => (
            <li key={record.id} className="space-y-0.5 font-mono">
              <p>{record.evidenceType} · {record.position} · {record.sourceCategory} · {Math.round(record.confidence * 100)}%</p>
              <p>{record.eraCompatibility} · {record.eraIds.length > 0 ? record.eraIds.join(', ') : 'era unknown'}</p>
              {record.facts.map((fact) => <p key={`${record.id}:${fact.taskId}:${fact.factRef ?? fact.deliveryId}`}>
                task <Link className="underline" to={`/tasks/${encodeURIComponent(fact.taskId)}`}>{fact.taskId}</Link>
                {fact.factRef && <> · event <Link className="underline" to={eventAnchorHref(fact.taskId, fact.factRef)}>{fact.factRef}</Link></>}
              </p>)}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
