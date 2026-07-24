import { useEffect, useRef } from 'react';
import { Link, useLocation, useParams } from 'react-router';
import { useWorkTask } from '@/hooks/useWorkTasks';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { eventAnchorId } from '@/lib/event-links';
import { DeliveryCandidateCard } from '@/components/deliveries/DeliveryCandidateCard';
import { useLanguage } from '@/i18n/LanguageProvider';
import { readableSessionTitle, repositoryDisplayName } from '@/lib/presentation';
import { Badge } from '@/components/ui/badge';
import { CheckCircle2 } from 'lucide-react';

export default function TaskDetailPage() {
  const { t } = useLanguage();
  const { hash } = useLocation();
  const showDiagnosticEvidence = hash.startsWith('#event-');
  const rawEvidenceRef = useRef<HTMLDetailsElement>(null);
  const { id } = useParams();
  const { data: task, isLoading, isError } = useWorkTask(id);
  useEffect(() => {
    if (!task || !hash.startsWith('#event-')) return;
    if (rawEvidenceRef.current) rawEvidenceRef.current.open = true;
    requestAnimationFrame(() => document.getElementById(decodeURIComponent(hash.slice(1)))?.scrollIntoView());
  }, [hash, task]);
  if (isLoading) return <main className="p-6 text-sm text-muted-foreground">{t('task.loading', 'Loading task evidence…')}</main>;
  if (isError || !task) return <main className="p-6">{t('task.notFound', 'Task not found.')}</main>;
  const rootNode = task.nodes.find((node) => node.id === task.id) ?? task.nodes[0];
  const taskTitle = readableSessionTitle(
    rootNode?.sessionTitle,
    `${repositoryDisplayName(rootNode?.repository.root ?? rootNode?.repository.worktree) ?? t('work.unnamedTask', 'Unnamed')} ${t('work.taskSuffix', 'task')}`,
    t,
  );
  const collaborators = task.nodes.filter((node) => node.id !== rootNode?.id);
  return (
    <main className="mx-auto max-w-6xl space-y-6 p-6">
      <div>
        <Link to="/tasks" className="text-sm text-muted-foreground hover:text-foreground">← {t('work.title', 'Work records')}</Link>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-semibold">{taskTitle}</h1>
          <Badge variant={task.analysisStatus === 'analyzed' ? 'secondary' : 'outline'} className="gap-1">
            {task.analysisStatus === 'analyzed' && <CheckCircle2 className="h-3 w-3 text-emerald-500" />}
            {task.analysisStatus === 'analyzed' ? t('work.analyzed', 'Analyzed') : t('work.notAnalyzed', 'Not analyzed')}
          </Badge>
        </div>
        {task.sessionId && <Link className="mt-2 inline-block text-sm font-medium text-primary underline" to={`/sessions?session=${encodeURIComponent(task.sessionId)}`}>{t('task.openSession', 'Open source session')}</Link>}
      </div>
      {rootNode && <Card>
        <CardHeader><CardTitle className="text-base">{t('task.overview', 'Task overview')}</CardTitle></CardHeader>
        <CardContent className="grid gap-3 text-sm sm:grid-cols-3">
          <div><p className="text-xs text-muted-foreground">{t('task.status', 'Status')}</p><p className="mt-1 font-medium">{t(`status.${rootNode.status}`, rootNode.status)}</p></div>
          <div><p className="text-xs text-muted-foreground">{t('task.repo', 'Repository')}</p><p className="mt-1 font-medium">{repositoryDisplayName(rootNode.repository.root ?? rootNode.repository.worktree) ?? t('task.unknown', 'unknown')}</p></div>
          <div><p className="text-xs text-muted-foreground">{t('task.branch', 'Branch')}</p><p className="mt-1 font-medium">{rootNode.repository.branch ?? t('task.unknown', 'unknown')}</p></div>
        </CardContent>
      </Card>}
      {collaborators.length > 0 && <section>
        <h2 className="mb-3 text-lg font-semibold">{t('task.collaborators', 'Participating agents')}</h2>
        <div className="grid gap-3 md:grid-cols-2">
        {collaborators.map((node) => (
          <Card key={node.id}>
            <CardHeader><CardTitle className="text-sm">{t(`role.${node.role}`, node.role)}</CardTitle></CardHeader>
            <CardContent className="text-sm">
              {t('task.status', 'Status')}: {t(`status.${node.status}`, node.status)}<br />
              {t('task.repo', 'Repository')}: {repositoryDisplayName(node.repository.root ?? node.repository.worktree) ?? t('task.unknown', 'unknown')}<br />
              {t('task.branch', 'Branch')}: {node.repository.branch ?? t('task.unknown', 'unknown')}
            </CardContent>
          </Card>
        ))}
        </div>
      </section>
      }
      <section>
        <h2 className="mb-3 text-lg font-semibold">{t('task.deliveries', 'Delivery evidence')}</h2>
        <div className="space-y-2">
          {task.deliveries.length === 0 && <p className="text-sm text-muted-foreground">{t('task.noDeliveries', 'No delivery evidence is linked to this task yet.')}</p>}
          {task.deliveries.map((candidate) => <DeliveryCandidateCard key={candidate.id} candidate={candidate} showDeliveryLink taskTitle={taskTitle} />)}
        </div>
      </section>
      <details className="rounded-lg border p-3 text-xs text-muted-foreground">
        <summary className="cursor-pointer font-medium text-foreground">{t('task.technicalDetails', 'Technical details')}</summary>
        <div className="mt-2 space-y-1 font-mono">
          <p>{t('work.taskId', 'Task ID')}: {task.id}</p>
          {rootNode?.repository.root && <p>{t('task.repo', 'Repository')}: {rootNode.repository.root}</p>}
          {rootNode?.repository.worktree && <p>{t('task.worktree', 'Worktree')}: {rootNode.repository.worktree}</p>}
        </div>
      </details>
      {showDiagnosticEvidence && <details ref={rawEvidenceRef} className="rounded-lg border bg-card">
        <summary className="cursor-pointer px-4 py-3 text-sm font-medium">{t('task.rawEvidence', 'Advanced raw evidence')}</summary>
        <div className="space-y-6 border-t p-4">
          <p className="text-xs text-muted-foreground">
            {task.coverage.discovered} {t('task.sources', 'sources')} · {task.coverage.parsed} {t('task.parsed', 'parsed')} · {task.coverage.skipped} {t('task.skipped', 'skipped')} · {task.coverage.failed} {t('task.failed', 'failed')} · {task.coverage.unknown} {t('task.unknown', 'unknown')}
          </p>
          {task.diagnostics.map((diagnostic) => <p key={`${diagnostic.severity}:${diagnostic.code}`} className="text-xs text-muted-foreground">{diagnostic.severity}: {diagnostic.code} × {diagnostic.count}</p>)}
          <section>
            <h2 className="mb-3 text-lg font-semibold">{t('task.timeline', 'Timeline')}</h2>
            <div className="space-y-2">
              {task.events.map((event) => (
                <div id={eventAnchorId(event.id)} key={event.id} className="rounded-lg border p-3 text-sm">
                  <span className="font-medium">{event.kind}</span> · {event.actor} · {event.occurredAt}
                  <div className="mt-1 font-mono text-xs text-muted-foreground">
                    {t('task.source', 'Source')} {event.sourceArtifactId} · {t('task.sequence', 'sequence')} {event.sequence} · {event.payloadRef ? t('task.privatePayload', 'private payload referenced locally') : t('task.structuralOnly', 'structural metadata only')}
                  </div>
                </div>
              ))}
            </div>
          </section>
          <section>
            <h2 className="mb-3 text-lg font-semibold">{t('task.tokens', 'Token changes')}</h2>
            <div className="space-y-2 font-mono text-xs">
              {task.tokenDeltas.map((delta) => (
                <div key={delta.eventId} className="rounded-lg border p-3">
                  {delta.status} · {t('task.lane', 'lane')} {delta.laneKey} · {t('task.input', 'input')} {delta.inputTokens ?? t('task.unknown', 'unknown')} · {t('task.cachedInput', 'cached input')} {delta.cachedInputTokens ?? t('task.unknown', 'unknown')} · {t('task.cacheCreation', 'cache creation')} {delta.cacheCreationTokens ?? t('task.unknown', 'unknown')} · {t('task.output', 'output')} {delta.outputTokens ?? t('task.unknown', 'unknown')} · {t('task.reasoning', 'reasoning')} {delta.reasoningTokens ?? t('task.unknown', 'unknown')} · {t('task.compaction', 'compaction')} {delta.compactionTokens ?? t('task.unknown', 'unknown')}
                </div>
              ))}
            </div>
          </section>
        </div>
      </details>}
    </main>
  );
}
