import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

export interface CodexRateLimitWindow {
  usedPercent: number;
  windowDurationMins: number | null;
  resetsAt: number | null;
}

export interface CodexRateLimitBucket {
  limitId: string | null;
  limitName: string | null;
  planType: string | null;
  primary: CodexRateLimitWindow | null;
  secondary: CodexRateLimitWindow | null;
  credits: { hasCredits: boolean; unlimited: boolean; balance: string | null } | null;
  rateLimitReachedType: string | null;
}

export interface CodexAccountUsage {
  source: 'codex-app-server';
  observedAt: string;
  rateLimits: CodexRateLimitBucket[];
  resetCreditsAvailable: number | null;
  resetCredits: Array<{ grantedAt: number | null; expiresAt: number | null }>;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function nullableString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function window(value: unknown): CodexRateLimitWindow | null {
  const item = record(value);
  if (!item || !Number.isSafeInteger(item.usedPercent)) return null;
  return {
    usedPercent: Math.min(100, Math.max(0, Number(item.usedPercent))),
    windowDurationMins: Number.isSafeInteger(item.windowDurationMins)
      ? Number(item.windowDurationMins) : null,
    resetsAt: Number.isSafeInteger(item.resetsAt) ? Number(item.resetsAt) : null,
  };
}

function bucket(value: unknown): CodexRateLimitBucket | null {
  const item = record(value);
  if (!item) return null;
  const creditsValue = record(item.credits);
  const credits = creditsValue
    && typeof creditsValue.hasCredits === 'boolean'
    && typeof creditsValue.unlimited === 'boolean'
    ? {
      hasCredits: creditsValue.hasCredits,
      unlimited: creditsValue.unlimited,
      balance: nullableString(creditsValue.balance),
    }
    : null;
  return {
    limitId: nullableString(item.limitId),
    limitName: nullableString(item.limitName),
    planType: nullableString(item.planType),
    primary: window(item.primary),
    secondary: window(item.secondary),
    credits,
    rateLimitReachedType: nullableString(item.rateLimitReachedType),
  };
}

/** Validate and minimize the official app-server response before exposing it to the WebUI. */
export function parseCodexAccountUsageResult(value: unknown, now = new Date()): CodexAccountUsage {
  const result = record(value);
  if (!result) throw new Error('codex-rate-limits-invalid-response');
  const byId = record(result.rateLimitsByLimitId);
  const values = byId ? Object.values(byId) : [result.rateLimits];
  const rateLimits = values.map(bucket).filter((item): item is CodexRateLimitBucket => item !== null);
  if (rateLimits.length === 0) throw new Error('codex-rate-limits-invalid-response');
  const resetCredits = record(result.rateLimitResetCredits);
  const creditRows = Array.isArray(resetCredits?.credits)
    ? resetCredits.credits.map(record).filter((item): item is Record<string, unknown> => item !== null)
    : [];
  return {
    source: 'codex-app-server',
    observedAt: now.toISOString(),
    rateLimits,
    resetCreditsAvailable: resetCredits && Number.isSafeInteger(resetCredits.availableCount)
      ? Number(resetCredits.availableCount) : null,
    resetCredits: creditRows
      .filter((item) => item.status === 'available')
      .map((item) => ({
        grantedAt: Number.isSafeInteger(item.grantedAt) ? Number(item.grantedAt) : null,
        expiresAt: Number.isSafeInteger(item.expiresAt) ? Number(item.expiresAt) : null,
      })),
  };
}

/**
 * Read Codex subscription windows through the documented local app-server RPC.
 * The child reuses the user's existing Codex login; this code never reads auth files or tokens.
 */
export function readCodexAccountUsage(timeoutMs = 8_000): Promise<CodexAccountUsage> {
  return new Promise((resolve, reject) => {
    const child = spawn('codex', ['app-server', '--stdio'], {
      stdio: ['pipe', 'pipe', 'ignore'],
      shell: false,
    });
    const lines = createInterface({ input: child.stdout });
    let settled = false;

    const cleanup = () => {
      clearTimeout(timer);
      lines.close();
      child.stdin.end();
      if (!child.killed) child.kill('SIGTERM');
    };
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const succeed = (usage: CodexAccountUsage) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(usage);
    };
    const timer = setTimeout(() => fail(new Error('codex-rate-limits-timeout')), timeoutMs);

    child.once('error', (error: NodeJS.ErrnoException) => {
      fail(new Error(error.code === 'ENOENT' ? 'codex-cli-missing' : 'codex-app-server-unavailable'));
    });
    child.once('close', (code) => {
      if (!settled) fail(new Error(code === 0
        ? 'codex-rate-limits-no-response'
        : 'codex-app-server-unavailable'));
    });
    lines.on('line', (line) => {
      if (line.length > 2 * 1024 * 1024) {
        fail(new Error('codex-rate-limits-response-too-large'));
        return;
      }
      let message: Record<string, unknown> | null = null;
      try { message = record(JSON.parse(line)); } catch { return; }
      if (!message || message.id !== 1) return;
      if (message.error) {
        fail(new Error('codex-rate-limits-request-failed'));
        return;
      }
      try {
        succeed(parseCodexAccountUsageResult(message.result));
      } catch (error) {
        fail(error instanceof Error ? error : new Error('codex-rate-limits-invalid-response'));
      }
    });

    const send = (message: unknown) => child.stdin.write(`${JSON.stringify(message)}\n`);
    send({
      method: 'initialize', id: 0,
      params: { clientInfo: { name: 'agent-usage-analyze', title: 'Agent Usage Analyzer', version: '0.1.0' } },
    });
    send({ method: 'initialized', params: {} });
    send({ method: 'account/rateLimits/read', id: 1, params: null });
  });
}
