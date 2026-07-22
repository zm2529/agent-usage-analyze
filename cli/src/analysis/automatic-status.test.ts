import { describe, expect, it } from 'vitest';
import type { QueueStatus } from '../db/queue.js';
import { buildAutomaticAnalysisStatus } from './automatic-status.js';

function queueStatus(overrides: Partial<QueueStatus> = {}): QueueStatus {
  return {
    settling: 0, awaitingCapability: 0, pending: 0, processing: 0, completed: 0, failed: 0,
    items: [], latestAutomatic: null, ...overrides,
  };
}

describe('automatic analysis status', () => {
  it('turns a capability downgrade into an actionable recovery instruction', () => {
    const status = buildAutomaticAnalysisStatus(queueStatus({
      awaitingCapability: 1,
      latestAutomatic: {
        source_tool: 'codex-cli', session_id: 'session', status: 'awaiting-capability',
        runner_type: 'auto', latest_turn_id: 'turn', generation: 2, transcript_locator: null,
        source_basis: null, not_before: null, diagnostic: 'codex-not-logged-in',
        enqueued_at: '2026-07-22T00:00:00Z', started_at: null, completed_at: null,
        error_message: null, attempt_count: 0, max_attempts: 3,
      },
    }), {
      mode: 'auto', effectiveRunner: 'local-only', authentication: 'not-logged-in',
      locality: 'local', reason: 'codex-not-logged-in',
    });

    expect(status).toMatchObject({
      recentStatus: 'awaiting-capability', effectiveRunner: 'local-only',
      authentication: 'not-logged-in', downgradeReason: 'codex-not-logged-in',
    });
    expect(status.nextAction).toMatch(/codex login/i);
    expect(status.nextAction).toMatch(/queue retry --all/i);
  });

  it('reports a completed provider run without inventing a downgrade', () => {
    const status = buildAutomaticAnalysisStatus(queueStatus(), {
      mode: 'auto', effectiveRunner: 'provider', authentication: 'provider',
      locality: 'remote', reason: 'configured-provider',
    });
    expect(status.downgradeReason).toBeNull();
    expect(status.nextAction).toBe('No action required.');
  });

  it.each([
    ['settled-analysis-failed', /settled-analysis\.log.*queue retry --all/i],
    ['settled-import-failed', /import-codex.*queue retry --all/i],
    ['future-failure-code', /queue retry --all/i],
  ])('never reports no action for a failed automatic job: %s', (diagnostic, action) => {
    const latestAutomatic = {
      source_tool: 'codex-cli', session_id: 'session', status: 'failed' as const,
      runner_type: 'auto', latest_turn_id: 'turn', generation: 2, transcript_locator: null,
      source_basis: null, not_before: null, diagnostic,
      enqueued_at: '2026-07-22T00:00:00Z', started_at: null, completed_at: null,
      error_message: diagnostic, attempt_count: 3, max_attempts: 3,
    };
    const status = buildAutomaticAnalysisStatus(queueStatus({ failed: 1, latestAutomatic }), {
      mode: 'auto', effectiveRunner: 'codex-native', authentication: 'chatgpt',
      locality: 'remote', reason: 'codex-chatgpt-auth',
    });
    expect(status.nextAction).toMatch(action);
    expect(status.nextAction).not.toBe('No action required.');
  });

  it('includes retry after resolving unknown Codex authentication', () => {
    const status = buildAutomaticAnalysisStatus(queueStatus(), {
      mode: 'auto', effectiveRunner: 'local-only', authentication: 'unknown',
      locality: 'local', reason: 'codex-auth-unknown',
    });
    expect(status.nextAction).toMatch(/codex login status.*queue retry --all/i);
  });
});
