import { getAllProviders } from '../../../providers/registry.js';
import { loadSyncState } from '../../../utils/config.js';
import type { Check, CheckResult } from '../types.js';

export function providerChecks(): Check[] {
  const providers = getAllProviders();
  const checks: Check[] = [];

  for (const provider of providers) {
    const name = provider.getProviderName();

    checks.push({
      id: `provider.${name}.discover`,
      label: `${name} sessions`,
      run: async (): Promise<CheckResult> => {
        try {
          const files = await provider.discover();
          if (files.length === 0) {
            return {
              id: `provider.${name}.discover`,
              label: `${name} sessions`,
              status: 'skip',
              detail: 'Not installed or no sessions found',
            };
          }
          return {
            id: `provider.${name}.discover`,
            label: `${name} sessions`,
            status: 'pass',
            detail: `${files.length} session(s) found`,
          };
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          // Cursor-specific: detect SQLite lock
          if (name === 'cursor' && (msg.includes('SQLITE_BUSY') || msg.includes('database is locked'))) {
            return {
              id: `provider.${name}.discover`,
              label: `${name} sessions`,
              status: 'fail',
              detail: 'Cursor database is locked',
              hint: 'Close Cursor before syncing',
            };
          }
          return {
            id: `provider.${name}.discover`,
            label: `${name} sessions`,
            status: 'fail',
            detail: msg,
          };
        }
      },
    });
  }

  // Sync drift check — discovered files minus tracked files
  checks.push({
    id: 'provider.sync_drift',
    label: 'Sync drift',
    run: async (): Promise<CheckResult> => {
      try {
        let totalDiscovered = 0;
        for (const provider of providers) {
          try {
            const files = await provider.discover();
            totalDiscovered += files.length;
          } catch {
            // Provider not available
          }
        }
        const syncState = loadSyncState();
        const tracked = Object.keys(syncState.files).length;
        const delta = totalDiscovered - tracked;

        if (delta <= 5) {
          return { id: 'provider.sync_drift', label: 'Sync drift', status: 'pass', detail: `${delta} untracked file(s)` };
        }
        return {
          id: 'provider.sync_drift',
          label: 'Sync drift',
          status: 'warn',
          detail: `${delta} session(s) on disk not yet synced`,
          hint: 'Run: agent-analytics sync',
          fix: async () => {
            const { syncCommand } = await import('../../sync.js');
            await syncCommand({ quiet: true });
          },
          fixLabel: 'Run sync',
        };
      } catch {
        return { id: 'provider.sync_drift', label: 'Sync drift', status: 'skip' };
      }
    },
  });

  return checks;
}
