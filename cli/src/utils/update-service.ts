import { spawn } from 'node:child_process';
import {
  existsSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureConfigDir, getConfigDir, loadConfig, saveConfig } from './config.js';

export const PRODUCT_PACKAGE_NAME = 'agent-usage-analyze';
export const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

export type ProductInstallationMode = 'source' | 'npm-global' | 'npx' | 'unsupported';

export interface ProductUpdateStatus {
  packageName: typeof PRODUCT_PACKAGE_NAME;
  currentVersion: string;
  latestVersion: string | null;
  pendingVersion: string | null;
  updateAvailable: boolean;
  checking: boolean;
  updating: boolean;
  autoUpdate: boolean;
  installationMode: ProductInstallationMode;
  canUpdate: boolean;
  lastCheckedAt: string | null;
  lastUpdatedAt: string | null;
  restartRequired: boolean;
  error: string | null;
}

interface PersistedUpdateState {
  latestVersion?: string;
  pendingVersion?: string;
  lastCheckedAt?: string;
  lastUpdatedAt?: string;
  error?: string;
}

interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface ProductUpdateDependencies {
  fetch: typeof globalThis.fetch;
  runCommand: (file: string, args: string[]) => Promise<CommandResult>;
  now: () => Date;
  packageRoot: string;
  currentVersion: string;
  readState: () => PersistedUpdateState;
  writeState: (state: PersistedUpdateState) => void;
}

function defaultPackageRoot(): string {
  return fileURLToPath(new URL('../../', import.meta.url));
}

function packageVersion(packageRoot: string): string {
  try {
    const parsed = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8')) as {
      name?: unknown;
      version?: unknown;
    };
    if (parsed.name === PRODUCT_PACKAGE_NAME && typeof parsed.version === 'string') {
      return parsed.version;
    }
  } catch {
    // The status endpoint will expose an unknown local version below.
  }
  return '0.0.0';
}

function updateStatePath(): string {
  return join(getConfigDir(), 'update-state.json');
}

function readPersistedState(): PersistedUpdateState {
  try {
    const value = JSON.parse(readFileSync(updateStatePath(), 'utf8')) as PersistedUpdateState;
    return value && typeof value === 'object' ? value : {};
  } catch {
    return {};
  }
}

function writePersistedState(state: PersistedUpdateState): void {
  ensureConfigDir();
  writeFileSync(updateStatePath(), JSON.stringify(state, null, 2), { mode: 0o600 });
}

function runCommand(file: string, args: string[]): Promise<CommandResult> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(file, args, {
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      const forceKill = setTimeout(() => child.kill('SIGKILL'), 5_000);
      forceKill.unref();
    }, 5 * 60 * 1000);
    timeout.unref();
    const append = (existing: string, chunk: Buffer): string =>
      (existing + chunk.toString('utf8')).slice(-32_768);
    child.stdout.on('data', (chunk: Buffer) => { stdout = append(stdout, chunk); });
    child.stderr.on('data', (chunk: Buffer) => { stderr = append(stderr, chunk); });
    child.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once('close', (code) => {
      clearTimeout(timeout);
      resolvePromise({
        exitCode: code ?? 1,
        stdout,
        stderr: timedOut ? `${stderr}\nCommand timed out after 5 minutes`.trim() : stderr,
      });
    });
  });
}

function normalizePath(value: string): string {
  let normalized = resolve(value);
  try {
    normalized = realpathSync.native(normalized);
  } catch {
    // A missing or inaccessible path cannot match a real global installation.
  }
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function isSourceCheckout(packageRoot: string): boolean {
  return existsSync(join(packageRoot, '..', 'pnpm-workspace.yaml'));
}

function isNpxCache(packageRoot: string): boolean {
  return /[/\\](?:\.npm[/\\])?_npx[/\\]/.test(packageRoot);
}

function validVersion(value: unknown): value is string {
  return typeof value === 'string'
    && /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(value);
}

function versionParts(value: string): {
  numbers: [number, number, number];
  prerelease: string[];
} | null {
  if (!validVersion(value)) return null;
  const [withoutBuild] = value.split('+');
  const [core, prerelease = ''] = withoutBuild.split('-', 2);
  const values = core.split('.').map(Number);
  return {
    numbers: [values[0], values[1], values[2]],
    prerelease: prerelease ? prerelease.split('.') : [],
  };
}

export function compareVersions(left: string, right: string): number {
  const a = versionParts(left);
  const b = versionParts(right);
  if (!a || !b) return 0;
  for (let index = 0; index < 3; index += 1) {
    if (a.numbers[index] !== b.numbers[index]) {
      return a.numbers[index] > b.numbers[index] ? 1 : -1;
    }
  }
  if (a.prerelease.length === 0 || b.prerelease.length === 0) {
    if (a.prerelease.length === b.prerelease.length) return 0;
    return a.prerelease.length === 0 ? 1 : -1;
  }
  const length = Math.max(a.prerelease.length, b.prerelease.length);
  for (let index = 0; index < length; index += 1) {
    const leftPart = a.prerelease[index];
    const rightPart = b.prerelease[index];
    if (leftPart === undefined) return -1;
    if (rightPart === undefined) return 1;
    if (leftPart === rightPart) continue;
    const leftNumber = /^\d+$/.test(leftPart) ? Number(leftPart) : null;
    const rightNumber = /^\d+$/.test(rightPart) ? Number(rightPart) : null;
    if (leftNumber !== null && rightNumber !== null) return leftNumber > rightNumber ? 1 : -1;
    if (leftNumber !== null) return -1;
    if (rightNumber !== null) return 1;
    return leftPart > rightPart ? 1 : -1;
  }
  return 0;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class ProductUpdateService {
  private readonly dependencies: ProductUpdateDependencies;
  private readonly persisted: PersistedUpdateState;
  private installationMode: ProductInstallationMode = 'unsupported';
  private initialized: Promise<void> | null = null;
  private checkPromise: Promise<ProductUpdateStatus> | null = null;
  private checking = false;
  private updating = false;

  constructor(dependencies: Partial<ProductUpdateDependencies> = {}) {
    const packageRoot = dependencies.packageRoot ?? defaultPackageRoot();
    this.dependencies = {
      fetch: dependencies.fetch ?? globalThis.fetch,
      runCommand: dependencies.runCommand ?? runCommand,
      now: dependencies.now ?? (() => new Date()),
      packageRoot,
      currentVersion: dependencies.currentVersion ?? packageVersion(packageRoot),
      readState: dependencies.readState ?? readPersistedState,
      writeState: dependencies.writeState ?? writePersistedState,
    };
    this.persisted = this.dependencies.readState();
  }

  private async initialize(): Promise<void> {
    if (this.initialized) return this.initialized;
    this.initialized = (async () => {
      const packageRoot = this.dependencies.packageRoot;
      if (isSourceCheckout(packageRoot)) {
        this.installationMode = 'source';
      } else if (isNpxCache(packageRoot)) {
        this.installationMode = 'npx';
      } else {
        try {
          const npmRoot = await this.dependencies.runCommand('npm', ['root', '--global']);
          const expectedRoot = npmRoot.exitCode === 0
            ? join(npmRoot.stdout.trim(), PRODUCT_PACKAGE_NAME)
            : '';
          this.installationMode = expectedRoot
            && normalizePath(packageRoot) === normalizePath(expectedRoot)
            ? 'npm-global'
            : 'unsupported';
        } catch {
          this.installationMode = 'unsupported';
        }
      }

      if (this.persisted.pendingVersion
        && compareVersions(this.dependencies.currentVersion, this.persisted.pendingVersion) >= 0) {
        delete this.persisted.pendingVersion;
        delete this.persisted.error;
        this.persist();
      }
    })();
    return this.initialized;
  }

  private persist(): void {
    this.dependencies.writeState({ ...this.persisted });
  }

  private autoUpdateEnabled(): boolean {
    return loadConfig()?.dashboard?.updates?.autoUpdate === true;
  }

  private statusSnapshot(): ProductUpdateStatus {
    const latestVersion = validVersion(this.persisted.latestVersion)
      ? this.persisted.latestVersion
      : null;
    const pendingVersion = validVersion(this.persisted.pendingVersion)
      ? this.persisted.pendingVersion
      : null;
    return {
      packageName: PRODUCT_PACKAGE_NAME,
      currentVersion: this.dependencies.currentVersion,
      latestVersion,
      pendingVersion,
      updateAvailable: Boolean(
        latestVersion
        && compareVersions(latestVersion, this.dependencies.currentVersion) > 0
        && pendingVersion !== latestVersion,
      ),
      checking: this.checking,
      updating: this.updating,
      autoUpdate: this.autoUpdateEnabled(),
      installationMode: this.installationMode,
      canUpdate: this.installationMode === 'npm-global',
      lastCheckedAt: typeof this.persisted.lastCheckedAt === 'string'
        ? this.persisted.lastCheckedAt : null,
      lastUpdatedAt: typeof this.persisted.lastUpdatedAt === 'string'
        ? this.persisted.lastUpdatedAt : null,
      restartRequired: Boolean(pendingVersion),
      error: typeof this.persisted.error === 'string' ? this.persisted.error : null,
    };
  }

  async getStatus(): Promise<ProductUpdateStatus> {
    await this.initialize();
    return this.statusSnapshot();
  }

  async checkForUpdates(options: { allowAutoUpdate?: boolean } = {}): Promise<ProductUpdateStatus> {
    await this.initialize();
    if (this.checkPromise) return this.checkPromise;
    this.checkPromise = this.performCheck(options.allowAutoUpdate === true);
    try {
      return await this.checkPromise;
    } finally {
      this.checkPromise = null;
    }
  }

  private async performCheck(allowAutoUpdate: boolean): Promise<ProductUpdateStatus> {
    this.checking = true;
    delete this.persisted.error;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    timeout.unref();
    try {
      const response = await this.dependencies.fetch(
        `https://registry.npmjs.org/${PRODUCT_PACKAGE_NAME}/latest`,
        {
          headers: {
            Accept: 'application/json',
            'User-Agent': `${PRODUCT_PACKAGE_NAME}/${this.dependencies.currentVersion}`,
          },
          signal: controller.signal,
        },
      );
      if (!response.ok) throw new Error(`npm registry returned HTTP ${response.status}`);
      const body = await response.json() as { version?: unknown };
      if (!validVersion(body.version)) throw new Error('npm registry returned an invalid version');
      this.persisted.latestVersion = body.version;
      this.persisted.lastCheckedAt = this.dependencies.now().toISOString();
      delete this.persisted.error;
      this.persist();
    } catch (error) {
      this.persisted.error = `Could not check for updates: ${errorMessage(error)}`;
      this.persist();
      throw error;
    } finally {
      clearTimeout(timeout);
      this.checking = false;
    }

    if (allowAutoUpdate
      && this.installationMode === 'npm-global'
      && this.autoUpdateEnabled()
      && this.statusSnapshot().updateAvailable) {
      await this.requestUpdate();
    }
    return this.statusSnapshot();
  }

  async setAutoUpdate(enabled: boolean): Promise<ProductUpdateStatus> {
    await this.initialize();
    if (enabled && this.installationMode !== 'npm-global') {
      throw new Error('Automatic updates require a global npm installation');
    }
    const current = loadConfig();
    saveConfig({
      sync: current?.sync ?? { excludeProjects: [] },
      ...(current?.telemetry === undefined ? {} : { telemetry: current.telemetry }),
      dashboard: {
        ...current?.dashboard,
        updates: { autoUpdate: enabled },
      },
    });
    if (enabled) {
      void this.checkForUpdates({ allowAutoUpdate: true }).catch(() => {
        // The error remains visible in status; toggling the setting stays responsive.
      });
    }
    return this.statusSnapshot();
  }

  async requestUpdate(): Promise<{ accepted: boolean; status: ProductUpdateStatus }> {
    await this.initialize();
    const status = this.statusSnapshot();
    if (!status.canUpdate) throw new Error('Updates can only be installed from a global npm installation');
    if (!status.latestVersion || !status.updateAvailable) {
      throw new Error('No newer version is available');
    }
    if (this.updating) return { accepted: false, status };
    this.updating = true;
    delete this.persisted.error;
    const targetVersion = status.latestVersion;
    void this.performUpdate(targetVersion);
    return { accepted: true, status: this.statusSnapshot() };
  }

  private async performUpdate(targetVersion: string): Promise<void> {
    try {
      const result = await this.dependencies.runCommand('npm', [
        'install',
        '--global',
        `${PRODUCT_PACKAGE_NAME}@${targetVersion}`,
        '--no-audit',
        '--no-fund',
      ]);
      if (result.exitCode !== 0) {
        const detail = result.stderr.trim() || result.stdout.trim() || `npm exited with ${result.exitCode}`;
        throw new Error(detail);
      }
      this.persisted.pendingVersion = targetVersion;
      this.persisted.lastUpdatedAt = this.dependencies.now().toISOString();
      delete this.persisted.error;
    } catch (error) {
      this.persisted.error = `Could not install update: ${errorMessage(error)}`;
    } finally {
      this.updating = false;
      this.persist();
    }
  }

  startScheduler(): { close: () => void } {
    let closed = false;
    const check = () => {
      if (closed || !this.autoUpdateEnabled()) return;
      void this.checkForUpdates({ allowAutoUpdate: true }).catch(() => {
        // The persisted status is shown in Settings; the scheduler stays alive.
      });
    };
    const initial = setTimeout(check, 2_000);
    const interval = setInterval(check, UPDATE_CHECK_INTERVAL_MS);
    initial.unref();
    interval.unref();
    return {
      close: () => {
        closed = true;
        clearTimeout(initial);
        clearInterval(interval);
      },
    };
  }
}

let sharedService: ProductUpdateService | null = null;

export function getProductUpdateService(): ProductUpdateService {
  sharedService ??= new ProductUpdateService();
  return sharedService;
}

export function setProductUpdateServiceForTests(service: ProductUpdateService | null): void {
  sharedService = service;
}
