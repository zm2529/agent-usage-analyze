import * as fs from 'fs';
import { getConfigDir } from '../../../utils/config.js';
import type { Check } from '../types.js';

export function environmentChecks(): Check[] {
  return [
    {
      id: 'env.config_dir_exists',
      label: 'Config directory',
      gate: true,
      run: async () => {
        const dir = getConfigDir();
        if (fs.existsSync(dir)) {
          return { id: 'env.config_dir_exists', label: 'Config directory', status: 'pass', detail: dir };
        }
        return {
          id: 'env.config_dir_exists',
          label: 'Config directory',
          status: 'fail',
          detail: `${dir} does not exist`,
          hint: 'Run: agent-analytics init',
        };
      },
    },
    {
      id: 'env.config_dir_writable',
      label: 'Config directory writable',
      run: async () => {
        const dir = getConfigDir();
        try {
          fs.accessSync(dir, fs.constants.W_OK);
          return { id: 'env.config_dir_writable', label: 'Config directory writable', status: 'pass' };
        } catch {
          return {
            id: 'env.config_dir_writable',
            label: 'Config directory writable',
            status: 'fail',
            detail: `${dir} is not writable`,
            hint: `Run: chmod u+w ${dir}`,
          };
        }
      },
    },
    {
      id: 'env.node_version',
      label: 'Node.js version',
      run: async () => {
        const major = parseInt(process.versions.node.split('.')[0], 10);
        if (major >= 18) {
          return { id: 'env.node_version', label: 'Node.js version', status: 'pass', detail: `v${process.versions.node}` };
        }
        return {
          id: 'env.node_version',
          label: 'Node.js version',
          status: 'fail',
          detail: `v${process.versions.node} (requires >= 18)`,
          hint: 'Install Node.js 18 or later from https://nodejs.org',
        };
      },
    },
  ];
}
