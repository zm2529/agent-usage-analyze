import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const pkg = JSON.parse(readFileSync(join(root, 'cli/package.json'), 'utf8'));
if (pkg.name !== 'agent-usage-analyze' || pkg.bin?.['agent-usage-analyze'] !== 'dist/index.js') {
  throw new Error('Public package identity must remain agent-usage-analyze with its matching binary');
}
const sandbox = mkdtempSync(join(tmpdir(), 'agent-usage-analyze-install-smoke-'));
const packDirectory = join(sandbox, 'pack');
const prefix = join(sandbox, 'prefix');
mkdirSync(packDirectory, { recursive: true });

async function availablePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

async function verifyInstalledDashboard(command, env) {
  const port = await availablePort();
  const child = spawn(command, ['dashboard', '--port', String(port), '--no-open'], {
    env,
    shell: process.platform === 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  let launchError = null;
  const append = (chunk) => { output = (output + chunk.toString('utf8')).slice(-16_384); };
  child.stdout.on('data', append);
  child.stderr.on('data', append);
  child.once('error', (error) => { launchError = error; });
  try {
    let status = null;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      if (launchError) break;
      try {
        const response = await fetch(`http://127.0.0.1:${port}/api/updates/status`);
        if (response.ok) {
          status = await response.json();
          break;
        }
      } catch {
        // The installed dashboard is still starting.
      }
    }
    if (!status) {
      throw new Error(`Installed dashboard did not become ready.${launchError ? ` ${launchError.message}` : ''}\n${output}`);
    }
    if (status.currentVersion !== pkg.version
      || status.installationMode !== 'npm-global'
      || status.canUpdate !== true) {
      throw new Error(`Installed dashboard returned invalid update status: ${JSON.stringify(status)}`);
    }
  } finally {
    child.kill('SIGTERM');
    await Promise.race([
      new Promise((resolve) => child.once('close', resolve)),
      new Promise((resolve) => setTimeout(resolve, 5_000)),
    ]);
  }
}

try {
  execFileSync('pnpm', ['build'], { cwd: root, stdio: 'inherit' });
  execFileSync('pnpm', ['package:prepare'], { cwd: root, stdio: 'inherit' });
  const pack = JSON.parse(execFileSync('npm', [
    'pack', './cli', '--ignore-scripts', '--json', '--pack-destination', packDirectory,
  ], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }))[0];
  const tarball = join(packDirectory, pack.filename);
  execFileSync('npm', [
    'install', '--global', '--prefix', prefix, '--no-audit', '--no-fund', tarball,
  ], { cwd: root, stdio: 'inherit' });

  const binDirectory = process.platform === 'win32' ? prefix : join(prefix, 'bin');
  const command = process.platform === 'win32'
    ? join(binDirectory, 'agent-usage-analyze.cmd')
    : join(binDirectory, 'agent-usage-analyze');
  const env = {
    ...process.env,
    PATH: `${binDirectory}${delimiter}${process.env.PATH ?? ''}`,
    npm_config_prefix: prefix,
  };
  const version = execFileSync(command, ['--version'], { encoding: 'utf8', env }).trim();
  execFileSync(command, ['--help'], { stdio: 'ignore', env });
  if (version !== pkg.version) {
    throw new Error(`Installed CLI reported ${version}; expected ${pkg.version}`);
  }
  await verifyInstalledDashboard(command, env);
  process.stdout.write(`package-install-smoke: ${pkg.name}@${version} installed and executed\n`);
} finally {
  try {
    execFileSync(process.execPath, [join(root, 'scripts/clean-cli-package.mjs')], {
      cwd: root,
      stdio: 'ignore',
    });
  } catch {
    // Preserve the primary smoke failure; generated assets are safe to remove manually.
  }
  rmSync(sandbox, { recursive: true, force: true });
}
