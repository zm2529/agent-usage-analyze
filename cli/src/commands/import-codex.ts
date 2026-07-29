import { spawn } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync } from 'node:fs';
import { join } from 'node:path';
import { CodexRolloutAdapter } from '../canonical/codex-rollout.js';
import { ingestSourceAdapter, type IngestionOptions } from '../canonical/ingestion.js';
import { getDb } from '../db/client.js';
import { getConfigDir } from '../utils/config.js';
import { CLI_ENTRY } from '../utils/hooks-utils.js';
import {
  startAutomaticHistoryAnalysis,
  type HistoryBackfillResult,
} from '../analysis/history-backfill.js';
import { spawnAutomaticBehaviorReport } from '../analysis/behavior-report-scheduler.js';

export interface ImportCodexOptions extends IngestionOptions {
  home?: string;
}

export interface BackgroundImport {
  pid: number | undefined;
  logPath: string;
}

export interface BackgroundImportOptions {
  analyzeAfterImport?: boolean;
}

interface DatabaseBusyRetryOptions {
  attempts?: number;
  wait?: (milliseconds: number) => Promise<void>;
  onRetry?: (attempt: number, attempts: number) => void;
}

function isDatabaseBusy(error: unknown): boolean {
  const code = error && typeof error === 'object' && 'code' in error
    ? String((error as { code?: unknown }).code)
    : '';
  const message = error instanceof Error ? error.message : String(error);
  return code === 'SQLITE_BUSY' || code === 'SQLITE_LOCKED'
    || /database is locked|SQLITE_BUSY|SQLITE_LOCKED/i.test(message);
}

export async function retryDatabaseBusy<T>(
  operation: () => Promise<T>,
  options: DatabaseBusyRetryOptions = {},
): Promise<T> {
  const attempts = Math.max(1, options.attempts ?? 3);
  const wait = options.wait ?? ((milliseconds) =>
    new Promise<void>((resolvePromise) => setTimeout(resolvePromise, milliseconds)));
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (!isDatabaseBusy(error) || attempt === attempts) throw error;
      options.onRetry?.(attempt + 1, attempts);
      await wait(attempt * 1_000);
    }
  }
  throw new Error('unreachable database retry state');
}

interface ImportCodexCommandDependencies {
  importHistory: typeof importCodexHistory;
  startHistoryAnalysis: () => HistoryBackfillResult;
  startBehaviorReport: () => void;
  writeSummary: (summary: unknown) => void;
  warn?: (message: string) => void;
}

const defaultCommandDependencies: ImportCodexCommandDependencies = {
  importHistory: importCodexHistory,
  startHistoryAnalysis: startAutomaticHistoryAnalysis,
  startBehaviorReport: spawnAutomaticBehaviorReport,
  writeSummary: (summary) => process.stdout.write(`${JSON.stringify(summary)}\n`),
  warn: (message) => process.stderr.write(`${message}\n`),
};

export async function importCodexHistory(options: ImportCodexOptions = {}) {
  return retryDatabaseBusy(
    () => ingestSourceAdapter(
      new CodexRolloutAdapter(options.home),
      getDb(),
      { onProgress: options.onProgress },
    ),
    {
      onRetry: (attempt, attempts) => {
        process.stderr.write(
          `Codex history import is waiting for the local database (${attempt}/${attempts}).\n`,
        );
      },
    },
  );
}

/** Start the initial Codex backfill without delaying the local dashboard. */
export function spawnCodexHistoryImport(options: BackgroundImportOptions = {}): BackgroundImport {
  const configDir = getConfigDir();
  if (!existsSync(configDir)) mkdirSync(configDir, { recursive: true, mode: 0o700 });
  const logPath = join(configDir, 'codex-import.log');
  const logFd = openSync(logPath, 'a', 0o600);
  try {
    const child = spawn(process.execPath, [CLI_ENTRY, 'import-codex'], {
      detached: true,
      stdio: ['ignore', logFd, logFd],
      env: {
        ...process.env,
        AGENT_USAGE_ANALYZE_BACKGROUND_IMPORT: '1',
        ...(options.analyzeAfterImport
          ? { AGENT_USAGE_ANALYZE_ANALYZE_AFTER_IMPORT: '1' }
          : {}),
      },
    });
    child.on('error', () => {
      // A later start or explicit import can safely retry the idempotent backfill.
    });
    child.unref();
    return { pid: child.pid, logPath };
  } finally {
    closeSync(logFd);
  }
}

export async function runImportCodexCommand(
  options: { home?: string; analyzeAfterImport?: boolean },
  dependencies: ImportCodexCommandDependencies = defaultCommandDependencies,
): Promise<void> {
  const summary = await dependencies.importHistory(options);
  const analyzeAfterImport = options.analyzeAfterImport === true
    || process.env.AGENT_USAGE_ANALYZE_ANALYZE_AFTER_IMPORT === '1';
  if (analyzeAfterImport) {
    try {
      dependencies.startHistoryAnalysis();
    } catch (error) {
      dependencies.warn?.(`Initial session analysis could not start: ${error instanceof Error ? error.message : String(error)}`);
    }
    try {
      dependencies.startBehaviorReport();
    } catch (error) {
      dependencies.warn?.(`Initial behavior report could not start: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  dependencies.writeSummary(summary);
}

export async function importCodexCommand(options: { home?: string; analyzeAfterImport?: boolean }): Promise<void> {
  await runImportCodexCommand(options);
}
