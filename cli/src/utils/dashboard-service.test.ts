import { afterEach, describe, expect, it, vi } from 'vitest';

const existsSync = vi.fn(() => true);
const mkdirSync = vi.fn();
const writeFileSync = vi.fn();
const spawn = vi.fn(() => ({ unref: vi.fn() }));
const spawnSync = vi.fn();
const isCodexAnalyticsDashboard = vi.fn(async () => false);

vi.mock('node:fs', () => ({ existsSync, mkdirSync, writeFileSync }));
vi.mock('node:child_process', () => ({ spawn, spawnSync }));
vi.mock('../commands/dashboard.js', () => ({ isCodexAnalyticsDashboard }));
vi.mock('./config.js', () => ({ getConfigDir: () => '/tmp/agent-usage-analyze' }));

const originalPlatform = process.platform;

afterEach(() => {
  Object.defineProperty(process, 'platform', { value: originalPlatform });
  vi.clearAllMocks();
});

describe('ensureDashboardService', () => {
  it('falls back to a detached dashboard when macOS rejects the LaunchAgent bootstrap', async () => {
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    spawnSync.mockImplementation((command: string, args: string[]) => {
      if (command === 'launchctl' && args[0] === 'bootstrap') {
        return { status: 5, stderr: 'Bootstrap failed: 5: Input/output error' };
      }
      return { status: 0, stdout: '' };
    });
    isCodexAnalyticsDashboard.mockResolvedValueOnce(false).mockResolvedValueOnce(true);

    const { ensureDashboardService } = await import('./dashboard-service.js');
    await expect(ensureDashboardService(7890)).resolves.toEqual({ persistent: false });

    expect(writeFileSync).toHaveBeenCalledOnce();
    expect(spawn).toHaveBeenCalledWith(
      process.execPath,
      expect.arrayContaining(['dashboard', '--port', '7890', '--no-open']),
      { detached: true, stdio: 'ignore' },
    );
  });
});
