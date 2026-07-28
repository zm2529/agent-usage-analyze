import { execFileSync, spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import chalk from 'chalk';
import { Command } from 'commander';
import { closeDb } from '../db/client.js';
import { getConfigDir, loadConfig } from '../utils/config.js';
import { codexConfigRoot } from '../utils/codex-hooks.js';
import { uninstallHookCommand } from './install-hook.js';

const PRODUCT_DIRS = ['.agent-usage-analyze', '.agent-analytics'] as const;
const CODEX_ARTIFACT_PREFIXES = [
  'hooks.json.agent-analytics-',
  'hooks.json.agent-usage-analyze-',
] as const;
const MACOS_SERVICE_LABELS = [
  'local.agent-usage-analyze.dashboard',
  'local.agent-analytics.dashboard',
] as const;
const TEMP_ARTIFACTS = [
  '/tmp/run-agent-usage-dashboard.sh',
  '/tmp/agent-usage-analyze-dashboard.log',
  '/tmp/agent-usage-analyze-dashboard-error.log',
] as const;

export interface UninstallResult {
  removedPaths: string[];
  stoppedProcessIds: number[];
}

function isSafeRemovalTarget(target: string, homeDir: string, cwd: string): boolean {
  const resolved = path.resolve(target);
  const root = path.parse(resolved).root;
  const home = path.resolve(homeDir);
  const workingDirectory = path.resolve(cwd);
  if (resolved === root || resolved === home || home.startsWith(`${resolved}${path.sep}`)) return false;
  if (resolved === workingDirectory || workingDirectory.startsWith(`${resolved}${path.sep}`)) return false;
  return true;
}

function removePath(target: string, removedPaths: string[]): void {
  if (!fs.existsSync(target)) return;
  fs.rmSync(target, { recursive: true, force: true });
  removedPaths.push(target);
}

function removeEmptyJsonObject(file: string, removedPaths: string[]): void {
  if (!fs.existsSync(file)) return;
  try {
    const value = JSON.parse(fs.readFileSync(file, 'utf8')) as unknown;
    if (value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0) {
      removePath(file, removedPaths);
    }
  } catch {
    // Preserve files that are not an empty JSON object.
  }
}

export function parseProductProcessIds(processTable: string, currentPid = process.pid): number[] {
  const productCli = /(?:^|\s)\S*node(?:\s|$).*[/\\](?:agent-usage-analyze|agent-analytics)(?:[/\\][^\s]*)*[/\\]dist[/\\]index\.js(?:\s|$)/;
  const result = new Set<number>();
  for (const line of processTable.split(/\r?\n/)) {
    const match = line.trim().match(/^(\d+)\s+(.+)$/);
    if (!match || !productCli.test(match[2])) continue;
    const pid = Number(match[1]);
    if (Number.isInteger(pid) && pid > 1 && pid !== currentPid) result.add(pid);
  }
  return [...result];
}

function dashboardProcessIds(processTable: string): number[] {
  const port = loadConfig()?.dashboard?.port ?? 7890;
  let listenerOutput = '';
  try {
    listenerOutput = execFileSync('lsof', [
      '-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t',
    ], { encoding: 'utf8' });
  } catch {
    return [];
  }
  const listeners = new Set(listenerOutput.split(/\s+/).map(Number).filter(Number.isInteger));
  const ids: number[] = [];
  for (const line of processTable.split(/\r?\n/)) {
    const match = line.trim().match(/^(\d+)\s+(.+)$/);
    if (!match) continue;
    const pid = Number(match[1]);
    const command = match[2];
    if (listeners.has(pid) && /\bnode(?:\s|$).*cli[/\\]dist[/\\]index\.js\s+(?:start|dashboard)(?:\s|$)/.test(command)) {
      ids.push(pid);
    }
  }
  return ids;
}

export function stopProductProcesses(): number[] {
  if (process.platform === 'win32') return [];
  let processTable = '';
  try {
    processTable = execFileSync('ps', ['-axo', 'pid=,command='], { encoding: 'utf8' });
  } catch {
    return [];
  }
  const stopped: number[] = [];
  const productProcesses = new Set([
    ...parseProductProcessIds(processTable),
    ...dashboardProcessIds(processTable),
  ]);
  for (const pid of productProcesses) {
    try {
      process.kill(pid, 'SIGTERM');
      stopped.push(pid);
    } catch (error) {
      const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
      if (code !== 'ESRCH') throw error;
    }
  }
  return stopped;
}

export function stopProductServices(): void {
  if (process.platform !== 'darwin' || typeof process.getuid !== 'function') return;
  const domain = `gui/${process.getuid()}`;
  for (const label of MACOS_SERVICE_LABELS) {
    spawnSync('launchctl', ['bootout', `${domain}/${label}`], { stdio: 'ignore' });
    spawnSync('launchctl', ['remove', label], { stdio: 'ignore' });
  }
}

export function removeProductOwnedFiles(options: {
  homeDir?: string;
  configDir?: string;
  codexRoot?: string;
  cwd?: string;
} = {}): string[] {
  const homeDir = path.resolve(options.homeDir ?? os.homedir());
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const configDir = path.resolve(options.configDir ?? getConfigDir());
  const codexRoot = path.resolve(options.codexRoot ?? codexConfigRoot());
  const removedPaths: string[] = [];
  const stateTargets = new Set([
    ...PRODUCT_DIRS.map((name) => path.join(homeDir, name)),
    configDir,
    path.join(homeDir, 'Library', 'LaunchAgents', 'local.agent-usage-analyze.dashboard.plist'),
    path.join(homeDir, 'Library', 'LaunchAgents', 'local.agent-analytics.dashboard.plist'),
  ]);

  for (const target of stateTargets) {
    if (!isSafeRemovalTarget(target, homeDir, cwd)) {
      throw new Error(`Refusing to remove unsafe data path: ${target}`);
    }
    removePath(target, removedPaths);
  }

  if (fs.existsSync(codexRoot)) {
    for (const name of fs.readdirSync(codexRoot)) {
      if (CODEX_ARTIFACT_PREFIXES.some((prefix) => name.startsWith(prefix))) {
        removePath(path.join(codexRoot, name), removedPaths);
      }
    }
  }

  removeEmptyJsonObject(path.join(codexRoot, 'hooks.json'), removedPaths);
  removeEmptyJsonObject(path.join(homeDir, '.claude', 'settings.json'), removedPaths);
  for (const artifact of TEMP_ARTIFACTS) removePath(artifact, removedPaths);
  return removedPaths;
}

export async function uninstallProduct(): Promise<UninstallResult> {
  stopProductServices();
  const stoppedProcessIds = stopProductProcesses();
  await uninstallHookCommand({ source: 'all' });
  closeDb();
  const removedPaths = removeProductOwnedFiles();
  return { removedPaths, stoppedProcessIds };
}

export const uninstallCommand = new Command('uninstall')
  .description('Remove hooks, services, and all local Agent Usage Analyzer data')
  .option('--confirm', 'Skip the destructive-action confirmation')
  .action(async (options: { confirm?: boolean }) => {
    console.log(chalk.yellow.bold('\n  This permanently removes all local Agent Usage Analyzer data and hooks.'));
    console.log(chalk.gray('  Imported Codex/Claude sessions and source repositories are not changed.\n'));

    if (!options.confirm) {
      const readline = await import('readline');
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      const answer = await new Promise<string>((resolve) => {
        rl.question(chalk.cyan('Type "UNINSTALL" to confirm: '), resolve);
      });
      rl.close();
      if (answer !== 'UNINSTALL') {
        console.log(chalk.gray('\nAborted. Nothing was removed.'));
        return;
      }
    }

    try {
      const result = await uninstallProduct();
      console.log(chalk.green('\n  Local uninstall complete.'));
      if (result.stoppedProcessIds.length > 0) {
        console.log(chalk.gray(`  Stopped ${result.stoppedProcessIds.length} running process(es).`));
      }
      console.log(chalk.gray(`  Removed ${result.removedPaths.length} local path(s).`));
      const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
      const packageRemoval = spawnSync(npm, [
        'uninstall', '-g', 'agent-usage-analyze', '@agent-analytics/cli',
      ], { stdio: 'inherit' });
      if (packageRemoval.error || packageRemoval.status !== 0) {
        console.log(chalk.yellow('  Local data was removed, but npm could not remove the global command.'));
        console.log(chalk.dim('  Run: npm uninstall -g agent-usage-analyze @agent-analytics/cli\n'));
        process.exitCode = 1;
      } else {
        console.log(chalk.green('  Global npm command removed.\n'));
      }
    } catch (error) {
      console.error(chalk.red(`\n  Uninstall failed: ${error instanceof Error ? error.message : String(error)}\n`));
      process.exitCode = 1;
    }
  });
