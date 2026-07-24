import { cpSync, existsSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const releaseTrees = [
  ['dashboard/dist', 'cli/dashboard-dist'],
  ['server/dist', 'cli/server-dist'],
];

for (const [sourceName, destinationName] of releaseTrees) {
  const source = join(root, sourceName);
  const destination = join(root, destinationName);
  if (!existsSync(source)) {
    throw new Error(`Missing built release input: ${sourceName}`);
  }
  rmSync(destination, { recursive: true, force: true });
  cpSync(source, destination, { recursive: true, verbatimSymlinks: true });
}

process.stdout.write('cli-package: runtime assets prepared\n');
