import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const pkg = JSON.parse(readFileSync(join(root, 'cli/package.json'), 'utf8'));
const actualTag = process.argv[2] ?? process.env.GITHUB_REF_NAME;
const expectedTag = `v${pkg.version}`;

if (!actualTag) {
  process.stderr.write(`release-tag: pass a tag; expected ${expectedTag}\n`);
  process.exit(1);
}
if (actualTag !== expectedTag) {
  process.stderr.write(`release-tag: ${actualTag} does not match package version ${pkg.version}; expected ${expectedTag}\n`);
  process.exit(1);
}

process.stdout.write(`release-tag: ${actualTag} matches ${pkg.name}@${pkg.version}\n`);
