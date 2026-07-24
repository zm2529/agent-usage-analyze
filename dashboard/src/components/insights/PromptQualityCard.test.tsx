import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PromptQualityCard } from './PromptQualityCard';
import type { Insight } from '@/lib/types';

function insight(metadata: Record<string, unknown>): Insight {
  return {
    id: 'insight', session_id: 'session', project_id: 'project', project_name: 'project',
    type: 'prompt_quality', title: 'Prompt quality', content: 'Evidence-based assessment',
    summary: '', bullets: '[]', confidence: 0.9, source: 'llm', metadata: JSON.stringify(metadata),
    timestamp: '2026-07-22T00:00:00.000Z', created_at: '2026-07-22T00:00:00.000Z',
    scope: 'session', analysis_version: '3.1.0', linked_insight_ids: null,
  };
}

describe('PromptQualityCard evidence gates', () => {
  it('does not turn a missing score into zero', () => {
    render(<PromptQualityCard insight={insight({ analysis_state: 'unavailable' })} />);
    expect(screen.getByText('No reliable score')).toBeInTheDocument();
    expect(screen.queryByText('/100')).not.toBeInTheDocument();
  });

  it('shows correction quality as not applicable instead of a default score', () => {
    render(<PromptQualityCard insight={insight({
      efficiency_score: 82, message_overhead: 0, findings: [], takeaways: [],
      dimension_scores: {
        context_provision: 80, request_specificity: 85, scope_management: 90,
        information_timing: 75, correction_quality: null,
      },
    })} />);
    const correctionRow = screen.getByText('Correction Quality').parentElement;
    expect(correctionRow).not.toBeNull();
    expect(within(correctionRow!).getByText('N/A')).toBeInTheDocument();
  });
});
