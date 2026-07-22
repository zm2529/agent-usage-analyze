import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AnalysisExecutionPolicyStatus } from './AnalysisExecutionPolicyCard';

describe('AnalysisExecutionPolicyStatus', () => {
  it('explains that auto uses an explicitly configured provider first', () => {
    const onSave = vi.fn();
    render(<AnalysisExecutionPolicyStatus
      mode="auto"
      effectiveRunner="provider"
      authentication="provider"
      locality="local"
      reason="configured-provider"
      pending={false}
      onSave={onSave}
    />);

    expect(screen.getByText('Auto selected your configured provider.')).toBeInTheDocument();
    expect(screen.getByText(/provider · local/i)).toBeInTheDocument();
  });

  it('never labels API-key Codex authentication as free', () => {
    render(<AnalysisExecutionPolicyStatus
      mode="codex-native"
      effectiveRunner="codex-native"
      authentication="api-key"
      locality="remote"
      reason="explicit-codex-native-metered"
      pending={false}
      onSave={() => {}}
    />);

    expect(screen.getByText(/standard api pricing/i)).toBeInTheDocument();
    expect(screen.queryByText(/free/i)).not.toBeInTheDocument();
  });

  it('lets the user choose and save local-only mode', () => {
    const onSave = vi.fn();
    render(<AnalysisExecutionPolicyStatus
      mode="auto"
      effectiveRunner="codex-native"
      authentication="chatgpt"
      locality="remote"
      reason="codex-chatgpt-auth"
      pending={false}
      onSave={onSave}
    />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'local-only' } });
    fireEvent.click(screen.getByRole('button', { name: /save analysis mode/i }));
    expect(onSave).toHaveBeenCalledWith('local-only');
  });

  it('shows recent automatic status, downgrade reason, and an actionable next step', () => {
    render(<AnalysisExecutionPolicyStatus
      mode="auto"
      effectiveRunner="local-only"
      authentication="not-logged-in"
      locality="local"
      reason="codex-not-logged-in"
      recentAutomatic={{
        source_tool: 'codex-cli', session_id: 'session', status: 'awaiting-capability',
        runner_type: 'auto', latest_turn_id: 'turn', generation: 2, transcript_locator: null,
        source_basis: null, not_before: null, diagnostic: 'codex-not-logged-in',
        enqueued_at: '2026-07-22T00:00:00Z', started_at: null, completed_at: null,
        error_message: null, attempt_count: 0, max_attempts: 3,
      }}
      pending={false}
      onSave={() => {}}
    />);

    expect(screen.getByText(/recent automatic analysis: awaiting-capability/i)).toBeInTheDocument();
    expect(screen.getByText(/downgrade: codex-not-logged-in/i)).toBeInTheDocument();
    expect(screen.getByText(/codex login.*queue retry --all/i)).toBeInTheDocument();
  });
});
