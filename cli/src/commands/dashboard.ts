import { resolve, dirname } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { existsSync } from 'fs';
import chalk from 'chalk';
import ora from 'ora';
import net from 'net';
import { trackEvent, identifyUser, captureError, classifyError } from '../utils/telemetry.js';
import { printBanner } from '../utils/banner.js';
import { runSync } from './sync.js';
import { openUrl } from '../utils/browser.js';

interface DashboardOptions {
  port: string;
  open: boolean;
  // Explicit opt-in only. Starting the dashboard must not scan real history.
  sync?: boolean;
}

export async function syncLegacyProjectionIfRequested(
  enabled: boolean | undefined,
  sync: (options: { quiet: boolean }) => Promise<unknown> = runSync,
): Promise<void> {
  if (enabled !== true) return;
  await sync({ quiet: false });
}

/**
 * Check if a port is already in use.
 * - Checks only EADDRINUSE, not other errors (e.g. EACCES for privileged ports).
 * - Waits for the test socket to fully close before resolving, avoiding a TOCTOU
 *   race where the real server tries to bind before the OS releases the port.
 */
function isPortInUse(port: number): Promise<boolean> {
  return new Promise((resolvePromise) => {
    const server = net.createServer();
    server.once('error', (err: NodeJS.ErrnoException) => {
      server.close();
      resolvePromise(err.code === 'EADDRINUSE');
    });
    server.once('listening', () => {
      // Wait for close callback before resolving so the OS fully releases the port
      server.close(() => resolvePromise(false));
    });
    server.listen(port, '127.0.0.1');
  });
}

export async function isCodexAnalyticsDashboard(
  port: number,
  request: typeof fetch = fetch,
): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 750);
  try {
    const response = await request(`http://127.0.0.1:${port}/api/health`, {
      signal: controller.signal,
    });
    if (!response.ok) return false;
    const body = await response.json() as { ok?: unknown };
    return body.ok === true;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Start the Agent Usage Analyzer local dashboard server.
 *
 * Loads server/dist/index.js by file URL rather than package name to avoid a
 * circular workspace dependency (the server depends on the CLI package, so CLI
 * cannot list @agent-analytics/server as a build-time dep). pathToFileURL ensures
 * the import works on Windows where absolute paths like C:\... are not valid
 * ESM import specifiers.
 */
export async function dashboardCommand(options: DashboardOptions): Promise<void> {
  // Legacy session projection is explicit opt-in while canonical Codex ingestion is built.
  if (options.sync === true) {
    try {
      await syncLegacyProjectionIfRequested(options.sync);
      void identifyUser();
    } catch (err) {
      // Sync failure is non-fatal — dashboard still opens with whatever data exists
      console.warn(chalk.yellow(`  Sync warning: ${err instanceof Error ? err.message : String(err)}`));
      console.warn(chalk.dim('  Run `agent-usage-analyze sync` separately if needed.'));
    }
  }

  const port = parseInt(options.port, 10);

  if (isNaN(port) || port < 1 || port > 65535) {
    console.error(chalk.red(`  Invalid port: ${options.port}`));
    process.exit(1);
  }

  const inUse = await isPortInUse(port);
  if (inUse) {
    if (await isCodexAnalyticsDashboard(port)) {
      const url = `http://localhost:${port}`;
      console.log(chalk.green(`  ✓ Dashboard already running at ${url}`));
      if (options.open) openUrl(url);
      return;
    }
    console.error(chalk.red(`  Port ${port} is already in use.`));
    console.error(chalk.dim(`  Try: agent-usage-analyze dashboard --port <number>`));
    process.exit(1);
  }

  const spinner = ora('Starting Agent Usage Analyzer dashboard...').start();

  try {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);

    // cli/dist/commands/dashboard.js -> workspace root is 3 levels up
    const workspaceRoot = resolve(__dirname, '..', '..', '..');
    // cli/dist/commands/dashboard.js -> CLI package root is 2 levels up
    const cliRoot = resolve(__dirname, '..', '..');

    // Try workspace layout first (dev), then npm-installed layout (production)
    let serverEntryPath = resolve(workspaceRoot, 'server', 'dist', 'index.js');
    let staticDir = resolve(workspaceRoot, 'dashboard', 'dist');

    if (!existsSync(serverEntryPath)) {
      serverEntryPath = resolve(cliRoot, 'server-dist', 'index.js');
      staticDir = resolve(cliRoot, 'dashboard-dist');
    }

    if (!existsSync(serverEntryPath)) {
      spinner.fail('Dashboard server not found.');
      console.error(chalk.dim(
        '  Run from a workspace checkout: pnpm install && pnpm build\n' +
        '  Or run directly: npx --yes agent-usage-analyze start\n' +
        '  See: https://github.com/zm2529/agent-usage-analyze#development',
      ));
      process.exit(1);
    }

    // Use pathToFileURL so the import specifier is valid on all platforms,
    // including Windows where resolve() returns C:\...\index.js.
    type ServerModule = { startServer: (opts: { port: number; staticDir: string; openBrowser: boolean }) => Promise<void> };
    const { startServer } = await import(pathToFileURL(serverEntryPath).href) as ServerModule;

    spinner.stop();
    printBanner();
    console.log(chalk.white(`  Dashboard:  `) + chalk.cyan.underline(`http://localhost:${port}`));
    console.log(chalk.dim(`  Press Ctrl+C to stop`));
    console.log('');

    trackEvent('cli_dashboard', { port: port, success: true });
    await startServer({ port, staticDir, openBrowser: options.open });
  } catch (err) {
    spinner.fail('Failed to start dashboard server.');
    console.error(chalk.red(err instanceof Error ? err.message : String(err)));
    const { error_type, error_message } = classifyError(err);
    trackEvent('cli_dashboard', { success: false, error_type, error_message });
    captureError(err, { command: 'dashboard', error_type });
    process.exit(1);
  }
}
