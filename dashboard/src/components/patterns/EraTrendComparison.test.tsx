import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { formatDateTimeLocal, parseDateTimeLocal, TrendComparisonCard } from './EraTrendComparison';
import { MemoryRouter } from 'react-router';
import { eventAnchorId } from '@/lib/event-links';

describe('TrendComparisonCard', () => {
  it('round-trips UTC through an Asia/Shanghai datetime-local value and ignores empty input', () => {
    expect(formatDateTimeLocal('2026-07-21T00:00:00.000Z', -480)).toBe('2026-07-21T08:00');
    expect(parseDateTimeLocal('2026-07-21T08:00', -480)).toBe('2026-07-21T00:00:00.000Z');
    expect(parseDateTimeLocal('', -480)).toBeNull();
  });
  it('shows state, magnitude, unknown reason, coverage, and evidence drill-down', () => {
    render(<MemoryRouter><TrendComparisonCard comparison={{
      previousWindow: { start: '2026-07-07', end: '2026-07-14', taskCount: 2, coverage: 1, eras: [] },
      currentWindow: { start: '2026-07-14', end: '2026-07-21', taskCount: 2, coverage: 0.5, eras: [] },
      eraCompatibility: 'compatible',
      trends: [{
        pattern: 'rework', label: 'Rework', observableFact: 'The same redacted file identity changed more than once in a task.',
        state: 'incomparable', change: null, unknownReason: 'insufficient-coverage', previous: null,
        conflictingEvidence: [], current: {
          id: 'claim', pattern: 'rework', sourceCategory: 'deterministic', algorithmVersion: 'v1',
          window: { start: '2026-07-14', end: '2026-07-21' }, sampleCount: 1, totalTaskCount: 2,
          coverage: 0.5, confidence: 0.2, eraCompatibility: 'compatible', evidenceRefs: ['evidence:1'],
          sampleTaskRefs: ['task-1'],
          evidence: [{
            id: 'evidence:1', evidenceType: 'canonical-event-observation', subjectRef: 'rework',
            position: 'supports', sourceCategory: 'deterministic', algorithmVersion: 'v1',
            coverage: 0.5, confidence: 0.2, eraCompatibility: 'compatible', eraIds: ['era'],
            humanStatus: 'unreviewed', factRefs: ['event:1'], facts: [{ eventId: 'event:1', taskId: 'task-1' }],
          }],
        },
      }],
    }} /></MemoryRouter>);
    expect(screen.getByText('incomparable')).toBeInTheDocument();
    expect(screen.getByText(/change unknown/)).toBeInTheDocument();
    expect(screen.getByText(/Unknown direction: insufficient-coverage/)).toBeInTheDocument();
    expect(screen.getByText('Evidence (1)')).toBeInTheDocument();
    expect(screen.getByText('event:1')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'task-1' })).toHaveAttribute('href', '/tasks/task-1');
    const eventLink = screen.getByRole('link', { name: 'event:1' });
    expect(eventLink).toHaveAttribute('href', '/tasks/task-1#event-event%3A1');
    const target = document.createElement('div');
    target.id = eventAnchorId('event:1');
    document.body.append(target);
    const fragment = new URL(eventLink.getAttribute('href')!, 'https://local.invalid').hash.slice(1);
    expect(document.getElementById(decodeURIComponent(fragment))).toBe(target);
  });
});
