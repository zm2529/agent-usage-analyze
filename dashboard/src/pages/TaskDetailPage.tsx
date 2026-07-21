import { Link, useParams } from 'react-router';
import { useWorkTask } from '@/hooks/useWorkTasks';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export default function TaskDetailPage() {
  const { id } = useParams();
  const { data: task, isLoading, isError } = useWorkTask(id);
  if (isLoading) return <main className="p-6 text-sm text-muted-foreground">Loading task evidence…</main>;
  if (isError || !task) return <main className="p-6">Task not found.</main>;
  return (
    <main className="mx-auto max-w-6xl space-y-6 p-6">
      <div>
        <Link to="/tasks" className="text-sm text-muted-foreground hover:text-foreground">← Work tasks</Link>
        <h1 className="mt-2 font-mono text-xl font-semibold">{task.id}</h1>
        <p className="text-sm text-muted-foreground">{task.coverage.parsed} parsed events · {task.coverage.unknown} unknown</p>
      </div>
      <section className="grid gap-3 md:grid-cols-2">
        {task.nodes.map((node) => (
          <Card key={node.id}>
            <CardHeader><CardTitle className="font-mono text-sm">{node.id}</CardTitle></CardHeader>
            <CardContent className="text-sm">{node.role} · {node.status}<br />parent: {node.parentTaskId ?? 'root'}</CardContent>
          </Card>
        ))}
      </section>
      <section>
        <h2 className="mb-3 text-lg font-semibold">Timeline</h2>
        <div className="space-y-2">
          {task.events.map((event) => (
            <div key={event.id} className="rounded-lg border p-3 text-sm">
              <span className="font-medium">{event.kind}</span> · {event.actor} · {event.occurredAt}
              <div className="mt-1 font-mono text-xs text-muted-foreground">
                source {event.sourceArtifactId} · sequence {event.sequence} · {event.payloadRef ? 'private payload referenced locally' : 'structural only'}
              </div>
            </div>
          ))}
        </div>
      </section>
      <section>
        <h2 className="mb-3 text-lg font-semibold">Token deltas</h2>
        <div className="space-y-2 font-mono text-xs">
          {task.tokenDeltas.map((delta) => (
            <div key={delta.eventId} className="rounded-lg border p-3">
              {delta.status} · lane {delta.laneKey} · input {delta.inputTokens ?? 'unknown'} · cached {delta.cachedInputTokens ?? 'unknown'} · output {delta.outputTokens ?? 'unknown'} · reasoning {delta.reasoningTokens ?? 'unknown'}
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
