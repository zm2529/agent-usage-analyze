import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';

// ──────────────────────────────────────────────────────
// Mock os so that module-level constants (CONFIG_DIR, etc.)
// are computed with a predictable home directory.
// vi.mock() is hoisted above all imports, so the mock is
// in place before config.ts evaluates its top-level code.
// ──────────────────────────────────────────────────────

vi.mock('os', () => ({
  default: { homedir: () => '/mock-home' },
  homedir: () => '/mock-home',
}));

vi.mock('fs');

// Dynamic import AFTER mocks — config.ts will see the mocked os at eval time.
const {
  loadConfig,
  saveConfig,
  loadSyncState,
  saveSyncState,
  isConfigured,
  getConfigDir,
  getInstallationId,
  getClaudeDir,
  getSyncStatePath,
} = await import('./config.js');

// ──────────────────────────────────────────────────────
// Expected paths (derived from the mocked homedir)
// ──────────────────────────────────────────────────────

const EXPECTED_CONFIG_DIR = '/mock-home/.agent-usage-analyze';
const EXPECTED_CONFIG_FILE = '/mock-home/.agent-usage-analyze/config.json';
const EXPECTED_SYNC_STATE_FILE = '/mock-home/.agent-usage-analyze/sync-state.json';
const EXPECTED_CLAUDE_DIR = '/mock-home/.claude/projects';

// ──────────────────────────────────────────────────────
// Test suite
// ──────────────────────────────────────────────────────

describe('config utilities', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    delete process.env.AGENT_ANALYTICS_CONFIG_DIR;
    delete process.env.AGENT_USAGE_ANALYZE_CONFIG_DIR;
  });

  // ────────────────────────────────────────────────────
  // Path helpers
  // ────────────────────────────────────────────────────

  describe('getConfigDir', () => {
    it('returns the correct config directory path', () => {
      expect(getConfigDir()).toBe(EXPECTED_CONFIG_DIR);
    });

    it('prefers AGENT_USAGE_ANALYZE_CONFIG_DIR when set', () => {
      process.env.AGENT_USAGE_ANALYZE_CONFIG_DIR = '/task-home/.agent-usage-analyze';

      expect(getConfigDir()).toBe('/task-home/.agent-usage-analyze');
    });

    it('continues accepting the legacy config override', () => {
      process.env.AGENT_ANALYTICS_CONFIG_DIR = '/task-home/.agent-analytics';
      expect(getConfigDir()).toBe('/task-home/.agent-analytics');
    });
  });

  describe('getInstallationId', () => {
    it('creates an opaque identifier inside the product data directory', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      const installationId = getInstallationId();

      expect(installationId).toMatch(/^[0-9a-f-]{36}$/);
      expect(fs.writeFileSync).toHaveBeenCalledWith(
        `${EXPECTED_CONFIG_DIR}/installation-id`,
        installationId,
        { mode: 0o600 },
      );
    });
  });

  describe('getClaudeDir', () => {
    it('returns the correct Claude projects directory path', () => {
      expect(getClaudeDir()).toBe(EXPECTED_CLAUDE_DIR);
    });
  });

  describe('getSyncStatePath', () => {
    it('returns the correct sync state file path', () => {
      expect(getSyncStatePath()).toBe(EXPECTED_SYNC_STATE_FILE);
    });
  });

  // ────────────────────────────────────────────────────
  // loadConfig
  // ────────────────────────────────────────────────────

  describe('loadConfig', () => {
    it('returns null when config file does not exist', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      const result = loadConfig();

      expect(result).toBeNull();
    });

    it('returns parsed config when file exists and contains valid JSON', () => {
      const configData = {
        sync: { claudeDir: '/test/.claude/projects', excludeProjects: [] },
      };

      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(configData));

      const result = loadConfig();

      expect(result).toEqual(configData);
    });

    it('returns null for invalid JSON content', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue('this is not valid json {{{');

      const result = loadConfig();

      expect(result).toBeNull();
    });
  });

  // ────────────────────────────────────────────────────
  // saveConfig
  // ────────────────────────────────────────────────────

  describe('saveConfig', () => {
    it('writes only known config fields (strips unknown keys)', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true); // config dir already exists

      const config = {
        sync: { claudeDir: '/test/.claude/projects', excludeProjects: ['scratch'] },
        // telemetry and dashboard intentionally omitted
      };

      saveConfig(config);

      expect(fs.writeFileSync).toHaveBeenCalledOnce();
      const [writePath, writtenContent] = vi.mocked(fs.writeFileSync).mock.calls[0];

      expect(writePath).toBe(EXPECTED_CONFIG_FILE);

      const parsed = JSON.parse(writtenContent as string);
      expect(parsed.sync).toEqual(config.sync);
      // Fields not on ClaudeInsightConfig should not appear
      expect('unknownKey' in parsed).toBe(false);
    });

    it('includes optional dashboard field when present', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);

      const config = {
        sync: { claudeDir: '/test/.claude/projects', excludeProjects: [] },
        dashboard: { port: 7890 },
      };

      saveConfig(config);

      const [, writtenContent] = vi.mocked(fs.writeFileSync).mock.calls[0];
      const parsed = JSON.parse(writtenContent as string);
      expect(parsed.dashboard).toEqual({ port: 7890 });
    });

    it('preserves the automatic product update preference', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);

      saveConfig({
        sync: { excludeProjects: [] },
        dashboard: { updates: { autoUpdate: true } },
      });

      const [, writtenContent] = vi.mocked(fs.writeFileSync).mock.calls[0];
      expect(JSON.parse(writtenContent as string).dashboard.updates).toEqual({
        autoUpdate: true,
      });
    });

    it('includes optional telemetry field when present', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);

      const config = {
        sync: { claudeDir: '/test/.claude/projects', excludeProjects: [] },
        telemetry: false,
      };

      saveConfig(config);

      const [, writtenContent] = vi.mocked(fs.writeFileSync).mock.calls[0];
      const parsed = JSON.parse(writtenContent as string);
      expect(parsed.telemetry).toBe(false);
    });

    it('creates config directory when it does not exist', () => {
      // First call: existsSync for the dir check in ensureConfigDir -> false
      vi.mocked(fs.existsSync).mockReturnValue(false);

      const config = {
        sync: { claudeDir: '/test/.claude/projects', excludeProjects: [] },
      };

      saveConfig(config);

      expect(fs.mkdirSync).toHaveBeenCalledWith(
        EXPECTED_CONFIG_DIR,
        expect.objectContaining({ recursive: true }),
      );
      expect(fs.writeFileSync).toHaveBeenCalledOnce();
    });
  });

  // ────────────────────────────────────────────────────
  // loadSyncState
  // ────────────────────────────────────────────────────

  describe('loadSyncState', () => {
    it('returns default state when sync state file does not exist', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      const result = loadSyncState();

      expect(result).toEqual({ lastSync: '', files: {} });
    });

    it('returns parsed state when file exists and contains valid JSON', () => {
      const stateData = {
        lastSync: '2025-06-15T10:00:00Z',
        files: {
          '/path/to/session.jsonl': {
            lastModified: '2025-06-15T09:00:00Z',
            lastSyncedLine: 42,
            sessionId: 'session-001',
          },
        },
      };

      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(stateData));

      const result = loadSyncState();

      expect(result).toEqual(stateData);
    });

    it('returns default state when file contains invalid JSON', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue('not valid json');

      const result = loadSyncState();

      expect(result).toEqual({ lastSync: '', files: {} });
    });
  });

  // ────────────────────────────────────────────────────
  // saveSyncState
  // ────────────────────────────────────────────────────

  describe('saveSyncState', () => {
    it('writes sync state to the correct file path', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);

      const state = {
        lastSync: '2025-06-15T10:00:00Z',
        files: {
          '/path/session.jsonl': {
            lastModified: '2025-06-15T09:00:00Z',
            lastSyncedLine: 10,
            sessionId: 'sess-abc',
          },
        },
      };

      saveSyncState(state);

      expect(fs.writeFileSync).toHaveBeenCalledOnce();
      const [writePath, writtenContent] = vi.mocked(fs.writeFileSync).mock.calls[0];

      expect(writePath).toBe(EXPECTED_SYNC_STATE_FILE);
      expect(JSON.parse(writtenContent as string)).toEqual(state);
    });
  });

  // ────────────────────────────────────────────────────
  // isConfigured
  // ────────────────────────────────────────────────────

  describe('isConfigured', () => {
    it('returns false when config file does not exist', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      expect(isConfigured()).toBe(false);
    });

    it('returns true when config file exists', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);

      expect(isConfigured()).toBe(true);
    });
  });
});
