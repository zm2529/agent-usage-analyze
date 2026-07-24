import type { QueueLifecycleStatus, QueueStatus } from '../db/queue.js';
import type { AnalysisExecutionState } from './execution-policy.js';

export interface AutomaticAnalysisStatus {
  recentStatus: QueueLifecycleStatus | 'not-run';
  effectiveRunner: AnalysisExecutionState['effectiveRunner'];
  authentication: AnalysisExecutionState['authentication'];
  downgradeReason: string | null;
  nextAction: string;
}

function nextAction(reason: string | null, status: AutomaticAnalysisStatus['recentStatus']): string {
  if (reason === 'codex-not-logged-in') {
    return 'Run `codex login`, then `agent-usage-analyze queue retry --all`.';
  }
  if (reason === 'codex-cli-missing') {
    return 'Install Codex CLI, sign in, then run `agent-usage-analyze queue retry --all`.';
  }
  if (reason === 'codex-auth-unknown') {
    return 'Run `codex login status`; choose an explicit analysis mode if needed, then run `agent-usage-analyze queue retry --all`.';
  }
  if (reason === 'provider-not-configured') {
    return 'Run `agent-usage-analyze config llm`, then `agent-usage-analyze queue retry --all`.';
  }
  if (reason === 'source-not-found' || reason === 'compatibility-projection-unavailable') {
    return 'Run `agent-usage-analyze import-codex`, then retry this source and session from the queue.';
  }
  if (reason === 'settled-analysis-failed') {
    return 'Inspect `settled-analysis.log`, fix the reported capability, then run `agent-usage-analyze queue retry --all`.';
  }
  if (reason === 'settled-import-failed') {
    return 'Run `agent-usage-analyze import-codex`, inspect the import failure, then run `agent-usage-analyze queue retry --all`.';
  }
  if (reason === 'explicit-local-only') return 'Select auto or an explicit remote runner to enable automatic model analysis.';
  if (reason === 'explicit-off') return 'Set analysis mode to auto or another runner to enable automatic analysis.';
  if (status === 'failed' || status === 'awaiting-capability') {
    return 'Resolve the reported downgrade, then run `agent-usage-analyze queue retry --all`.';
  }
  return reason === null ? 'No action required.' : 'Review the selected analysis mode and downgrade reason.';
}

export function buildAutomaticAnalysisStatus(
  queue: QueueStatus,
  execution: AnalysisExecutionState,
): AutomaticAnalysisStatus {
  const recentStatus = queue.latestAutomatic?.status ?? 'not-run';
  const blocked = recentStatus === 'awaiting-capability' || recentStatus === 'failed'
    || execution.effectiveRunner === 'local-only' || execution.effectiveRunner === 'unavailable'
    || execution.effectiveRunner === 'off';
  const downgradeReason = blocked
    ? (queue.latestAutomatic?.diagnostic ?? execution.reason)
    : null;
  return {
    recentStatus,
    effectiveRunner: execution.effectiveRunner,
    authentication: execution.authentication,
    downgradeReason,
    nextAction: nextAction(downgradeReason, recentStatus),
  };
}
