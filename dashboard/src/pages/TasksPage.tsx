import { Link } from 'react-router';
import { useWorkTasks } from '@/hooks/useWorkTasks';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { CheckCircle2, GitCommit, MessagesSquare } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/i18n/LanguageProvider';
import { readableSessionTitle, repositoryDisplayName } from '@/lib/presentation';
import { Badge } from '@/components/ui/badge';

export default function TasksPage() {
  const { t } = useLanguage();
  const [page, setPage] = useState(0);
  const pageSize = 50;
  const { data, isLoading } = useWorkTasks(page, pageSize);
  const tasks = data?.tasks ?? [];
  const total = data?.total ?? 0;
  return (
    <main className="mx-auto max-w-5xl space-y-4 p-6">
      <div>
        <h1 className="text-2xl font-semibold">{t('work.title', 'Work records')}</h1>
        <p className="text-sm text-muted-foreground">{t('work.subtitle', 'All supported agents appear in session analytics. Codex additionally provides task trees, delivery evidence, and automatic advice. Sensitive message bodies stay hidden.')}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
        <span>{t('work.listHint', 'Each row is one main goal. The analysis badge shows whether its original conversation already has LLM insights.')}</span>
        <Link to="/sessions" className="ml-auto inline-flex items-center gap-1 font-medium text-foreground hover:underline"><MessagesSquare className="h-3.5 w-3.5" />{t('work.openSessions', 'View conversations')}</Link>
        <Link to="/deliveries" className="inline-flex items-center gap-1 font-medium text-foreground hover:underline"><GitCommit className="h-3.5 w-3.5" />{t('work.openDeliveries', 'View deliveries')}</Link>
      </div>
      {isLoading && <p className="text-sm text-muted-foreground">{t('work.loading', 'Loading task evidence…')}</p>}
      {!isLoading && tasks.length === 0 && <p className="text-sm text-muted-foreground">{t('work.empty', 'No recognizable Codex tasks have been imported yet. Other agent sessions remain available in the session list.')}</p>}
      {tasks.map((task) => (
        <Link key={task.id} to={`/tasks/${encodeURIComponent(task.id)}`} className="block">
          <Card className="transition-colors hover:bg-muted/30">
            <CardHeader>
              <div className="flex items-start justify-between gap-3">
                <CardTitle className="text-base">
                  {readableSessionTitle(
                    task.sessionTitle,
                    `${repositoryDisplayName(task.repository.root ?? task.repository.worktree) ?? t('work.unnamedTask', 'Unnamed')} ${t('work.taskSuffix', 'task')}`,
                    t,
                  )}
                </CardTitle>
                <Badge variant={task.analysisStatus === 'analyzed' ? 'secondary' : 'outline'} className="shrink-0 gap-1">
                  {task.analysisStatus === 'analyzed' && <CheckCircle2 className="h-3 w-3 text-emerald-500" />}
                  {task.analysisStatus === 'analyzed' ? t('work.analyzed', 'Analyzed') : t('work.notAnalyzed', 'Not analyzed')}
                </Badge>
              </div>
              <CardDescription>{t(`status.${task.status}`, task.status)} · {new Date(task.startedAt).toLocaleString()}</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-x-2 text-sm text-muted-foreground">
              <span>{repositoryDisplayName(task.repository.root ?? task.repository.worktree) ?? t('task.repoUnknown', 'Repository unknown')}</span>
              <span>·</span>
              <span>{task.repository.branch ?? t('work.branchUnknown', 'branch unknown')}</span>
            </CardContent>
          </Card>
        </Link>
      ))}
      {total > pageSize && <div className="flex items-center justify-between border-t pt-4 text-sm"><span className="text-muted-foreground">{page * pageSize + 1}–{Math.min((page + 1) * pageSize, total)} / {total}</span><div className="flex gap-2"><Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage((value) => Math.max(0, value - 1))}>{t('work.previous', 'Previous')}</Button><Button variant="outline" size="sm" disabled={(page + 1) * pageSize >= total} onClick={() => setPage((value) => value + 1)}>{t('work.next', 'Next')}</Button></div></div>}
    </main>
  );
}
