import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { LocalRuntimeCard } from './LocalRuntimeCard';

vi.mock('@/lib/api', () => ({ fetchRuntimeConfig: vi.fn().mockResolvedValue({
  dataDirectory: '/tmp/private-data', listenAddress: '127.0.0.1:7890',
  sources: [{ kind: 'synthetic-codex', count: 2 }],
  eras: [{ mode: 'continuous-observation', parserVersion: 'fixture-v1', count: 1 }],
  llm: { configured: true, provider: 'ollama', model: 'qwen', locality: 'local', enabled: true },
  migration: { databaseSchema: 22, status: 'migrated', completedAt: '2026-07-21T00:00:00.000Z' },
  dataActions: {
    exportPath: '/api/export/sanitized', archiveCommand: 'agent-analytics reset',
    rebuildCommand: 'agent-analytics import-codex', scope: 'Local analysis only.',
    recovery: 'Timestamped backups.',
  },
}) }));

describe('LocalRuntimeCard', () => {
  it('makes locality, migration, sanitized export, archive scope, recovery, and rebuild visible', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><LocalRuntimeCard /></QueryClientProvider>);
    expect(await screen.findByText('/tmp/private-data')).toBeInTheDocument();
    expect(screen.getByText(/127\.0\.0\.1:7890/)).toBeInTheDocument();
    expect(screen.getByText(/ollama.*local.*enabled/i)).toBeInTheDocument();
    expect(screen.getByText(/schema v22.*migrated/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /download sanitized export/i }))
      .toHaveAttribute('href', '/api/export/sanitized');
    expect(screen.getByText('agent-analytics reset')).toBeInTheDocument();
    expect(screen.getByText('agent-analytics import-codex')).toBeInTheDocument();
    expect(screen.getByText(/Local analysis only/)).toBeInTheDocument();
    expect(screen.getByText(/Timestamped backups/)).toBeInTheDocument();
  });
});
