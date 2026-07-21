import * as net from 'net';
import type { Check, CheckResult } from '../types.js';

function checkPort(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => {
      server.close(() => resolve(true));
    });
    server.listen(port, '127.0.0.1');
  });
}

export function dashboardChecks(): Check[] {
  return [
    {
      id: 'dashboard.port',
      label: 'Dashboard port',
      run: async (): Promise<CheckResult> => {
        const port = 7890;
        const isFree = await checkPort(port);
        if (isFree) {
          return { id: 'dashboard.port', label: 'Dashboard port', status: 'pass', detail: `Port ${port} is free` };
        }
        return {
          id: 'dashboard.port',
          label: 'Dashboard port',
          status: 'warn',
          detail: `Port ${port} is in use (dashboard may already be running)`,
          hint: 'Run: lsof -ti :7890 to see what process is using it',
        };
      },
    },
    {
      id: 'dashboard.reachable',
      label: 'Dashboard server',
      run: async (): Promise<CheckResult> => {
        try {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 500);
          const res = await fetch('http://localhost:7890/api/health', { signal: controller.signal });
          clearTimeout(timeout);
          if (res.ok) {
            return { id: 'dashboard.reachable', label: 'Dashboard server', status: 'pass', detail: 'Responding at :7890' };
          }
          return {
            id: 'dashboard.reachable',
            label: 'Dashboard server',
            status: 'warn',
            detail: `Server returned ${res.status}`,
          };
        } catch {
          return {
            id: 'dashboard.reachable',
            label: 'Dashboard server',
            status: 'skip',
            detail: 'Not running (start with: agent-analytics dashboard)',
          };
        }
      },
    },
  ];
}
