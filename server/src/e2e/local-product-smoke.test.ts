import { execFileSync } from 'node:child_process';
import dns from 'node:dns';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { runMigrations } from '@agent-analytics/cli/db/schema';
import {
  ingestSourceAdapter,
  type CanonicalBatch,
  type CanonicalEvent,
  type SourceAdapter,
  type SourceArtifact,
} from '@agent-analytics/cli/canonical/ingestion';
import { comparePatternWindows } from '@agent-analytics/cli/canonical/patterns';
import { discoverCanonicalTestRunDeliveries } from '@agent-analytics/cli/canonical/deliveries';
import {
  createScorecardVersion,
  evaluateScorecard,
  transitionScorecardVersion,
} from '@agent-analytics/cli/canonical/scorecards';

let db: Database.Database;
vi.mock('@agent-analytics/cli/db/client', () => ({ getDb: () => db, closeDb: () => {} }));
vi.mock('@agent-analytics/cli/utils/telemetry', () => ({
  trackEvent: vi.fn(), captureError: vi.fn(), shutdownTelemetry: vi.fn(),
}));

const { createApp, startServer, LOOPBACK_HOST } = await import('../index.js');

const dirs: string[] = [];
let configDir: string;
let historyPath: string;
let repoPath: string;
let repoHead: string;
let fetchGuard: ReturnType<typeof vi.spyOn>;
let socketGuard: ReturnType<typeof vi.spyOn>;
let dnsGuard: ReturnType<typeof vi.spyOn>;
const nativeFetch = globalThis.fetch.bind(globalThis);
const nativeSocketConnect = Socket.prototype.connect;
const nativeDnsLookup = dns.lookup;
const networkViolations: string[] = [];

function isLoopbackHost(host: string): boolean {
  return host === LOOPBACK_HOST || host === 'localhost' || host === '::1';
}

function event(
  id: string,
  taskId: string,
  occurredAt: string,
  kind: CanonicalEvent['kind'],
  payload: Record<string, unknown>,
  sequence: number,
  options: { parentEventId?: string; repository?: { root: string; branch: string } } = {},
): CanonicalEvent {
  return {
    id, nativeEventId: id, sequence, occurredAt, kind,
    actor: kind === 'user-message' ? 'user' : kind.startsWith('tool-') ? 'tool' : 'system',
    sensitivity: 'structural', payload, taskId, threadId: `thread:${taskId}`,
    ...(options.parentEventId ? { parentEventId: options.parentEventId } : {}),
    ...(options.repository ? { repository: options.repository } : {}),
  } as CanonicalEvent;
}

function fixtureBatch(artifact: SourceArtifact): CanonicalBatch {
  const events: CanonicalEvent[] = [];
  let sequence = 0;
  const addTask = (taskId: string, startedAt: string, mode: 'plain' | 'unvalidated-change' | 'validated') => {
    const repository = { root: repoPath, branch: 'main' };
    events.push(event(`${taskId}:meta`, taskId, startedAt, 'session-meta', { taskRole: 'root' }, sequence++, { repository }));
    if (mode === 'unvalidated-change') {
      events.push(event(`${taskId}:change`, taskId, startedAt.replace('00.000Z', '10.000Z'),
        'file-change', { changeType: 'modified', pathHash: 'sha256:path' }, sequence++));
    }
    if (mode === 'validated') {
      const callId = `${taskId}:call`;
      events.push(event(callId, taskId, startedAt.replace('00.000Z', '10.000Z'),
        'tool-call', { toolName: 'vitest', callId, validationKind: 'test' }, sequence++));
      events.push(event(`${taskId}:result`, taskId, startedAt.replace('00.000Z', '20.000Z'),
        'tool-result', { callId, status: 'completed' }, sequence++, { parentEventId: callId }));
    }
    events.push(event(`${taskId}:done`, taskId, startedAt.replace('00.000Z', '30.000Z'),
      'task-completed', { status: 'completed', reason: 'normal' }, sequence++));
  };
  addTask('task:previous-one', '2026-07-08T00:00:00.000Z', 'plain');
  addTask('task:previous-two', '2026-07-09T00:00:00.000Z', 'plain');
  addTask('task:current-one', '2026-07-15T00:00:00.000Z', 'unvalidated-change');
  addTask('task:current-two', '2026-07-16T00:00:00.000Z', 'validated');
  return {
    artifact,
    era: {
      id: 'era:isolated-smoke', name: 'Isolated smoke', mode: 'historical-backfill',
      parserVersion: 'isolated-smoke-v1', capabilities: ['canonical-event', 'task-tree'],
      startsAt: '2026-07-01T00:00:00.000Z', endsAt: '2026-07-21T00:00:00.000Z',
    },
    events, identityEdges: [], diagnostics: [{ severity: 'info', code: 'fixture', count: 1 }],
    coverage: { discovered: events.length, parsed: events.length, skipped: 0, failed: 0, unknown: 0 },
    previousCursor: null, nextCursor: { token: `line:${events.length}`, position: events.length },
  };
}

beforeAll(async () => {
  fetchGuard = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input);
    if (!isLoopbackHost(url.hostname)) {
      networkViolations.push(`fetch:${url.hostname}`);
      throw new Error(`Non-loopback fetch is forbidden in the isolated product smoke: ${url.hostname}`);
    }
    return nativeFetch(input, init);
  });
  socketGuard = vi.spyOn(Socket.prototype, 'connect').mockImplementation(function guardedSocket(
    this: Socket,
    ...args: Parameters<Socket['connect']>
  ) {
    const first = args[0];
    const target = Array.isArray(first) ? first[0] : first;
    const host = typeof target === 'object' && target !== null
      ? String(('hostname' in target ? target.hostname : undefined) ?? ('host' in target ? target.host : undefined) ?? '')
      : typeof args[1] === 'string' ? args[1] : '';
    if (!isLoopbackHost(host)) {
      const shape = typeof target === 'object' && target !== null ? Object.keys(target).sort().join(',') : typeof target;
      networkViolations.push(`socket:${host || '<unspecified>'}:${shape}`);
      throw new Error(`Non-loopback socket is forbidden in the isolated product smoke: ${host || '<unspecified>'}:${shape}`);
    }
    return nativeSocketConnect.apply(this, args);
  });
  dnsGuard = vi.spyOn(dns, 'lookup').mockImplementation(((hostname: string, ...args: unknown[]) => {
    if (!isLoopbackHost(hostname)) {
      networkViolations.push(`dns:${hostname}`);
      throw new Error(`Non-loopback DNS is forbidden in the isolated product smoke: ${hostname}`);
    }
    return (nativeDnsLookup as (...lookupArgs: unknown[]) => unknown)(hostname, ...args);
  }) as typeof dns.lookup);
  const root = mkdtempSync(join(tmpdir(), 'agent-analytics-product-smoke-'));
  dirs.push(root);
  configDir = join(root, 'config');
  const codexHome = join(root, 'codex-home');
  repoPath = join(root, 'repo');
  mkdirSync(configDir, { recursive: true });
  mkdirSync(codexHome, { recursive: true });
  mkdirSync(repoPath, { recursive: true });
  historyPath = join(codexHome, 'synthetic-rollout.jsonl');
  writeFileSync(historyPath, '{"type":"synthetic-smoke"}\n');
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: repoPath });
  writeFileSync(join(repoPath, 'result.txt'), 'isolated delivery\n');
  execFileSync('git', ['add', 'result.txt'], { cwd: repoPath });
  execFileSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid',
    'commit', '-qm', 'isolated fixture'], { cwd: repoPath });
  repoHead = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoPath, encoding: 'utf8' }).trim();
  process.env.AGENT_ANALYTICS_CONFIG_DIR = configDir;
  db = new Database(join(configDir, 'data.db'));
  runMigrations(db);

  const artifact: SourceArtifact = {
    id: 'source:isolated-smoke', sourceKind: 'synthetic-codex', parserVersion: 'isolated-smoke-v1',
    locatorHash: 'sha256:isolated-history', observedAt: '2026-07-21T00:00:00.000Z',
  };
  const adapter: SourceAdapter = {
    name: 'isolated-smoke',
    async discover() {
      if (!readFileSync(historyPath, 'utf8').includes('synthetic-smoke')) {
        throw new Error('Isolated history fixture is unavailable');
      }
      return [artifact];
    },
    async parse() { return fixtureBatch(artifact); },
  };
  await ingestSourceAdapter(adapter, db);
  comparePatternWindows(db, {
    currentStart: '2026-07-14T00:00:00.000Z', currentEnd: '2026-07-21T00:00:00.000Z',
  });
  discoverCanonicalTestRunDeliveries(db);

  const version = createScorecardVersion(db, {
    name: 'Personal delivery evidence', version: 'isolated-v1',
    features: [
      { key: 'deliveryEvidence', label: 'Delivery evidence', weight: 0.7, requiresQualityGate: false },
      { key: 'tokenEfficiencyAfterQuality', label: 'Token efficiency after quality', weight: 0.3, requiresQualityGate: true },
    ],
    qualityGates: ['delivery-observed', 'validation-observed'], safetyGates: ['no-unsafe-attribution'],
    missingRules: { deliveryEvidence: 'unavailable', tokenEfficiencyAfterQuality: 'unavailable' },
    thresholds: { minimumCoverage: 0.8 }, calibrationDataVersion: 'isolated-calibration-v1',
    scope: { kind: 'personal' }, evidenceRefs: ['event:scorecard-definition'],
  });
  evaluateScorecard(db, {
    taskId: 'task:current-two', scorecardVersionId: version.id,
    rawFeatures: { deliveryEvidence: 1, tokenEfficiencyAfterQuality: 0.5 },
    gateResults: { quality: true, safety: true, calibration: true }, coverage: 1, uncertainty: 0.1,
    evidenceRefs: ['task:current-two:result'],
  });
  transitionScorecardVersion(db, version.id, 'calibrating', ['event:calibration-start']);
  transitionScorecardVersion(db, version.id, 'active', ['event:calibration-pass']);
  evaluateScorecard(db, {
    taskId: 'task:current-two', scorecardVersionId: version.id,
    rawFeatures: { deliveryEvidence: 1, tokenEfficiencyAfterQuality: 0.5 },
    gateResults: { quality: true, safety: true, calibration: true }, coverage: 1, uncertainty: 0.1,
    evidenceRefs: ['task:current-two:result'],
  });
});

afterAll(() => {
  db.close();
  delete process.env.AGENT_ANALYTICS_CONFIG_DIR;
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  fetchGuard.mockRestore();
  socketGuard.mockRestore();
  dnsGuard.mockRestore();
});

describe('isolated local product smoke', () => {
  it('closes import, task, trend, delivery, evidence, advice, scorecard, and Web API without network', async () => {
    const app = createApp();
    const health = await (await app.request('/api/ingestion/health')).json() as { status: string };
    const task = await (await app.request('/api/tasks/task%3Acurrent-one')).json() as {
      task: { events: Array<{ id: string }> };
    };
    const trends = await (await app.request(
      '/api/patterns/trends?currentStart=2026-07-14T00%3A00%3A00.000Z&currentEnd=2026-07-21T00%3A00%3A00.000Z',
    )).json() as { comparison: { trends: Array<{ pattern: string; state: string }> } };
    const deliveries = await (await app.request('/api/deliveries')).json() as {
      deliveries: Array<{ id: string }>;
    };
    const delivery = await (await app.request(
      `/api/deliveries/${encodeURIComponent(deliveries.deliveries[0]!.id)}`,
    )).json() as { delivery: { candidates: Array<{
      taskId: string; status: string; coverage: number;
      evidence: Array<{ evidenceType: string; facts: Array<{ taskId: string; factRef?: string }> }>;
    }> } };
    const deliveryFact = delivery.delivery.candidates[0]!.evidence[0]!.facts[0]!;
    const deliveryTask = await (await app.request(
      `/api/tasks/${encodeURIComponent(deliveryFact.taskId)}`,
    )).json() as { task: { events: Array<{ id: string }> } };
    const advice = await (await app.request('/api/advice?taskId=task%3Acurrent-one')).json() as {
      active: Array<{ issueKey: string; evidenceRefs: string[] }>;
    };
    const scorecards = await (await app.request('/api/scorecards?taskId=task%3Acurrent-two')).json() as {
      results: Array<{ indexValue: number | null; unavailableReason: string | null }>;
    };
    const runtime = await app.request('/api/config/runtime');
    const sanitized = await app.request('/api/export/sanitized');
    let notifyListening!: (info: { address: string; port: number }) => void;
    const listening = new Promise<{ address: string; port: number }>((resolve) => {
      notifyListening = resolve;
    });
    const server = await startServer({
      port: 0, staticDir: join(configDir, 'missing-dashboard'), openBrowser: false,
    }, { onListen: notifyListening });
    const listenInfo = await listening;
    const networkHealth = await (await fetch(`http://${LOOPBACK_HOST}:${listenInfo.port}/api/health`)).json() as {
      ok: boolean;
    };
    const boundAddress = server.address();
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });

    expect(health.status).toBe('completed');
    expect(task.task.events.map((item) => item.id)).toContain('task:current-one:done');
    expect(trends.comparison.trends).toContainEqual(expect.objectContaining({ pattern: 'validation-missing', state: 'new' }));
    expect(deliveries.deliveries).toHaveLength(1);
    expect(delivery.delivery.candidates).toContainEqual(expect.objectContaining({
      taskId: 'task:current-two', status: 'candidate', coverage: 1,
      evidence: expect.arrayContaining([expect.objectContaining({
        evidenceType: 'canonical-validation-result',
        facts: [{ deliveryId: deliveries.deliveries[0]!.id, taskId: 'task:current-two',
          factRef: 'task:current-two:result' }],
      })]),
    }));
    expect(deliveryTask.task.events.map((item) => item.id)).toContain('task:current-two:result');
    expect(advice.active).toContainEqual(expect.objectContaining({
      issueKey: 'pattern:validation-missing',
      evidenceRefs: expect.arrayContaining(['task:current-one:done']),
    }));
    expect(scorecards.results).toEqual(expect.arrayContaining([
      expect.objectContaining({ indexValue: null, unavailableReason: 'scorecard-not-active' }),
      expect.objectContaining({ indexValue: 85, unavailableReason: null }),
    ]));
    expect(runtime.status).toBe(200);
    expect(sanitized.status).toBe(200);
    expect(networkHealth.ok).toBe(true);
    expect(listenInfo.address).toBe(LOOPBACK_HOST);
    expect(boundAddress).toEqual(expect.objectContaining({ address: LOOPBACK_HOST }));
    expect(fetchGuard).toHaveBeenCalledTimes(1);
    expect(socketGuard).toHaveBeenCalled();
    expect(dnsGuard).toHaveBeenCalled();
    expect(networkViolations).toEqual([]);
    expect(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoPath, encoding: 'utf8' }).trim()).toBe(repoHead);
    expect(execFileSync('git', ['status', '--porcelain'], { cwd: repoPath, encoding: 'utf8' })).toBe('');
  });
});
