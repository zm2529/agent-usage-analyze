import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SemanticAnalysisSettingsStatus } from './SemanticAnalysisSettingsCard';

describe('SemanticAnalysisSettingsStatus', () => {
  it('makes remote semantic analysis an explicit, reversible opt-in', () => {
    const onToggle = vi.fn();
    render(<SemanticAnalysisSettingsStatus
      configured
      enabled={false}
      provider="anthropic"
      model="claude-sonnet-4-6"
      pending={false}
      onToggle={onToggle}
    />);

    expect(screen.getByText('Disabled by default')).toBeInTheDocument();
    expect(screen.getByText(/anthropic · claude-sonnet-4-6 · remote/i)).toBeInTheDocument();
    expect(screen.getByText(/redacted, turn-safe evidence packet/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Enable semantic analysis' }));
    expect(onToggle).toHaveBeenCalledWith(true);
  });

  it('shows and blocks a custom remote endpoint that uses a local-style provider', () => {
    const onToggle = vi.fn();
    render(<SemanticAnalysisSettingsStatus
      configured
      enabled={false}
      provider="ollama"
      model="qwen3:14b"
      locality="remote"
      pending={false}
      onToggle={onToggle}
    />);

    expect(screen.getByText(/ollama · qwen3:14b · remote/i)).toBeInTheDocument();
    expect(screen.getByText(/cannot be enabled for semantic analysis/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Enable semantic analysis' })).toBeDisabled();
  });
});
