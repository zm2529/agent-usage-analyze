import { describe, expect, it } from 'vitest';
import { analysisQueueKey, queuedSessionKeys } from './useAnalysisQueue';
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
      items: [{
        source_tool: 'codex-cli',
        session_id: 'same',
        status: 'settling',
        runner_type: 'auto',
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
