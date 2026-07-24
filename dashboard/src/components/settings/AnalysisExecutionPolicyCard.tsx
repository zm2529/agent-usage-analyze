import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { useLlmConfig, useSaveLlmConfig } from '@/hooks/useConfig';
import type { AnalysisExecutionMode, AnalysisExecutionState } from '@/lib/types';
import type { AnalysisQueueItem } from '@/lib/api';
import { useAnalysisQueue } from '@/hooks/useAnalysisQueue';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useLanguage } from '@/i18n/LanguageProvider';

const MODES: Array<{ value: AnalysisExecutionMode; key: string; fallback: string }> = [
  { value: 'auto', key: 'execution.auto', fallback: 'Auto (respect configured provider)' },
  { value: 'codex-native', key: 'execution.codex', fallback: 'Codex native' },
  { value: 'claude-native', key: 'execution.legacy', fallback: 'Legacy native mode' },
  { value: 'provider', key: 'execution.provider', fallback: 'Configured provider' },
  { value: 'local-only', key: 'execution.local', fallback: 'Local only' },
  { value: 'off', key: 'execution.off', fallback: 'Off' },
];

type Translate = (key: string, fallback?: string) => string;

const reasonText = (state: Pick<AnalysisExecutionState, 'reason' | 'authentication'>, t: Translate): string => {
  if (state.reason === 'configured-provider') return t('execution.reason.provider', 'Auto selected your configured provider.');
  if (state.reason === 'codex-chatgpt-auth') return t('execution.reason.codex', 'Auto selected the signed-in ChatGPT Codex subscription.');
  if (state.reason === 'explicit-codex-native-metered') return t('execution.reason.metered', 'Codex is authenticated with an API key; standard API pricing applies.');
  if (state.reason.includes('access-token')) return t('execution.reason.token', 'Codex access-token use is explicit and is never selected automatically.');
  if (state.reason === 'codex-api-key-not-automatic') return t('execution.reason.apiKey', 'API-key Codex is not selected automatically because standard API pricing may apply.');
  if (state.reason === 'codex-cli-missing') return t('execution.reason.missing', 'Codex CLI was not found; automatic analysis stays local.');
  if (state.reason === 'codex-not-logged-in') return t('execution.reason.login', 'Codex is not logged in; automatic analysis stays local.');
  if (state.reason === 'codex-auth-unknown') return t('execution.reason.unknown', 'Codex authentication could not be classified; automatic analysis stays local.');
  if (state.reason === 'provider-not-configured') return t('execution.reason.noProvider', 'Configure a provider before selecting provider mode.');
  if (state.reason === 'claude-cli-missing') return t('execution.reason.legacyMissing', 'The configured legacy native runner was not found.');
  if (state.reason === 'explicit-local-only') return t('execution.reason.local', 'Only deterministic local analysis will run.');
  if (state.reason === 'explicit-off') return t('execution.reason.off', 'Automatic analysis is disabled.');
  return `${t('execution.selectedBy', 'Selected by')} ${state.reason}.`;
};

const recoveryText = (reason: string, t: Translate): string => {
  if (reason === 'codex-not-logged-in') return t('execution.recovery.login', 'Next: run `codex login`, then `agent-usage-analyze queue retry --all`.');
  if (reason === 'codex-cli-missing') return t('execution.recovery.missing', 'Next: install Codex CLI, sign in, then retry the analysis queue.');
  if (reason === 'source-not-found') return t('execution.recovery.source', 'Next: run `agent-usage-analyze import-codex`, then retry this source and session.');
  if (reason === 'settled-analysis-failed') return t('execution.recovery.analysis', 'Next: inspect `settled-analysis.log`, fix the issue, then run `agent-usage-analyze queue retry --all`.');
  if (reason === 'settled-import-failed') return t('execution.recovery.import', 'Next: run `agent-usage-analyze import-codex`, then `agent-usage-analyze queue retry --all`.');
  return t('execution.recovery.default', 'Next: resolve the downgrade reason, then run `agent-usage-analyze queue retry --all`.');
};

export function AnalysisExecutionPolicyStatus({
  mode, effectiveRunner, authentication, locality, reason, pending, onSave,
  recentAutomatic,
}: AnalysisExecutionState & {
  pending: boolean;
  onSave: (mode: AnalysisExecutionMode) => void;
  recentAutomatic?: AnalysisQueueItem | null;
}) {
  const { t } = useLanguage();
  const [selected, setSelected] = useState(mode);
  useEffect(() => setSelected(mode), [mode]);
  return (
    <Card aria-label={t('execution.policy', 'Analysis execution policy')}>
      <CardHeader>
        <div className="flex items-center gap-2">
          <CardTitle className="text-base">{t('execution.title', 'Analysis execution')}</CardTitle>
          <Badge className="ml-auto" variant={effectiveRunner === 'unavailable' ? 'destructive' : 'secondary'}>
            {effectiveRunner} · {locality}
          </Badge>
        </div>
        <CardDescription>
          {t('execution.desc', 'Auto keeps an existing provider choice; otherwise it only reuses a clearly identified ChatGPT Codex login.')}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <label className="block font-medium" htmlFor="analysis-mode">{t('execution.mode', 'Mode')}</label>
        <select
          id="analysis-mode"
          className="h-9 w-full rounded-md border bg-background px-3"
          value={selected}
          disabled={pending}
          onChange={(event) => setSelected(event.target.value as AnalysisExecutionMode)}
        >
          {MODES.map((item) => <option key={item.value} value={item.value}>{t(item.key, item.fallback)}</option>)}
        </select>
        <p>{reasonText({ reason, authentication }, t)}</p>
        <p className="text-xs text-muted-foreground">{t('execution.auth', 'Authentication')}: {authentication}. {t('execution.costNote', 'Subscription usage and observer overhead are recorded; no monetary cost is inferred.')}</p>
        {recentAutomatic && (
          <div className="rounded-md border p-3 text-xs space-y-1" aria-label={t('execution.recent', 'Recent automatic analysis')}>
            <p>{t('execution.recent', 'Recent automatic analysis')}: {recentAutomatic.status}</p>
            {recentAutomatic.diagnostic && <p>{t('execution.downgrade', 'Downgrade')}: {recentAutomatic.diagnostic}</p>}
            {recentAutomatic.diagnostic && <p>{recoveryText(recentAutomatic.diagnostic, t)}</p>}
          </div>
        )}
        <Button disabled={pending || selected === mode} onClick={() => onSave(selected)}>{t('execution.save', 'Save analysis mode')}</Button>
      </CardContent>
    </Card>
  );
}

export function AnalysisExecutionPolicyCard() {
  const { t } = useLanguage();
  const config = useLlmConfig();
  const save = useSaveLlmConfig();
  const queue = useAnalysisQueue();
  const state = config.data?.analysis;
  if (!state) return null;
  const update = async (mode: AnalysisExecutionMode) => {
    try {
      await save.mutateAsync({ analysisMode: mode });
      await queue.refetch();
      toast.success(t('execution.updated', 'Analysis execution mode updated'));
    } catch {
      toast.error(t('execution.updateFailed', 'Could not update analysis execution mode'));
    }
  };
  return <AnalysisExecutionPolicyStatus
    {...state}
    recentAutomatic={queue.data?.latestAutomatic}
    pending={config.isLoading || save.isPending}
    onSave={(mode) => { void update(mode); }}
  />;
}
