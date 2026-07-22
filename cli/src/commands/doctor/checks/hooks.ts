import * as fs from 'fs';
import * as path from 'path';
import {
  HOOKS_FILE,
  CLI_ENTRY,
  loadClaudeSettings,
  getHookCommand,
  hookAlreadyInstalled,
} from '../../../utils/hooks-utils.js';
import type { Check, CheckResult } from '../types.js';
import {
  codexConfigPath,
  codexHooksFeatureEnabled,
  inspectCodexHook,
} from '../../../utils/codex-hooks.js';

/** Extract the binary path from a hook command string like "node /path/to/index.js session-end ..." */
function extractBinaryPath(command: string): string | null {
  const match = command.match(/node\s+(\S+)/);
  return match ? match[1] : null;
}

export function hooksChecks(): Check[] {
  return [
    {
      id: 'hooks.codex_stop_installed',
      label: 'Codex Stop hook',
      run: async (): Promise<CheckResult> => {
        const state = inspectCodexHook();
        if (state.parseError) return {
          id: 'hooks.codex_stop_installed', label: 'Codex Stop hook', status: 'fail',
          detail: state.parseError, hint: `Repair ${state.file} before installing; Agent Analytics will not overwrite malformed JSON.`,
        };
        if (state.stale) return {
          id: 'hooks.codex_stop_installed', label: 'Codex Stop hook', status: 'warn',
          detail: 'Managed hook points to a different Agent Analytics entry',
          hint: 'Run: agent-analytics install-hook --source codex',
        };
        if (!state.installed) return {
          id: 'hooks.codex_stop_installed', label: 'Codex Stop hook', status: 'warn',
          detail: 'Not installed', hint: 'Run: agent-analytics install-hook --source codex',
        };
        return {
          id: 'hooks.codex_stop_installed', label: 'Codex Stop hook', status: 'pass',
          detail: state.file, hint: 'Open /hooks in Codex to review and trust the exact command if it is pending review.',
        };
      },
    },
    {
      id: 'hooks.codex_feature_enabled',
      label: 'Codex hooks feature',
      run: async (): Promise<CheckResult> => {
        const configFile = codexConfigPath();
        const disabled = fs.existsSync(configFile)
          && !codexHooksFeatureEnabled(fs.readFileSync(configFile, 'utf8'));
        return disabled ? {
          id: 'hooks.codex_feature_enabled', label: 'Codex hooks feature', status: 'warn',
          detail: 'Disabled in ~/.codex/config.toml', hint: 'Set [features].hooks = true, then review the hook with /hooks.',
        } : {
          id: 'hooks.codex_feature_enabled', label: 'Codex hooks feature', status: 'pass',
          detail: 'Enabled by default or explicitly enabled',
        };
      },
    },
    {
      id: 'hooks.settings_exists',
      label: 'Claude settings',
      gate: true,
      run: async (): Promise<CheckResult> => {
        if (fs.existsSync(HOOKS_FILE)) {
          return { id: 'hooks.settings_exists', label: 'Claude settings', status: 'pass', detail: HOOKS_FILE };
        }
        return {
          id: 'hooks.settings_exists',
          label: 'Claude settings',
          status: 'warn',
          detail: `${HOOKS_FILE} not found`,
        };
      },
    },
    {
      id: 'hooks.session_end_installed',
      label: 'SessionEnd hook',
      run: async (): Promise<CheckResult> => {
        const settings = loadClaudeSettings();
        if (!settings?.hooks?.SessionEnd) {
          return {
            id: 'hooks.session_end_installed',
            label: 'SessionEnd hook',
            status: 'warn',
            detail: 'Not installed',
            hint: 'Run: agent-analytics install-hook',
          };
        }
        if (hookAlreadyInstalled(settings.hooks.SessionEnd)) {
          return { id: 'hooks.session_end_installed', label: 'SessionEnd hook', status: 'pass' };
        }
        return {
          id: 'hooks.session_end_installed',
          label: 'SessionEnd hook',
          status: 'warn',
          detail: 'SessionEnd hooks exist but none reference agent-analytics',
          hint: 'Run: agent-analytics install-hook',
        };
      },
    },
    {
      id: 'hooks.binary_exists',
      label: 'Hook binary path',
      run: async (): Promise<CheckResult> => {
        const settings = loadClaudeSettings();
        if (!settings?.hooks?.SessionEnd) {
          return { id: 'hooks.binary_exists', label: 'Hook binary path', status: 'skip', detail: 'No SessionEnd hook' };
        }

        for (const hookConfig of settings.hooks.SessionEnd) {
          for (const hook of hookConfig.hooks) {
            const cmd = getHookCommand(hook);
            if (!cmd.includes('agent-analytics')) continue;
            const binPath = extractBinaryPath(cmd);
            if (!binPath) continue;
            if (fs.existsSync(binPath)) {
              return { id: 'hooks.binary_exists', label: 'Hook binary path', status: 'pass', detail: binPath };
            }
            return {
              id: 'hooks.binary_exists',
              label: 'Hook binary path',
              status: 'fail',
              detail: `Hook points to a path that no longer exists: ${binPath}`,
              hint: 'Run: agent-analytics install-hook\n           (rewrites hook to use current binary path)',
              fix: async () => {
                const { installHookCommand } = await import('../../install-hook.js');
                await installHookCommand();
              },
              fixLabel: 'Reinstall hook',
            };
          }
        }

        return { id: 'hooks.binary_exists', label: 'Hook binary path', status: 'skip', detail: 'No agent-analytics hook found' };
      },
    },
    {
      id: 'hooks.binary_current',
      label: 'Hook binary current',
      run: async (): Promise<CheckResult> => {
        const settings = loadClaudeSettings();
        if (!settings?.hooks?.SessionEnd) {
          return { id: 'hooks.binary_current', label: 'Hook binary current', status: 'skip', detail: 'No SessionEnd hook' };
        }

        for (const hookConfig of settings.hooks.SessionEnd) {
          for (const hook of hookConfig.hooks) {
            const cmd = getHookCommand(hook);
            if (!cmd.includes('agent-analytics')) continue;
            const binPath = extractBinaryPath(cmd);
            if (!binPath) continue;
            const resolvedHook = path.resolve(binPath);
            const resolvedCurrent = path.resolve(CLI_ENTRY);
            if (resolvedHook === resolvedCurrent) {
              return { id: 'hooks.binary_current', label: 'Hook binary current', status: 'pass' };
            }
            return {
              id: 'hooks.binary_current',
              label: 'Hook binary current',
              status: 'fail',
              detail: `Hook: ${resolvedHook}\n                     Current: ${resolvedCurrent}`,
              hint: 'Run: agent-analytics install-hook\n           (rewrites hook to use current binary path)',
              fix: async () => {
                const { installHookCommand } = await import('../../install-hook.js');
                await installHookCommand();
              },
              fixLabel: 'Reinstall hook with current path',
            };
          }
        }

        return { id: 'hooks.binary_current', label: 'Hook binary current', status: 'skip' };
      },
    },
    {
      id: 'hooks.no_legacy_stop',
      label: 'No legacy Stop hook',
      run: async (): Promise<CheckResult> => {
        const settings = loadClaudeSettings();
        if (!settings?.hooks?.Stop) {
          return { id: 'hooks.no_legacy_stop', label: 'No legacy Stop hook', status: 'pass' };
        }
        const hasLegacy = settings.hooks.Stop.some(
          (h) => h.hooks.some((hook) => getHookCommand(hook).includes('agent-analytics'))
        );
        if (!hasLegacy) {
          return { id: 'hooks.no_legacy_stop', label: 'No legacy Stop hook', status: 'pass' };
        }
        return {
          id: 'hooks.no_legacy_stop',
          label: 'No legacy Stop hook',
          status: 'warn',
          detail: 'Legacy v4.8.x Stop hook found — it will be removed on next install-hook',
          hint: 'Run: agent-analytics install-hook (cleans up legacy hooks)',
        };
      },
    },
    {
      id: 'hooks.project_override',
      label: 'No project hook override',
      run: async (): Promise<CheckResult> => {
        const localSettings = path.join(process.cwd(), '.claude', 'settings.json');
        if (!fs.existsSync(localSettings)) {
          return { id: 'hooks.project_override', label: 'No project hook override', status: 'pass' };
        }
        try {
          const content = fs.readFileSync(localSettings, 'utf-8');
          const settings = JSON.parse(content);
          if (settings.hooks) {
            return {
              id: 'hooks.project_override',
              label: 'No project hook override',
              status: 'warn',
              detail: `${localSettings} has a hooks key — may shadow user-level hook`,
            };
          }
          return { id: 'hooks.project_override', label: 'No project hook override', status: 'pass' };
        } catch {
          return { id: 'hooks.project_override', label: 'No project hook override', status: 'pass' };
        }
      },
    },
  ];
}
