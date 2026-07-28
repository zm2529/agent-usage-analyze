import { useMemo } from 'react';
import { Badge } from '@/components/ui/badge';
import { useAnalysisRuns } from '@/hooks/useAnalysisRuns';
import { useLanguage } from '@/i18n/LanguageProvider';
import type { AnalysisRunRecord } from '@/lib/types';

function formattedJson(value: string | null): string {
  if (!value) return '';
  try {
    return JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    return value;
  }
}

function parseStoredDate(value: string): Date {
  const sqliteUtc = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value);
  return new Date(sqliteUtc ? `${value.replace(' ', 'T')}Z` : value);
}

function RunDetails({ run, hasCurrentConversationEvidence = false }: {
  run: AnalysisRunRecord;
  hasCurrentConversationEvidence?: boolean;
}) {
  const { language, t } = useLanguage();
  const summary = useMemo(() => JSON.stringify(run.inputSummary, null, 2), [run.inputSummary]);
  const statusLabel = t(`analysisRun.status.${run.status}`, run.status);
  const statusVariant = run.status === 'completed' ? 'secondary' : 'outline';
  const staleUnavailable = hasCurrentConversationEvidence
    && run.status === 'unavailable'
    && run.unavailableReason === 'no-human-messages';

  return (
    <details className="rounded-md border bg-background px-3 py-2">
      <summary className="cursor-pointer list-none">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <Badge variant={statusVariant}>{staleUnavailable ? '历史结果' : statusLabel}</Badge>
          <span className="font-medium">{t(`analysisRun.type.${run.analysisType}`, run.analysisType)}</span>
          {!staleUnavailable && (
            <span className="text-muted-foreground">{run.provider ?? t('analysisRun.noProvider', 'No provider')}</span>
          )}
          {run.model && <span className="text-muted-foreground">· {run.model}</span>}
          <span className="ml-auto text-muted-foreground">
            {new Intl.DateTimeFormat(language === 'zh-CN' ? 'zh-CN' : 'en-US', {
              dateStyle: 'short', timeStyle: 'medium',
            }).format(parseStoredDate(run.createdAt))}
          </span>
        </div>
        {staleUnavailable ? (
          <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">
            这次记录生成后已导入新的对话内容，需要重新分析；它不代表当前会话仍然证据不足。
          </p>
        ) : run.unavailableReason && (
          <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">
            {t('analysisRun.unavailableReason', 'Unavailable reason')}: {t(`analysisRun.reason.${run.unavailableReason}`, run.unavailableReason)}
          </p>
        )}
      </summary>

      <div className="mt-3 space-y-3 border-t pt-3 text-xs">
        <dl className="grid gap-2 sm:grid-cols-2 lg:grid-cols-6">
          <div><dt className="text-muted-foreground">{t('analysisRun.promptVersion', 'Prompt version')}</dt><dd className="font-mono">{run.promptVersion}</dd></div>
          <div><dt className="text-muted-foreground">{t('analysisRun.duration', 'Duration')}</dt><dd>{run.durationMs == null ? '—' : `${(run.durationMs / 1000).toFixed(1)}s`}</dd></div>
          <div><dt className="text-muted-foreground">{t('analysisRun.inputTokens', 'Input tokens')}</dt><dd>{run.inputTokens ?? '—'}</dd></div>
          <div><dt className="text-muted-foreground">{t('analysisRun.outputTokens', 'Output tokens')}</dt><dd>{run.outputTokens ?? '—'}</dd></div>
          <div><dt className="text-muted-foreground">{language === 'zh-CN' ? '缓存写入' : 'Cache writes'}</dt><dd>{run.cacheCreationTokens ?? '—'}</dd></div>
          <div><dt className="text-muted-foreground">{language === 'zh-CN' ? '缓存命中' : 'Cache reads'}</dt><dd>{run.cacheReadTokens ?? '—'}</dd></div>
        </dl>

        <details>
          <summary className="cursor-pointer font-medium">{t('analysisRun.inputSummary', 'Input summary')}</summary>
          <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded bg-muted p-3 font-mono">{summary}</pre>
        </details>
        {run.systemPrompt && <details>
          <summary className="cursor-pointer font-medium">{t('analysisRun.systemPrompt', 'System prompt')}</summary>
          <pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap rounded bg-muted p-3 font-mono">{run.systemPrompt}</pre>
        </details>}
        {run.inputPrompt && <details>
          <summary className="cursor-pointer font-medium">{t('analysisRun.actualInput', 'Actual model input')}</summary>
          <pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap rounded bg-muted p-3 font-mono">{run.inputPrompt}</pre>
        </details>}
        {run.outputJson && <details>
          <summary className="cursor-pointer font-medium">{t('analysisRun.rawOutput', 'Raw structured output')}</summary>
          <pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap rounded bg-muted p-3 font-mono">{formattedJson(run.outputJson)}</pre>
        </details>}
      </div>
    </details>
  );
}

export function AnalysisRunTrace({ sessionId, analysisType, hasCurrentConversationEvidence = false }: {
  sessionId?: string;
  analysisType?: string;
  hasCurrentConversationEvidence?: boolean;
}) {
  const { t } = useLanguage();
  const query = useAnalysisRuns({ sessionId, analysisType, limit: 5 });

  return (
    <section className="rounded-lg border border-dashed bg-muted/20 p-4">
      <h3 className="text-sm font-medium">{t('analysisRun.title', 'LLM analysis record')}</h3>
      <p className="mt-1 text-xs text-muted-foreground">
        {t('analysisRun.description', 'Shows how analysis started, the prompt and input sent to the selected model, and the exact structured result returned. These details remain local.')}
      </p>
      <div className="mt-3 space-y-2">
        {query.isLoading && <p className="text-xs text-muted-foreground">{t('common.loading', 'Loading…')}</p>}
        {query.isError && <p className="text-xs text-destructive">{t('analysisRun.loadError', 'Could not load analysis records.')}</p>}
        {!query.isLoading && !query.isError && query.data?.length === 0 && (
          <p className="text-xs text-muted-foreground">{t('analysisRun.empty', 'No LLM analysis has run yet.')}</p>
        )}
        {query.data?.map((run) => (
          <RunDetails
            key={run.id}
            run={run}
            hasCurrentConversationEvidence={hasCurrentConversationEvidence}
          />
        ))}
      </div>
    </section>
  );
}

const BEHAVIOR_PHASES = [
  ['behavior_research', '研究', 'Research'],
  ['session', '会话分析', 'Session analysis'],
  ['behavior_coach', '建议形成', 'Recommendation synthesis'],
  ['behavior_report', '报告汇总', 'Report assembly'],
] as const;

export function BehaviorAnalysisRunTimeline({ running = false }: { running?: boolean }) {
  const { language, t } = useLanguage();
  const queries = [
    useAnalysisRuns({ analysisType: 'behavior_research', limit: 3, poll: running }),
    useAnalysisRuns({ analysisType: 'session', limit: 3, poll: running }),
    useAnalysisRuns({ analysisType: 'behavior_coach', limit: 3, poll: running }),
    useAnalysisRuns({ analysisType: 'behavior_report', limit: 3, poll: running }),
  ];
  return <section className="border-y">
    <div className="border-b py-5">
      <h3 className="text-sm font-semibold">{t('analysisRun.title', 'LLM analysis record')}</h3>
      <p className="mt-1 text-xs text-muted-foreground">
        {t('analysisRun.description', 'Shows how analysis started, the prompt and input sent to the selected model, and the exact structured result returned. These details remain local.')}
      </p>
    </div>
    {BEHAVIOR_PHASES.map(([type, zhLabel, enLabel], index) => {
      const query = queries[index]!;
      return <div key={type} className="border-b py-4 last:border-b-0">
        <div className="mb-2 flex items-center gap-3">
          <span className="vibe-mono text-[10px] tabular-nums text-[#365D8D]">{String(index + 1).padStart(2, '0')}</span>
          <h4 className="text-sm font-medium">{language === 'zh-CN' ? zhLabel : enLabel}</h4>
          {query.isLoading && <span className="text-xs text-muted-foreground">{t('common.loading', 'Loading…')}</span>}
          {!query.isLoading && query.data?.length === 0 && <span className="text-xs text-muted-foreground">
            {running ? (language === 'zh-CN' ? '等待此阶段' : 'Waiting for this stage') : t('analysisRun.empty', 'No LLM analysis has run yet.')}
          </span>}
        </div>
        <div className="space-y-2 pl-8">{query.data?.map((run) => <RunDetails key={run.id} run={run} />)}</div>
      </div>;
    })}
  </section>;
}
