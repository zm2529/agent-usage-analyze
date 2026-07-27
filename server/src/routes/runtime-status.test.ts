import { describe, expect, it } from 'vitest';
import { hookEventLabel, semanticQueuePresentation } from './runtime-status.js';

describe('hookEventLabel', () => {
  it('explains a transient database lock without presenting it as a permanent failure', () => {
    expect(hookEventLabel({
      status: 'failed',
      reason: 'database-busy',
      observedAt: '2026-07-27T12:02:35.041Z',
    })).toEqual({
      label: '写入繁忙，等待重试',
      detail: '本地数据正在写入；下个事件会自动重试',
    });
  });

  it('shows a recent recovery after the next Hook event succeeds', () => {
    expect(hookEventLabel({
      status: 'recorded',
      reason: 'frontier-recorded',
      observedAt: '2026-07-27T12:04:21.625Z',
      recoveredFailureAt: '2026-07-27T12:02:35.041Z',
      recoveredFailureReason: 'database-busy',
    }, Date.parse('2026-07-27T12:05:00.000Z'))).toEqual({
      label: '已自动恢复',
      detail: '短暂写入繁忙，后续事件已成功记录',
    });
  });

  it('returns to the ordinary healthy label after the recovery window', () => {
    expect(hookEventLabel({
      status: 'recorded',
      reason: 'frontier-recorded',
      observedAt: '2026-07-27T12:20:00.000Z',
      recoveredFailureAt: '2026-07-27T12:02:35.041Z',
      recoveredFailureReason: 'database-busy',
    }, Date.parse('2026-07-27T12:20:00.000Z'))).toEqual({
      label: '最近事件已收到',
      detail: 'Hook 已安装并记录真实事件',
    });
  });
});

describe('semanticQueuePresentation', () => {
  it('does not call a settling session active analysis', () => {
    expect(semanticQueuePresentation({
      settling: 2,
      pending: 0,
      processing: 0,
      awaitingCapability: 0,
      awaitingSource: 0,
      failed: 0,
      hasPreviousSuccess: true,
    })).toEqual({
      state: 'waiting',
      label: '等待会话稳定',
      detail: '2 个最近会话将在停止变化后自动分析',
    });
  });

  it('uses the processing label only while a worker is actually analyzing', () => {
    expect(semanticQueuePresentation({
      settling: 1,
      pending: 0,
      processing: 1,
      awaitingCapability: 0,
      awaitingSource: 0,
      failed: 0,
      hasPreviousSuccess: true,
    })).toEqual({
      state: 'running',
      label: '任务分析处理中',
      detail: '等待稳定 1 · 排队 0 · 分析中 1',
    });
  });

  it('describes a missing transcript as waiting for its local record', () => {
    expect(semanticQueuePresentation({
      settling: 2,
      pending: 0,
      processing: 0,
      awaitingCapability: 0,
      awaitingSource: 2,
      failed: 0,
      hasPreviousSuccess: true,
    })).toEqual({
      state: 'waiting',
      label: '等待会话记录',
      detail: '2 个会话记录尚未可读；记录出现后自动继续',
    });
  });
});
