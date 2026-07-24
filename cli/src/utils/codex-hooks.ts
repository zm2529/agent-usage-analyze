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
const MANAGED_CODEX_EVENTS = ['UserPromptSubmit', 'Stop'] as const;

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
  const alreadyCurrent = MANAGED_CODEX_EVENTS.every((event) => {
    const commands = (config.hooks?.[event] ?? [])
      .flatMap((group) => group.hooks.map(getHookCommand)).filter(managed);
    return commands.length === 1 && current(commands[0]);
  });
  if (alreadyCurrent) {
    return { changed: false, file, backup: null };
  }
  const backupFile = backup(file);
  const hooks = { ...config.hooks };
  for (const event of MANAGED_CODEX_EVENTS) {
    hooks[event] = [
      ...withoutManagedHandlers(hooks[event] ?? []),
      { hooks: [{ type: 'command', command: codexHookCommand(), timeout: 8 }] },
    ];
  }
  config.hooks = hooks;
  writePrivate(file, config);
  return { changed: true, file, backup: backupFile };
}

export function uninstallCodexHook(): { changed: boolean; file: string } {
  const file = codexHooksPath();
  if (!fs.existsSync(file)) return { changed: false, file };
  const config = readExisting(file);
  const managedCount = MANAGED_CODEX_EVENTS.reduce((total, event) => total
    + (config.hooks?.[event] ?? []).reduce(
      (count, group) => count + group.hooks.filter((hook) => managed(getHookCommand(hook))).length, 0,
    ), 0);
  if (managedCount === 0) return { changed: false, file };
  const hooks = { ...config.hooks };
  for (const event of MANAGED_CODEX_EVENTS) {
    const filtered = withoutManagedHandlers(hooks[event] ?? []);
    if (filtered.length) hooks[event] = filtered; else delete hooks[event];
  }
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
    const eventCommands = MANAGED_CODEX_EVENTS.map((event) => (config.hooks?.[event] ?? [])
      .flatMap((group) => group.hooks.map((hook) => getHookCommand(hook))));
    return {
      installed: eventCommands.every((commands) => commands.some(current)),
      stale: eventCommands.some((commands) => commands.some((command) => managed(command) && !current(command))),
      file,
    };
  } catch (error) {
    return { installed: false, stale: false, file, parseError: error instanceof Error ? error.message : String(error) };
  }
}
