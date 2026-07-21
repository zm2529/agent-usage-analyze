import * as fs from 'fs';
import * as path from 'path';
import { getConfigDir, loadConfig } from '../../../utils/config.js';
import type { Check } from '../types.js';

export function configChecks(): Check[] {
  const configPath = path.join(getConfigDir(), 'config.json');

  return [
    {
      id: 'config.exists',
      label: 'Config file',
      run: async () => {
        if (fs.existsSync(configPath)) {
          return { id: 'config.exists', label: 'Config file', status: 'pass', detail: configPath };
        }
        return {
          id: 'config.exists',
          label: 'Config file',
          status: 'warn',
          detail: 'Not yet configured (using defaults)',
        };
      },
    },
    {
      id: 'config.parseable',
      label: 'Config parseable',
      run: async () => {
        if (!fs.existsSync(configPath)) {
          return { id: 'config.parseable', label: 'Config parseable', status: 'skip', detail: 'No config file' };
        }
        const config = loadConfig();
        if (config) {
          return { id: 'config.parseable', label: 'Config parseable', status: 'pass' };
        }
        return {
          id: 'config.parseable',
          label: 'Config parseable',
          status: 'fail',
          detail: 'config.json exists but could not be parsed as JSON',
        };
      },
    },
  ];
}
