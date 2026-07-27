import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const failures = [];
const required = ['LICENSE', 'UPSTREAM.md', 'cli/LICENSE', 'cli/vendor/git-ai/LICENSE',
  'cli/vendor/git-ai-manifest.json', 'cli/vendor/git-ai-files.sha256'];
for (const path of required) {
  if (!existsSync(join(root, path))) failures.push(`missing legal/provenance artifact: ${path}`);
}
if (!readFileSync(join(root, 'LICENSE'), 'utf8').includes('MIT License')) failures.push('root license is not MIT');
if (!readFileSync(join(root, 'cli/vendor/git-ai/LICENSE'), 'utf8').includes('Apache License')) {
  failures.push('managed Git AI license is not Apache-2.0');
}
const upstream = readFileSync(join(root, 'UPSTREAM.md'), 'utf8');
for (const marker of ['4177d3c496a4a517ff72aa2f4a813dd69865371c', 'da79071f21f3b018aa7d4ee4e7d5fa8bf3555a88']) {
  if (!upstream.includes(marker)) failures.push(`missing frozen upstream provenance: ${marker}`);
}

const sourceFiles = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], {
  cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024,
}).trim().split('\n').filter(Boolean);
for (const path of sourceFiles) {
  if (path === 'work' || path.startsWith('work/') || path === '.scratch' || path.startsWith('.scratch/')) {
    failures.push(`candidate workspace is included in release inputs: ${path}`);
  }
}

const secretPatterns = [
  ['private-key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g],
  ['aws-access-key', /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g],
  ['github-token', /\bgh[pousr]_[A-Za-z0-9]{30,}\b/g],
  ['openai-key', /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/g],
  ['anthropic-key', /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g],
  ['google-api-key', /\bAIza[0-9A-Za-z_-]{35}\b/g],
  ['slack-token', /\bxox[baprs]-[0-9A-Za-z-]{20,}\b/g],
  ['credential-assignment', /\b(?:api[_-]?key|access[_-]?token|client[_-]?secret|password)\s*[:=]\s*["'][^"'\n]{16,}["']/gi],
  ['private-fixture-marker', new RegExp([
    ['TOP', 'SECRET', 'PROMPT'].join('_'), ['PRIVATE', 'CODE'].join('_'),
    ['PRIVATE', 'THINKING'].join('_'), ['Secret', 'Repo'].join(''),
    ['0khp', 'qq'].join(''), ['codex-agent', 'analytics-handoff'].join('-'),
  ].join('|'), 'gi')],
];

const exactFixtureHashes = new Map([
  ['source:cli/src/__tests__/release-audit.test.ts:aws-access-key', new Set([
    '743554670c6065b3f7f13ac4f07e392f977b3556ceb7457411633c454bcbece8',
  ])],
  ['source:cli/src/canonical/semantic-analysis.test.ts:private-key', new Set([
    '3021d90eb9437b2d8f30e8363695c4418b5e5f1870801b5c317e9398ee0f572d',
  ])],
  ['source:cli/src/canonical/semantic-analysis.test.ts:aws-access-key', new Set([
    '1a5d44a2dca19669d72edf4c4f1c27c4c1ca4b4408fbb17f6ce4ad452d78ddb3',
  ])],
  ['source:server/src/routes/config.test.ts:credential-assignment', new Set([
    '7e5ec697bb5f7eee02ca2b49f5a4e1ea2bc4c7bb110605d0fddf9225bc24f11c',
    'd07acd83879a7dc1f9dbc83c8e0d83c0fe6ffc3fae43c1855ce9a88edea58328',
  ])],
  ['source:server/src/routes/semantic-analysis.test.ts:credential-assignment', new Set([
    '37aafe9361fe66b1fd3c137511feba9d7ad93a1e4d4f11c80835bdf60a57e5b8',
  ])],
]);
const privateFixtureFiles = [
  'cli/src/canonical/sanitized-export.test.ts',
  'cli/src/db/product-migration.test.ts',
  'server/src/routes/export.test.ts',
];
const privateFixtureHashes = [
  'a88db3911b9c4c5450a7f7a03461e74de1d16f46101e818b236f8c196e9779e3',
  'b51b3b6c230e7fd61e1dec34bf8fc1881d232168ff7db4d8e3fffd41deaa795f',
  '416458f62fe14b308b504f1f0d53ed7e18d19b67a3652789a2cc499406b98581',
  '766b3854f1c31e73b8e82abd4baf6061fe5facbec946562f5cacb60ec4d9dd07',
];
for (const path of privateFixtureFiles) {
  exactFixtureHashes.set(`source:${path}:private-fixture-marker`, new Set(privateFixtureHashes));
}

function scanFile(path, displayPath, scope) {
  if (!existsSync(path)) return;
  const bytes = readFileSync(path);
  if (bytes.includes(0)) return;
  const content = bytes.toString('utf8');
  for (const [name, pattern] of secretPatterns) {
    pattern.lastIndex = 0;
    for (const match of content.matchAll(pattern)) {
      const digest = createHash('sha256').update(match[0]).digest('hex');
      if (!exactFixtureHashes.get(`${scope}:${displayPath}:${name}`)?.has(digest)) {
        failures.push(`possible ${name} in ${scope} input: ${displayPath}`);
      }
    }
  }
}

for (const path of sourceFiles) {
  if (path.startsWith('cli/vendor/') || path.startsWith('work/') || path.startsWith('.scratch/')) continue;
  scanFile(join(root, path), path, 'source');
}

function copyContents(source, destination) {
  if (!existsSync(source)) return;
  mkdirSync(destination, { recursive: true });
  for (const name of readdirSync(source)) {
    cpSync(join(source, name), join(destination, name), {
      recursive: true, force: true, verbatimSymlinks: true,
    });
  }
}

function scanTree(rootPath, displayPrefix) {
  if (!existsSync(rootPath)) return;
  for (const name of readdirSync(rootPath, { withFileTypes: true })) {
    const path = join(rootPath, name.name);
    const displayPath = `${displayPrefix}/${name.name}`;
    if (name.isDirectory()) scanTree(path, displayPath);
    else if (name.isFile()) scanFile(path, displayPath, 'package');
  }
}

const stagingRoot = mkdtempSync(join(tmpdir(), 'agent-analytics-release-audit-'));
const staging = join(stagingRoot, 'package');
mkdirSync(staging, { recursive: true, mode: 0o700 });
try {
  for (const name of ['package.json', 'README.md', 'CHANGELOG.md', 'LICENSE']) {
    cpSync(join(root, 'cli', name), join(staging, name));
  }
  for (const [source, destination] of [
    [join(root, 'cli', 'dist'), join(staging, 'dist')],
    [join(root, 'cli', 'vendor'), join(staging, 'vendor')],
    [join(root, 'dashboard', 'dist'), join(staging, 'dashboard-dist')],
    [join(root, 'server', 'dist'), join(staging, 'server-dist')],
  ]) {
    if (!existsSync(source)) failures.push(`missing built release input: ${relative(root, source)}`);
    else cpSync(source, destination, { recursive: true, verbatimSymlinks: true });
  }
  copyContents(join(root, 'cli', 'dashboard-dist'), join(staging, 'dashboard-dist'));
  copyContents(join(root, 'cli', 'server-dist'), join(staging, 'server-dist'));
  if (process.env.AGENT_ANALYTICS_AUDIT_PACKAGE_OVERLAY_DIR) {
    copyContents(process.env.AGENT_ANALYTICS_AUDIT_PACKAGE_OVERLAY_DIR, join(staging, 'server-dist'));
  }

  for (const name of ['dist', 'dashboard-dist', 'server-dist']) {
    scanTree(join(staging, name), name);
  }

  let vendorVerified = false;
  try {
    const verifier = await import(pathToFileURL(join(root, 'cli', 'dist', 'sidecars', 'git-ai-manager.js')).href);
    const verification = verifier.verifyGitAiVendor({
      vendorRoot: join(staging, 'vendor', 'git-ai'),
      manifestPath: join(staging, 'vendor', 'git-ai-manifest.json'),
    });
    vendorVerified = verification.verified === true;
  } catch (error) {
    failures.push(`managed vendor integrity failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  let packageFiles = [];
  try {
    const packEntries = JSON.parse(execFileSync(
      'npm', ['pack', '--dry-run', '--json', '--ignore-scripts'],
      { cwd: staging, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
    ));
    const pack = packEntries[0];
    if (!pack?.files) {
      failures.push('npm pack did not return a package manifest');
    } else {
      packageFiles = pack.files.map((entry) => entry.path).sort();
    }
  } catch (error) {
    failures.push(`npm pack failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (packageFiles.length > 0) {
    for (const path of packageFiles) {
      if (path.startsWith('vendor/') && vendorVerified) continue;
      scanFile(join(staging, path), path, 'package');
    }
    if (!packageFiles.some((path) => path.startsWith('vendor/'))
        || !packageFiles.some((path) => path.startsWith('dist/'))
        || !packageFiles.some((path) => path.startsWith('dashboard-dist/'))
        || !packageFiles.some((path) => path.startsWith('server-dist/'))) {
      failures.push('npm pack manifest is missing a declared runtime release tree');
    }
  }
} finally {
  rmSync(stagingRoot, { recursive: true, force: true });
}

if (failures.length > 0) {
  process.stderr.write(`${[...new Set(failures)].join('\n')}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write('release-audit: legal=pass source-boundary=pass pack-manifest=pass vendor-integrity=pass secret-scan=pass\n');
}
