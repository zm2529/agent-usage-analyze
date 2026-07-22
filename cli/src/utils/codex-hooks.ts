import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { CLI_ENTRY, getHookCommand, type HookConfig } from './hooks-utils.js';

export type HookSource = 'auto' | 'claude' | 'codex' | 'all';

export interface CodexHooksFile {
  hooks?: Record<string, HookConfig[] | undefined>;
  [key: string]: unknown;
}

export const CODEX_HOOK_MARKER = 'agent-analytics-v1';
export const codexConfigRoot = (): string => process.env.AGENT_ANALYTICS_CODEX_HOME
  || process.env.CODEX_HOME
  || path.join(os.homedir(), '.codex');
export const codexHooksPath = (): string => path.join(codexConfigRoot(), 'hooks.json');
export const codexConfigPath = (): string => path.join(codexConfigRoot(), 'config.toml');
export const codexHookCommand = (): string => `node ${JSON.stringify(CLI_ENTRY)} codex-stop -q --managed-hook ${CODEX_HOOK_MARKER}`;
const managed = (command: string): boolean => command.includes(`codex-stop -q --managed-hook ${CODEX_HOOK_MARKER}`);
const current = (command: string): boolean => managed(command) && command === codexHookCommand();

function withoutManagedHandlers(groups: HookConfig[]): HookConfig[] {
  return groups
    .map((group) => ({
      ...group,
      hooks: group.hooks.filter((hook) => !managed(getHookCommand(hook))),
    }))
    .filter((group) => group.hooks.length > 0);
}

export function codexHooksFeatureEnabled(toml: string): boolean {
  let inFeatures = false;
  for (const rawLine of toml.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim();
    const section = line.match(/^\[([^\]]+)]$/);
    if (section) {
      inFeatures = section[1].trim() === 'features';
      continue;
    }
    if (inFeatures && /^hooks\s*=\s*false\s*$/.test(line)) return false;
    if (inFeatures && /^hooks\s*=\s*true\s*$/.test(line)) return true;
  }
  return true;
}

function readExisting(file: string): CodexHooksFile {
  if (!fs.existsSync(file)) return {};
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('root is not an object');
    return parsed as CodexHooksFile;
  } catch (error) {
    throw new Error(`Could not parse Codex hooks.json: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function writePrivate(file: string, value: CodexHooksFile): void {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.agent-analytics.tmp`;
  fs.writeFileSync(temp, JSON.stringify(value, null, 2), { mode: 0o600 });
  fs.renameSync(temp, file);
  fs.chmodSync(file, 0o600);
}

function backup(file: string): string | null {
  if (!fs.existsSync(file)) return null;
  const backupFile = `${file}.agent-analytics-${Date.now()}.bak`;
  fs.copyFileSync(file, backupFile);
  fs.chmodSync(backupFile, 0o600);
  return backupFile;
}

export function installCodexHook(): { changed: boolean; file: string; backup: string | null } {
  const file = codexHooksPath();
  const config = readExisting(file);
  const stop = config.hooks?.Stop ?? [];
  const managedCommands = stop.flatMap((group) => group.hooks.map(getHookCommand)).filter(managed);
  if (managedCommands.length === 1 && current(managedCommands[0])) {
    return { changed: false, file, backup: null };
  }
  const backupFile = backup(file);
  const withoutStaleManaged = withoutManagedHandlers(stop);
  config.hooks = { ...config.hooks, Stop: [
    ...withoutStaleManaged,
    { hooks: [{ type: 'command', command: codexHookCommand(), timeout: 8 }] },
  ] };
  writePrivate(file, config);
  return { changed: true, file, backup: backupFile };
}

export function uninstallCodexHook(): { changed: boolean; file: string } {
  const file = codexHooksPath();
  if (!fs.existsSync(file)) return { changed: false, file };
  const config = readExisting(file);
  const stop = config.hooks?.Stop;
  if (!stop) return { changed: false, file };
  const managedCount = stop.reduce(
    (count, group) => count + group.hooks.filter((hook) => managed(getHookCommand(hook))).length,
    0,
  );
  if (managedCount === 0) return { changed: false, file };
  const filtered = withoutManagedHandlers(stop);
  const hooks = { ...config.hooks };
  if (filtered.length) hooks.Stop = filtered; else delete hooks.Stop;
  config.hooks = hooks;
  if (Object.keys(hooks).length === 0) delete config.hooks;
  backup(file);
  writePrivate(file, config);
  return { changed: true, file };
}

export function inspectCodexHook(): { installed: boolean; stale: boolean; file: string; parseError?: string } {
  const file = codexHooksPath();
  if (!fs.existsSync(file)) return { installed: false, stale: false, file };
  try {
    const config = readExisting(file);
    return {
      installed: Boolean(config.hooks?.Stop?.some((group) => group.hooks.some((hook) => current(getHookCommand(hook))))),
      stale: Boolean(config.hooks?.Stop?.some((group) => group.hooks.some((hook) => managed(getHookCommand(hook)) && !current(getHookCommand(hook))))),
      file,
    };
  } catch (error) {
    return { installed: false, stale: false, file, parseError: error instanceof Error ? error.message : String(error) };
  }
}
