import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const packagePath = join(root, 'cli/package.json');
const workflowPath = join(root, '.github/workflows/publish.yml');
const pkg = JSON.parse(readFileSync(packagePath, 'utf8'));
const workflow = readFileSync(workflowPath, 'utf8');
const failures = [];

function requireValue(condition, message) {
  if (!condition) failures.push(message);
}

requireValue(pkg.name === 'agent-usage-analyze',
  'cli/package.json name must be agent-usage-analyze');
requireValue(pkg.bin?.['agent-usage-analyze'] === 'dist/index.js',
  'cli/package.json must expose the agent-usage-analyze binary');
requireValue(pkg.repository?.url === 'git+https://github.com/zm2529/agent-usage-analyze.git',
  'cli/package.json repository.url must match zm2529/agent-usage-analyze exactly');
requireValue(pkg.publishConfig?.access === 'public',
  'cli/package.json publishConfig.access must be public');
requireValue(pkg.publishConfig?.registry === 'https://registry.npmjs.org/',
  'cli/package.json publishConfig.registry must be the public npm registry');

requireValue(/^\s*id-token:\s*write\s*$/m.test(workflow),
  'publish.yml must grant id-token: write for npm OIDC');
requireValue(/^\s*contents:\s*read\s*$/m.test(workflow),
  'publish.yml must limit repository contents permission to read');
requireValue(/^\s*runs-on:\s*ubuntu-latest\s*$/m.test(workflow),
  'publish.yml must use a GitHub-hosted runner');
requireValue(/node-version:\s*['"]24['"]/.test(workflow),
  'publish.yml must use Node 24 or newer for npm Trusted Publishing');
requireValue(/npm install --global npm@11\.11\.0/.test(workflow),
  'publish.yml must install an OIDC-capable npm CLI');
requireValue(/working-directory:\s*cli[\s\S]*?npm publish --access public/.test(workflow),
  'publish.yml must publish from the public CLI package directory');
requireValue(!/(?:NODE_AUTH_TOKEN|NPM_TOKEN|_authToken)/.test(workflow),
  'publish.yml must not use a long-lived npm publish token');

if (failures.length > 0) {
  process.stderr.write(`${failures.join('\n')}\n`);
  process.exit(1);
}

process.stdout.write(
  'publish-config: package=agent-usage-analyze workflow=publish.yml auth=oidc access=public pass\n',
);
