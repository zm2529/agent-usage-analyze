import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { getConfigDir } from './config.js';
import { isCodexAnalyticsDashboard } from '../commands/dashboard.js';

export const DASHBOARD_SERVICE_LABEL = 'local.agent-usage-analyze.dashboard';

function xml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function cliEntry(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), '..', 'index.js');
}

function servicePath(): string {
  const entries = [dirname(process.execPath)];
  for (const executable of ['codex', 'claude']) {
    const resolved = spawnSync('/usr/bin/which', [executable], {
      encoding: 'utf8',
      env: process.env,
    }).stdout?.trim();
    if (resolved?.startsWith('/')) entries.push(dirname(resolved));
  }
  for (const entry of ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin', '/usr/sbin', '/sbin']) {
    if (!entries.includes(entry)) entries.push(entry);
  }
  return [...new Set(entries)].join(':');
}

async function waitUntilReady(port: number): Promise<void> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (await isCodexAnalyticsDashboard(port)) return;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
  }
  throw new Error(`Dashboard service did not become ready on port ${port}`);
}

export async function ensureDashboardService(port: number): Promise<{ persistent: boolean }> {
  const alreadyRunning = await isCodexAnalyticsDashboard(port);
  if (alreadyRunning && process.platform !== 'darwin') return { persistent: false };
  const entry = cliEntry();
  if (!existsSync(entry)) throw new Error('Dashboard command entry was not found.');

  if (process.platform === 'darwin' && typeof process.getuid === 'function') {
    const launchAgents = join(homedir(), 'Library', 'LaunchAgents');
    const logs = join(getConfigDir(), 'logs');
    mkdirSync(launchAgents, { recursive: true });
    mkdirSync(logs, { recursive: true });
    const plist = join(launchAgents, `${DASHBOARD_SERVICE_LABEL}.plist`);
    writeFileSync(plist, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>${DASHBOARD_SERVICE_LABEL}</string>
<key>ProgramArguments</key><array>
<string>${xml(process.execPath)}</string><string>${xml(entry)}</string>
<string>dashboard</string><string>--port</string><string>${port}</string><string>--no-open</string>
</array>
<key>EnvironmentVariables</key><dict>
<key>PATH</key><string>${xml(servicePath())}</string>
</dict>
<key>RunAtLoad</key><true/>
<key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
<key>StandardOutPath</key><string>${xml(join(logs, 'dashboard.log'))}</string>
<key>StandardErrorPath</key><string>${xml(join(logs, 'dashboard-error.log'))}</string>
</dict></plist>
`, { mode: 0o600 });
    const domain = `gui/${process.getuid()}`;
    spawnSync('launchctl', ['bootout', `${domain}/${DASHBOARD_SERVICE_LABEL}`], { stdio: 'ignore' });
    const bootstrap = spawnSync('launchctl', ['bootstrap', domain, plist], { encoding: 'utf8' });
    if (bootstrap.status !== 0) {
      throw new Error(bootstrap.stderr?.trim() || 'Could not register the dashboard login service.');
    }
    spawnSync('launchctl', ['enable', `${domain}/${DASHBOARD_SERVICE_LABEL}`], { stdio: 'ignore' });
    spawnSync('launchctl', ['kickstart', '-k', `${domain}/${DASHBOARD_SERVICE_LABEL}`], { stdio: 'ignore' });
    await waitUntilReady(port);
    return { persistent: true };
  }

  const child = spawn(process.execPath, [entry, 'dashboard', '--port', String(port), '--no-open'], {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
  await waitUntilReady(port);
  return { persistent: false };
}
