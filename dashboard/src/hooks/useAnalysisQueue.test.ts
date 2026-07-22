import { describe, expect, it } from 'vitest';
import { analysisQueueKey, analysisQueueRefetchInterval, queuedSessionKeys } from './useAnalysisQueue';
import type { AnalysisQueueStatus } from '@/lib/api';

describe('queuedSessionKeys', () => {
  it('keeps identical session ids isolated by source tool', () => {
    const data = {
      settling: 1,
      awaitingCapability: 0,
      pending: 0,
      processing: 0,
      completed: 0,
      failed: 0,
      latestAutomatic: null,
      items: [{
        source_tool: 'codex-cli',
        session_id: 'same',
        status: 'settling',
        runner_type: 'auto',
        latest_turn_id: 'turn',
        generation: 1,
        transcript_locator: null,
        source_basis: null,
        not_before: null,
        diagnostic: null,
        enqueued_at: '2026-07-22T00:00:00Z',
        started_at: null,
        completed_at: null,
        error_message: null,
        attempt_count: 0,
        max_attempts: 3,
      }],
    } satisfies AnalysisQueueStatus;

    const keys = queuedSessionKeys(data);
    expect(keys.has(analysisQueueKey('codex-cli', 'same'))).toBe(true);
    expect(keys.has(analysisQueueKey('claude-code', 'same'))).toBe(false);
  });
});

describe('analysisQueueRefetchInterval', () => {
  it('does not poll an awaiting-capability terminal state', () => {
    expect(analysisQueueRefetchInterval({
      settling: 0, awaitingCapability: 1, pending: 0, processing: 0, completed: 0, failed: 0,
      items: [], latestAutomatic: null,
    })).toBe(false);
  });

  it('continues polling while settling, pending, or processing work exists', () => {
    expect(analysisQueueRefetchInterval({
      settling: 1, awaitingCapability: 0, pending: 0, processing: 0, completed: 0, failed: 0,
      items: [], latestAutomatic: null,
    })).toBe(5000);
  });
});
