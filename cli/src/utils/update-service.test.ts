import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const configState = vi.hoisted(() => ({
  value: null as {
    sync: { excludeProjects: string[] };
    dashboard?: { updates?: { autoUpdate?: boolean } };
  } | null,
}));

vi.mock('./config.js', () => ({
  ensureConfigDir: vi.fn(),
  getConfigDir: () => '/tmp/agent-usage-analyze-update-test',
  loadConfig: () => configState.value,
  saveConfig: vi.fn((value) => { configState.value = value; }),
}));

const { ProductUpdateService, compareVersions } = await import('./update-service.js');

function registryResponse(version: string): Response {
  return new Response(JSON.stringify({ version }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('product update service', () => {
  beforeEach(() => {
    configState.value = { sync: { excludeProjects: [] } };
  });

  it('orders stable and prerelease semantic versions', () => {
    expect(compareVersions('0.2.0', '0.1.9')).toBe(1);
    expect(compareVersions('1.0.0', '1.0.0-beta.2')).toBe(1);
    expect(compareVersions('1.0.0-beta.2', '1.0.0-beta.10')).toBe(-1);
  });

  it('checks the registry in a source checkout without offering to rewrite source', async () => {
    configState.value = {
      sync: { excludeProjects: [] },
      dashboard: { updates: { autoUpdate: true } },
    };
    const service = new ProductUpdateService({
      packageRoot: fileURLToPath(new URL('../../', import.meta.url)),
      currentVersion: '0.1.2',
      fetch: vi.fn().mockResolvedValue(registryResponse('0.2.0')),
      readState: () => ({}),
      writeState: vi.fn(),
    });

    const status = await service.checkForUpdates({ allowAutoUpdate: true });

    expect(status).toMatchObject({
      currentVersion: '0.1.2',
      latestVersion: '0.2.0',
      updateAvailable: true,
      installationMode: 'source',
      canUpdate: false,
      autoUpdate: true,
    });
    await expect(service.setAutoUpdate(false)).resolves.toMatchObject({ autoUpdate: false });
    await expect(service.setAutoUpdate(true)).rejects.toThrow(/global npm/i);
  });

  it('auto-installs a valid newer version only for the active global npm package', async () => {
    configState.value = {
      sync: { excludeProjects: [] },
      dashboard: { updates: { autoUpdate: true } },
    };
    const commands: Array<{ file: string; args: string[] }> = [];
    let persisted: Record<string, string> = {};
    const runCommand = vi.fn(async (file: string, args: string[]) => {
      commands.push({ file, args });
      if (args[0] === 'root') {
        return { exitCode: 0, stdout: '/opt/mock/lib/node_modules\n', stderr: '' };
      }
      return { exitCode: 0, stdout: 'updated\n', stderr: '' };
    });
    const service = new ProductUpdateService({
      packageRoot: '/opt/mock/lib/node_modules/agent-usage-analyze',
      currentVersion: '0.1.2',
      fetch: vi.fn().mockResolvedValue(registryResponse('0.2.0')),
      runCommand,
      now: () => new Date('2026-07-29T12:00:00.000Z'),
      readState: () => persisted,
      writeState: (state) => { persisted = { ...state } as Record<string, string>; },
    });

    await service.checkForUpdates({ allowAutoUpdate: true });
    await vi.waitFor(async () => {
      expect((await service.getStatus()).restartRequired).toBe(true);
    });

    expect(commands).toContainEqual({
      file: 'npm',
      args: [
        'install', '--global', 'agent-usage-analyze@0.2.0', '--no-audit', '--no-fund',
      ],
    });
    expect(await service.getStatus()).toMatchObject({
      installationMode: 'npm-global',
      pendingVersion: '0.2.0',
      updateAvailable: false,
      lastUpdatedAt: '2026-07-29T12:00:00.000Z',
    });
  });

  it('rejects an invalid registry version before invoking npm install', async () => {
    const runCommand = vi.fn(async (_file: string, args: string[]) => ({
      exitCode: 0,
      stdout: args[0] === 'root' ? '/opt/mock/lib/node_modules\n' : '',
      stderr: '',
    }));
    const service = new ProductUpdateService({
      packageRoot: '/opt/mock/lib/node_modules/agent-usage-analyze',
      currentVersion: '0.1.2',
      fetch: vi.fn().mockResolvedValue(registryResponse('0.2.0; rm -rf /')),
      runCommand,
      readState: () => ({}),
      writeState: vi.fn(),
    });

    await expect(service.checkForUpdates()).rejects.toThrow(/invalid version/i);
    expect(runCommand).toHaveBeenCalledTimes(1);
  });
});
