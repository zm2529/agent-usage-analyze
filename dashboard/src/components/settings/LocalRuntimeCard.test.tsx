import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { LocalRuntimeCard } from './LocalRuntimeCard';

vi.mock('@/lib/api', () => ({ fetchRuntimeConfig: vi.fn().mockResolvedValue({
  dataDirectory: '/tmp/private-data', listenAddress: '127.0.0.1:7890',
  sources: [{ kind: 'synthetic-codex', count: 2 }],
  eras: [{ mode: 'continuous-observation', parserVersion: 'fixture-v1', count: 1 }],
  llm: { configured: true, provider: 'ollama', model: 'qwen', locality: 'local', enabled: true },
  analysis: { mode: 'auto', effectiveRunner: 'codex-native', authentication: 'chatgpt', locality: 'remote', reason: 'codex-chatgpt-auth' },
  migration: { databaseSchema: 22, status: 'migrated', completedAt: '2026-07-21T00:00:00.000Z' },
  dataActions: {
    exportPath: '/api/export/sanitized', archiveCommand: 'agent-usage-analyze reset',
    rebuildCommand: 'agent-usage-analyze import-codex', scope: 'Local analysis only.',
    recovery: 'Timestamped backups.',
  },
}) }));

describe('LocalRuntimeCard', () => {
  it('keeps the simplified read-only runtime status and sanitized export visible', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><LocalRuntimeCard /></QueryClientProvider>);
    expect(await screen.findByText('/tmp/private-data')).toBeInTheDocument();
    expect(screen.getByText(/127\.0\.0\.1:7890/)).toBeInTheDocument();
    expect(screen.getByText(/codex-native.*chatgpt.*enabled/i)).toBeInTheDocument();
    expect(screen.queryByText(/schema v22.*migrated/i)).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /download sanitized export/i }))
      .toHaveAttribute('href', '/api/export/sanitized');
    expect(screen.getByText(/Local analysis only/)).toBeInTheDocument();
  });
});
