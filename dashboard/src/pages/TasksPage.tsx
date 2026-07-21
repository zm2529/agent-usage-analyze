import { Link } from 'react-router';
import { useWorkTasks } from '@/hooks/useWorkTasks';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export default function TasksPage() {
  const { data: tasks = [], isLoading } = useWorkTasks();
  return (
    <main className="mx-auto max-w-5xl space-y-4 p-6">
      <div>
        <h1 className="text-2xl font-semibold">Work tasks</h1>
        <p className="text-sm text-muted-foreground">Evidence-first Codex task trees. Sensitive message bodies stay hidden.</p>
      </div>
      {isLoading && <p className="text-sm text-muted-foreground">Loading task evidence…</p>}
      {!isLoading && tasks.length === 0 && <p className="text-sm text-muted-foreground">No canonical Codex tasks imported yet.</p>}
      {tasks.map((task) => (
        <Link key={task.id} to={`/tasks/${encodeURIComponent(task.id)}`} className="block">
          <Card className="transition-colors hover:bg-muted/30">
            <CardHeader>
              <CardTitle className="font-mono text-sm">{task.id}</CardTitle>
              <CardDescription>{task.status} · {task.startedAt}</CardDescription>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              {task.repository.branch ?? 'branch unknown'} · {task.repository.worktree ?? 'worktree unknown'}
            </CardContent>
          </Card>
        </Link>
      ))}
    </main>
  );
}
