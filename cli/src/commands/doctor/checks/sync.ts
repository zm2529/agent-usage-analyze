import * as fs from 'fs';
import { loadSyncState, getSyncStatePath } from '../../../utils/config.js';
import type { Check, CheckResult } from '../types.js';

export function syncChecks(): Check[] {
  return [
    {
      id: 'sync.has_synced',
      label: 'Sync history',
      run: async (): Promise<CheckResult> => {
        const state = loadSyncState();
        if (state.lastSync) {
          return {
            id: 'sync.has_synced',
            label: 'Sync history',
            status: 'pass',
            detail: `Last sync: ${new Date(state.lastSync).toLocaleString()}`,
          };
        }
        return {
          id: 'sync.has_synced',
          label: 'Sync history',
          status: 'warn',
          detail: 'Never synced',
          hint: 'Run: agent-usage-analyze sync',
        };
      },
    },
    {
      id: 'sync.state_parseable',
      label: 'Sync state file',
      run: async (): Promise<CheckResult> => {
        const syncPath = getSyncStatePath();
        if (!fs.existsSync(syncPath)) {
          return { id: 'sync.state_parseable', label: 'Sync state file', status: 'skip', detail: 'No sync state file yet' };
        }
        try {
          const content = fs.readFileSync(syncPath, 'utf-8');
          JSON.parse(content);
          return { id: 'sync.state_parseable', label: 'Sync state file', status: 'pass' };
        } catch {
          return {
            id: 'sync.state_parseable',
            label: 'Sync state file',
            status: 'fail',
            detail: 'sync-state.json is corrupt',
            hint: 'Run: agent-usage-analyze sync --force',
          };
        }
      },
    },
    {
      id: 'sync.state_size',
      label: 'Sync state size',
      run: async (): Promise<CheckResult> => {
        const syncPath = getSyncStatePath();
        if (!fs.existsSync(syncPath)) {
          return { id: 'sync.state_size', label: 'Sync state size', status: 'skip' };
        }
        const stats = fs.statSync(syncPath);
        const sizeMB = stats.size / (1024 * 1024);
        if (sizeMB < 1) {
          const state = loadSyncState();
          const entries = Object.keys(state.files).length;
          return {
            id: 'sync.state_size',
            label: 'Sync state size',
            status: 'pass',
            detail: `${entries} entries, ${sizeMB.toFixed(2)} MB`,
          };
        }
        return {
          id: 'sync.state_size',
          label: 'Sync state size',
          status: 'warn',
          detail: `${sizeMB.toFixed(1)} MB — sync state is large`,
          hint: 'Run: agent-usage-analyze sync --force (rebuilds sync state)',
        };
      },
    },
  ];
}
