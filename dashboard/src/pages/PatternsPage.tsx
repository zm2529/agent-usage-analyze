import { useQuery } from '@tanstack/react-query';
import { ArrowRight, CheckCircle2, TrendingUp } from 'lucide-react';
import { Link } from 'react-router';
import { fetchPatternOverview } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ErrorCard } from '@/components/ErrorCard';
import { Skeleton } from '@/components/ui/skeleton';
import { useLanguage } from '@/i18n/LanguageProvider';

const LABEL_KEYS = {
  rework: ['patterns.rework', 'Repeated edits'],
  waiting: ['patterns.waiting', 'Long tool waits'],
  'context-switching': ['patterns.contextSwitching', 'Context switching'],
  'validation-missing': ['patterns.validationMissing', 'Missing validation'],
  'late-constraint': ['patterns.lateConstraint', 'Late constraints'],
  'repeated-failure': ['patterns.repeatedFailure', 'Repeated failures'],
} as const;

const FACT_KEYS = {
  rework: ['patterns.reworkFact', 'The same redacted file identity changed more than once in a task.'],
  waiting: ['patterns.waitingFact', 'A linked tool call and result were at least 60 seconds apart.'],
  'context-switching': ['patterns.contextSwitchingFact', 'A task moved between observed repository or worktree contexts.'],
  'validation-missing': ['patterns.validationMissingFact', 'A completed task changed files without an observed validation tool call.'],
  'late-constraint': ['patterns.lateConstraintFact', 'A user constraint arrived after the first observed file change.'],
  'repeated-failure': ['patterns.repeatedFailureFact', 'At least two explicit failed task lifecycle events were observed.'],
} as const;

export default function PatternsPage() {
  const { t } = useLanguage();
  const query = useQuery({ queryKey: ['pattern-overview'], queryFn: fetchPatternOverview });

  if (query.isLoading) {
    return <main className="mx-auto max-w-6xl space-y-4 p-4 lg:p-6"><Skeleton className="h-20 w-full" /><Skeleton className="h-48 w-full" /></main>;
  }
  if (query.isError || !query.data) {
    return <main className="mx-auto max-w-6xl p-4 lg:p-6"><ErrorCard message={t('patterns.loadError', 'Failed to load behavior analysis')} onRetry={() => { void query.refetch(); }} /></main>;
  }

  return (
    <main className="mx-auto max-w-6xl space-y-5 p-4 lg:p-6">
      <div>
        <p className="text-xs font-medium uppercase tracking-[0.16em] text-primary">{t('nav.improve', 'Analysis')}</p>
        <h1 className="mt-1 text-2xl font-bold">{t('patterns.title', 'Observed behavior patterns')}</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          {t('patterns.subtitle', 'Generated directly from imported local task evidence. No model configuration is required, and message bodies remain hidden.')}
        </p>
      </div>

      <Card className="border-primary/20 bg-primary/[0.04]">
        <CardContent className="flex flex-wrap items-center gap-3 p-4 text-sm">
          <CheckCircle2 className="h-5 w-5 text-emerald-600" />
          <span>{t('patterns.analyzed', 'Analyzed')} <strong>{query.data.analyzedTaskCount}</strong> {t('patterns.tasks', 'imported Codex tasks')}</span>
          <Link className="ml-auto inline-flex items-center gap-1 font-medium text-primary" to="/advice">
            {t('patterns.openAdvice', 'Open improvement advice')} <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </CardContent>
      </Card>

      {query.data.patterns.length === 0 ? (
        <Card><CardContent className="p-6 text-sm text-muted-foreground">{t('patterns.empty', 'No supported repeated behavior signal was found in the imported evidence. This is a valid result; the product does not invent a pattern when evidence is missing.')}</CardContent></Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {query.data.patterns.map((pattern) => {
            const label = LABEL_KEYS[pattern.pattern];
            const fact = FACT_KEYS[pattern.pattern];
            return (
              <Card key={pattern.pattern}>
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center gap-2 text-base"><TrendingUp className="h-4 w-4 text-primary" />{t(label[0], label[1])}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 text-sm">
                  <p className="text-muted-foreground">{t(fact[0], fact[1])}</p>
                  <p className="text-xs"><strong>{pattern.taskCount}</strong> {t('patterns.affectedTasks', 'tasks')} · <strong>{pattern.evidenceCount}</strong> {t('patterns.evidenceItems', 'evidence items')}</p>
                  <div className="flex flex-wrap gap-2">
                    {pattern.sampleTaskRefs.map((taskId) => (
                      <Link key={taskId} className="max-w-full truncate rounded border px-2 py-1 font-mono text-xs hover:bg-muted" to={`/tasks/${encodeURIComponent(taskId)}`}>{taskId}</Link>
                    ))}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </main>
  );
}
