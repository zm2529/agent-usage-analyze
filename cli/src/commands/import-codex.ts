import { spawn } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync } from 'node:fs';
import { join } from 'node:path';
import { CodexRolloutAdapter } from '../canonical/codex-rollout.js';
import { ingestSourceAdapter, type IngestionOptions } from '../canonical/ingestion.js';
import { getDb } from '../db/client.js';
import { getConfigDir } from '../utils/config.js';
import { CLI_ENTRY } from '../utils/hooks-utils.js';

export interface ImportCodexOptions extends IngestionOptions {
  home?: string;
}

export interface BackgroundImport {
  pid: number | undefined;
  logPath: string;
}

export async function importCodexHistory(options: ImportCodexOptions = {}) {
  return ingestSourceAdapter(
    new CodexRolloutAdapter(options.home),
    getDb(),
    { onProgress: options.onProgress },
  );
}

/** Start the initial Codex backfill without delaying the local dashboard. */
export function spawnCodexHistoryImport(): BackgroundImport {
  const configDir = getConfigDir();
  if (!existsSync(configDir)) mkdirSync(configDir, { recursive: true, mode: 0o700 });
  const logPath = join(configDir, 'codex-import.log');
  const logFd = openSync(logPath, 'a', 0o600);
  try {
    const child = spawn(process.execPath, [CLI_ENTRY, 'import-codex'], {
      detached: true,
      stdio: ['ignore', logFd, logFd],
      env: { ...process.env, AGENT_USAGE_ANALYZE_BACKGROUND_IMPORT: '1' },
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

export async function importCodexCommand(options: { home?: string }): Promise<void> {
  const summary = await importCodexHistory(options);
  process.stdout.write(`${JSON.stringify(summary)}\n`);
}
