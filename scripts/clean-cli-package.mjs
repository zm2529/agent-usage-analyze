import { rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
for (const path of ['cli/dashboard-dist', 'cli/server-dist']) {
  rmSync(join(root, path), { recursive: true, force: true });
}

process.stdout.write('cli-package: generated runtime assets removed\n');
