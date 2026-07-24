import { appendFileSync, existsSync, mkdirSync, renameSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { getConfigDir } from '../utils/config.js';

const MAX_LOG_BYTES = 5 * 1024 * 1024;

export interface IngestionLogEvent {
  stage: 'hook' | 'watcher' | 'scheduler' | 'import' | 'projection';
  outcome: string;
  sessionId?: string;
  sourcePath?: string;
  diagnostic?: string;
  generation?: number;
  sizeBytes?: number;
  durationMs?: number;
  retryAttempt?: number;
  retryDelayMs?: number;
}

/** Append one bounded, local-only pipeline diagnostic without conversation content. */
export function recordIngestionLog(event: IngestionLogEvent): void {
  try {
    const directory = getConfigDir();
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const path = join(directory, 'session-ingestion.log');
    if (existsSync(path) && statSync(path).size >= MAX_LOG_BYTES) {
      renameSync(path, `${path}.1`);
    }
    appendFileSync(path, `${JSON.stringify({
      observedAt: new Date().toISOString(),
      pid: process.pid,
      ...event,
    })}\n`, { encoding: 'utf8', mode: 0o600 });
  } catch {
    // Diagnostics must never block capture or import.
  }
}
