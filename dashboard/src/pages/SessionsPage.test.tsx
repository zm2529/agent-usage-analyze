import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import SessionsPage from './SessionsPage';

vi.mock('@/hooks/useSessions', () => ({ useSessions: () => ({ data: [{
  id: 'codex:session-1', project_id: 'project-1', project_name: 'Example', project_path: '/repo',
  git_remote_url: null, summary: '修复导出记录', custom_title: null, generated_title: null,
  title_source: 'user_message', session_character: null, started_at: '2026-07-23T10:00:00Z',
  ended_at: '2026-07-23T10:20:00Z', message_count: 8, user_message_count: 4,
  assistant_message_count: 4, tool_call_count: 12, git_branch: 'main', claude_version: null,
  source_tool: 'codex-cli', device_id: null, device_hostname: null, device_platform: null,
  synced_at: '2026-07-23T10:21:00Z', total_input_tokens: null, total_output_tokens: null,
  cache_creation_tokens: null, cache_read_tokens: null, estimated_cost_usd: null, models_used: null,
  primary_model: null, usage_source: null, compact_count: 0, auto_compact_count: 0, slash_commands: null,
}] }) }));
vi.mock('@/hooks/useProjects', () => ({ useProjects: () => ({ data: [{ id: 'project-1', name: 'Example' }] }) }));
vi.mock('@/hooks/useInsights', () => ({ useInsights: () => ({ data: [{ session_id: 'codex:session-1' }] }) }));
vi.mock('@/hooks/useFilterParams', () => ({ useFilterParams: () => [{
  q: '', project: 'all', source: 'all', character: 'all', status: 'all', dateRange: 'all',
  dateFrom: '', dateTo: '', outcome: 'all', session: '',
}, vi.fn()] }));
vi.mock('@/components/sessions/SessionDetailPanel', () => ({ SessionDetailPanel: () => <div>detail</div> }));
vi.mock('@/i18n/LanguageProvider', () => ({ useLanguage: () => ({ language: 'zh-CN' }) }));

describe('SessionsPage activity ledger', () => {
  it('uses a full-width chronological ledger instead of a permanent three-panel browser', () => {
    render(<SessionsPage />);
    expect(screen.getByRole('heading', { name: '工程活动账本' })).toBeInTheDocument();
    expect(screen.getByText('修复导出记录')).toBeInTheDocument();
    expect(screen.getByText('4 USER · 4 ASST')).toBeInTheDocument();
    expect(screen.queryByText('Select a session to view details')).not.toBeInTheDocument();
  });
});
