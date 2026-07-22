import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { useLlmConfig, useSaveLlmConfig } from '@/hooks/useConfig';
import type { AnalysisExecutionMode, AnalysisExecutionState } from '@/lib/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

const MODES: Array<{ value: AnalysisExecutionMode; label: string }> = [
  { value: 'auto', label: 'Auto (respect configured provider)' },
  { value: 'codex-native', label: 'Codex native' },
  { value: 'claude-native', label: 'Claude native' },
  { value: 'provider', label: 'Configured provider' },
  { value: 'local-only', label: 'Local only' },
  { value: 'off', label: 'Off' },
];

const reasonText = (state: Pick<AnalysisExecutionState, 'reason' | 'authentication'>): string => {
  if (state.reason === 'configured-provider') return 'Auto selected your configured provider.';
  if (state.reason === 'codex-chatgpt-auth') return 'Auto selected the signed-in ChatGPT Codex subscription.';
  if (state.reason === 'explicit-codex-native-metered') return 'Codex is authenticated with an API key; standard API pricing applies.';
  if (state.reason.includes('access-token')) return 'Codex access-token use is explicit and is never selected automatically.';
  if (state.reason === 'codex-api-key-not-automatic') return 'API-key Codex is not selected automatically because standard API pricing may apply.';
  if (state.reason === 'codex-cli-missing') return 'Codex CLI was not found; automatic analysis stays local.';
  if (state.reason === 'codex-not-logged-in') return 'Codex is not logged in; automatic analysis stays local.';
  if (state.reason === 'codex-auth-unknown') return 'Codex authentication could not be classified; automatic analysis stays local.';
  if (state.reason === 'provider-not-configured') return 'Configure a provider before selecting provider mode.';
  if (state.reason === 'claude-cli-missing') return 'Claude CLI was not found.';
  if (state.reason === 'explicit-local-only') return 'Only deterministic local analysis will run.';
  if (state.reason === 'explicit-off') return 'Automatic analysis is disabled.';
  return `Selected by ${state.reason}.`;
};

export function AnalysisExecutionPolicyStatus({
  mode, effectiveRunner, authentication, locality, reason, pending, onSave,
}: AnalysisExecutionState & { pending: boolean; onSave: (mode: AnalysisExecutionMode) => void }) {
  const [selected, setSelected] = useState(mode);
  useEffect(() => setSelected(mode), [mode]);
  return (
    <Card aria-label="Analysis execution policy">
      <CardHeader>
        <div className="flex items-center gap-2">
          <CardTitle className="text-base">Analysis execution</CardTitle>
          <Badge className="ml-auto" variant={effectiveRunner === 'unavailable' ? 'destructive' : 'secondary'}>
            {effectiveRunner} · {locality}
          </Badge>
        </div>
        <CardDescription>
          Auto keeps an existing provider choice; otherwise it only reuses a clearly identified ChatGPT Codex login.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <label className="block font-medium" htmlFor="analysis-mode">Mode</label>
        <select
          id="analysis-mode"
          className="h-9 w-full rounded-md border bg-background px-3"
          value={selected}
          disabled={pending}
          onChange={(event) => setSelected(event.target.value as AnalysisExecutionMode)}
        >
          {MODES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
        </select>
        <p>{reasonText({ reason, authentication })}</p>
        <p className="text-xs text-muted-foreground">Authentication: {authentication}. Subscription usage and observer overhead are recorded; no monetary cost is inferred.</p>
        <Button disabled={pending || selected === mode} onClick={() => onSave(selected)}>Save analysis mode</Button>
      </CardContent>
    </Card>
  );
}

export function AnalysisExecutionPolicyCard() {
  const config = useLlmConfig();
  const save = useSaveLlmConfig();
  const state = config.data?.analysis;
  if (!state) return null;
  const update = async (mode: AnalysisExecutionMode) => {
    try {
      await save.mutateAsync({ analysisMode: mode });
      toast.success('Analysis execution mode updated');
    } catch {
      toast.error('Could not update analysis execution mode');
    }
  };
  return <AnalysisExecutionPolicyStatus {...state} pending={config.isLoading || save.isPending} onSave={(mode) => { void update(mode); }} />;
}
