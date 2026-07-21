import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { ClaudeInsightConfig, SyncState } from '../types.js';

const CONFIG_DIR_ENV = 'AGENT_ANALYTICS_CONFIG_DIR';

function resolveConfigDir(): string {
  const envDir = process.env[CONFIG_DIR_ENV];
  if (envDir && envDir.trim()) return envDir;
  return path.join(os.homedir(), '.agent-analytics');
}

function getConfigFilePath(): string {
  return path.join(resolveConfigDir(), 'config.json');
}

function getSyncStateFilePath(): string {
  return path.join(resolveConfigDir(), 'sync-state.json');
}

/**
 * Ensure config directory exists
 */
export function ensureConfigDir(): void {
  const configDir = resolveConfigDir();
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true, mode: 0o700 });
  }
}

/**
 * Load configuration from file
 */
export function loadConfig(): ClaudeInsightConfig | null {
  try {
    const configFile = getConfigFilePath();
    if (!fs.existsSync(configFile)) {
      return null;
    }
    const content = fs.readFileSync(configFile, 'utf-8');
    return JSON.parse(content) as ClaudeInsightConfig;
  } catch {
    return null;
  }
}

/**
 * Save configuration to file.
 *
 * Only the known fields of ClaudeInsightConfig are written. This strips any
 * stale keys (e.g. `firebase`, `webConfig`, `dataSource`, `dashboardUrl`)
 * that may have been persisted by earlier versions of the CLI, so they don't
 * accumulate in the config file across upgrades.
 */
export function saveConfig(config: ClaudeInsightConfig): void {
  ensureConfigDir();
  const configFile = getConfigFilePath();
  const clean: ClaudeInsightConfig = {
    sync: config.sync,
  };
  if (config.dashboard !== undefined) {
    clean.dashboard = {
      ...(config.dashboard.port !== undefined ? { port: config.dashboard.port } : {}),
      ...(config.dashboard.llm !== undefined ? { llm: config.dashboard.llm } : {}),
    };
  }
  if (config.telemetry !== undefined) {
    clean.telemetry = config.telemetry;
  }
  fs.writeFileSync(configFile, JSON.stringify(clean, null, 2), { mode: 0o600 });
}

/**
 * Load sync state
 */
export function loadSyncState(): SyncState {
  try {
    const syncStateFile = getSyncStateFilePath();
    if (!fs.existsSync(syncStateFile)) {
      return { lastSync: '', files: {} };
    }
    const content = fs.readFileSync(syncStateFile, 'utf-8');
    return JSON.parse(content) as SyncState;
  } catch {
    return { lastSync: '', files: {} };
  }
}

/**
 * Save sync state
 */
export function saveSyncState(state: SyncState): void {
  ensureConfigDir();
  fs.writeFileSync(getSyncStateFilePath(), JSON.stringify(state, null, 2), { mode: 0o600 });
}

/**
 * Get default Claude directory
 */
export function getClaudeDir(): string {
  return path.join(os.homedir(), '.claude', 'projects');
}

/**
 * Check if config exists
 */
export function isConfigured(): boolean {
  return fs.existsSync(getConfigFilePath());
}

/**
 * Get config directory path
 */
export function getConfigDir(): string {
  return resolveConfigDir();
}

/**
 * Get the sync state file path (used by reset command)
 */
export function getSyncStatePath(): string {
  return getSyncStateFilePath();
}
