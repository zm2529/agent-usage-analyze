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
});
