import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { fileURLToPath } from 'node:url';
import { isAbsolute, join, relative } from 'node:path';
import { ensureConfigDir, getConfigDir } from '../utils/config.js';

const DEFAULT_VENDOR_ROOT = fileURLToPath(new URL('../../vendor/git-ai', import.meta.url));
const DEFAULT_MANIFEST_PATH = fileURLToPath(new URL('../../vendor/git-ai-manifest.json', import.meta.url));
const MAX_MANIFEST_FILES = 10_000;
const SOURCE_COMMIT = 'da79071f21f3b018aa7d4ee4e7d5fa8bf3555a88';
const SOURCE_TREE = 'bdc44638c44dc0f7220f1d77f8d9c7da95da5944';
const FILE_MANIFEST_SHA256 = '7e97ddfb9be190641c722ca80504807fbc614ae69e19c68f8fb1e9fab33fdb08';
const MANIFEST_KEYS = [
  'schemaVersion', 'name', 'sourceRepository', 'sourceCommit', 'sourceTree', 'sourceVersion',
  'license', 'notesSchema', 'fileManifest', 'fileManifestSha256', 'patchStack',
];

interface GitAiVendorManifest {
  schemaVersion: 'agent-analytics.managed-sidecar-source.v1';
  name: 'git-ai';
  sourceRepository: 'git-ai-project/git-ai';
  sourceCommit: string;
  sourceTree: string;
  sourceVersion: string;
  license: 'Apache-2.0';
  notesSchema: 'authorship/3.0.0';
  fileManifest: 'git-ai-files.sha256';
  fileManifestSha256: string;
  patchStack: string[];
}

export interface GitAiVendorVerification {
  verified: boolean;
  name: 'git-ai';
  sourceCommit: string;
  sourceTree: string;
  sourceVersion: string;
  license: 'Apache-2.0';
  notesSchema: 'authorship/3.0.0';
  patchCount: number;
  checkedFiles: number;
  vendorRoot: string;
}

export interface GitAiSidecarConfig {
  schemaVersion: 'agent-analytics.git-ai-sidecar-config.v1';
  binaryPath: string;
  binarySha256: string;
  enabled: boolean;
  notesExportPolicy: 'local-only' | 'manual-external';
  automaticRepositoryMutation: false;
  telemetry: 'off';
  promptStorage: 'local';
  automaticUpdates: false;
}

export type GitAiSidecarConfigRead =
  | { status: 'ready'; config: GitAiSidecarConfig }
  | { status: 'missing' | 'corrupt' | 'unavailable'; config: null };

export interface GitAiSidecarInspection {
  sourceVerified: true;
  configured: boolean;
  enabled: boolean;
  healthy: boolean;
  healthError: 'not-configured' | 'corrupt-config' | 'config-unavailable'
    | 'binary-unavailable' | 'binary-changed' | 'version-mismatch' | 'policy-json-unavailable' | null;
  binaryVersion: string | null;
  binarySha256Matches: boolean;
  versionMatches: boolean;
  policyJsonVerified: boolean;
  statusJsonAvailable: boolean;
  notesExportPolicy: GitAiSidecarConfig['notesExportPolicy'];
  automaticRepositoryMutation: false;
}

export interface SidecarExecutionOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}

export type SidecarExecutor = (
  file: string,
  args: string[],
  options: SidecarExecutionOptions,
) => { stdout: string; stderr?: string; exitCode: number };

const defaultExecutor: SidecarExecutor = (file, args, options) => {
  const result = spawnSync(file, args, {
    cwd: options.cwd,
    env: options.env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 10 * 60 * 1_000,
  });
  return { stdout: result.stdout ?? '', stderr: result.stderr ?? '', exitCode: result.status ?? 1 };
};

function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function readManifest(path: string): GitAiVendorManifest {
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as Partial<GitAiVendorManifest>;
  if (Object.keys(parsed).length !== MANIFEST_KEYS.length
      || Object.keys(parsed).some((key) => !MANIFEST_KEYS.includes(key))
      || MANIFEST_KEYS.some((key) => !(key in parsed))
      || parsed.schemaVersion !== 'agent-analytics.managed-sidecar-source.v1'
      || parsed.name !== 'git-ai'
      || parsed.sourceRepository !== 'git-ai-project/git-ai'
      || parsed.sourceCommit !== SOURCE_COMMIT
      || parsed.sourceTree !== SOURCE_TREE
      || parsed.sourceVersion !== '1.6.16'
      || parsed.license !== 'Apache-2.0'
      || parsed.notesSchema !== 'authorship/3.0.0'
      || parsed.fileManifest !== 'git-ai-files.sha256'
      || parsed.fileManifestSha256 !== FILE_MANIFEST_SHA256
      || !Array.isArray(parsed.patchStack)
      || parsed.patchStack.length !== 0) {
    throw new Error('Invalid managed Git AI source manifest');
  }
  return parsed as GitAiVendorManifest;
}

interface FrozenFile {
  mode: '100644' | '100755' | '120000';
  bytes: Buffer;
}

interface FrozenTree {
  files: Map<string, FrozenFile>;
  directories: Map<string, FrozenTree>;
}

function readFrozenFile(path: string, expectedMode: FrozenFile['mode']): Buffer {
  const stats = lstatSync(path);
  const actualMode: FrozenFile['mode'] | null = stats.isSymbolicLink() ? '120000'
    : stats.isFile() ? ((stats.mode & 0o111) === 0 ? '100644' : '100755') : null;
  if (actualMode !== expectedMode) throw new Error('Managed Git AI source mode or type failed integrity validation');
  return expectedMode === '120000' ? Buffer.from(readlinkSync(path)) : readFileSync(path);
}

function gitObjectId(type: 'blob' | 'tree', bytes: Buffer): Buffer {
  return createHash('sha1').update(`${type} ${bytes.length}\0`).update(bytes).digest();
}

function frozenTreeId(tree: FrozenTree): Buffer {
  const entries = [
    ...[...tree.files].map(([name, file]) => ({
      name, sortName: name, mode: file.mode, oid: gitObjectId('blob', file.bytes),
    })),
    ...[...tree.directories].map(([name, directory]) => ({
      name, sortName: `${name}/`, mode: '40000', oid: frozenTreeId(directory),
    })),
  ].sort((a, b) => Buffer.compare(Buffer.from(a.sortName), Buffer.from(b.sortName)));
  const body = Buffer.concat(entries.map((entry) => Buffer.concat([
    Buffer.from(`${entry.mode} ${entry.name}\0`), entry.oid,
  ])));
  return gitObjectId('tree', body);
}

function computedSourceTree(files: Map<string, FrozenFile>): string {
  const root: FrozenTree = { files: new Map(), directories: new Map() };
  for (const [path, file] of files) {
    const parts = path.split('/');
    const name = parts.pop()!;
    let tree = root;
    for (const part of parts) {
      let child = tree.directories.get(part);
      if (!child) {
        child = { files: new Map(), directories: new Map() };
        tree.directories.set(part, child);
      }
      tree = child;
    }
    tree.files.set(name, file);
  }
  return frozenTreeId(root).toString('hex');
}

function listFiles(root: string, directory = root): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (directory === root && entry.name === 'target') continue;
    const absolute = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...listFiles(root, absolute));
    else files.push(relative(root, absolute));
  }
  return files;
}

export function verifyGitAiVendor(options: {
  vendorRoot?: string;
  manifestPath?: string;
} = {}): GitAiVendorVerification {
  const vendorRoot = options.vendorRoot ?? DEFAULT_VENDOR_ROOT;
  const manifestPath = options.manifestPath ?? DEFAULT_MANIFEST_PATH;
  const manifest = readManifest(manifestPath);
  const checksumPath = join(vendorRoot, '..', manifest.fileManifest);
  const checksumBytes = readFileSync(checksumPath);
  if (sha256(checksumBytes) !== manifest.fileManifestSha256) {
    throw new Error('Managed Git AI file manifest failed integrity validation');
  }
  const lines = checksumBytes.toString('utf8').trim().split('\n');
  if (lines.length === 0 || lines.length > MAX_MANIFEST_FILES) {
    throw new Error('Managed Git AI file manifest has invalid size');
  }
  const expectedFiles = new Set<string>();
  const frozenFiles = new Map<string, FrozenFile>();
  for (const line of lines) {
    const match = line.match(/^(100644|100755|120000) ([a-f0-9]{64})  (.+)$/);
    if (!match || match[3]!.startsWith('/') || match[3]!.split('/').includes('..')) {
      throw new Error('Managed Git AI file manifest has an invalid entry');
    }
    const [, mode, expectedHash, relativePath] = match as [string, FrozenFile['mode'], string, string];
    if (expectedFiles.has(relativePath!)) throw new Error('Managed Git AI file manifest has a duplicate entry');
    expectedFiles.add(relativePath!);
    const absolute = join(vendorRoot, relativePath!);
    let bytes: Buffer;
    try {
      bytes = readFrozenFile(absolute, mode);
    } catch {
      throw new Error(`Managed Git AI source integrity failed: ${relativePath}`);
    }
    if (sha256(bytes) !== expectedHash) {
      throw new Error(`Managed Git AI source integrity failed: ${relativePath}`);
    }
    frozenFiles.set(relativePath!, { mode, bytes });
  }
  const actualFiles = listFiles(vendorRoot).sort();
  if (actualFiles.length !== expectedFiles.size
      || actualFiles.some((path) => !expectedFiles.has(path))) {
    throw new Error('Managed Git AI source contains unmanifested files');
  }
  if (computedSourceTree(frozenFiles) !== SOURCE_TREE) {
    throw new Error('Managed Git AI source tree failed integrity validation');
  }
  return {
    verified: true,
    name: manifest.name,
    sourceCommit: manifest.sourceCommit,
    sourceTree: manifest.sourceTree,
    sourceVersion: manifest.sourceVersion,
    license: manifest.license,
    notesSchema: manifest.notesSchema,
    patchCount: manifest.patchStack.length,
    checkedFiles: expectedFiles.size,
    vendorRoot,
  };
}

export function buildGitAiSidecar(options: {
  vendorRoot?: string;
  manifestPath?: string;
  executor?: SidecarExecutor;
  allowNetwork?: boolean;
} = {}): {
  verifiedSource: true;
  offline: boolean;
  profile: 'release';
  binaryPath: string;
} {
  const verification = verifyGitAiVendor(options);
  const executor = options.executor ?? defaultExecutor;
  const offline = options.allowNetwork !== true;
  const args = offline
    ? ['build', '--locked', '--offline', '--release']
    : ['build', '--locked', '--release'];
  const env = { ...process.env };
  if (offline) env.CARGO_NET_OFFLINE = 'true';
  else delete env.CARGO_NET_OFFLINE;
  const result = executor('cargo', args, {
    cwd: verification.vendorRoot,
    env,
  });
  if (result.exitCode !== 0) {
    throw new Error(offline
      ? 'Managed Git AI offline build failed; the locked Cargo dependencies may not be cached'
      : 'Managed Git AI locked build failed');
  }
  return {
    verifiedSource: true,
    offline,
    profile: 'release',
    binaryPath: join(verification.vendorRoot, 'target', 'release', 'git-ai'),
  };
}

function configPath(): string {
  return join(getConfigDir(), 'git-ai-sidecar.json');
}

function runtimeHomePath(): string {
  return join(getConfigDir(), 'git-ai-runtime-home');
}

function sidecarEnvironment(): NodeJS.ProcessEnv {
  const home = runtimeHomePath();
  const gitAiDirectory = join(home, '.git-ai');
  mkdirSync(gitAiDirectory, { recursive: true, mode: 0o700 });
  chmodSync(home, 0o700);
  chmodSync(gitAiDirectory, 0o700);
  const upstreamConfig = join(gitAiDirectory, 'config.json');
  writeFileSync(upstreamConfig, JSON.stringify({
    telemetry_oss: 'off',
    prompt_storage: 'local',
    default_prompt_storage: 'local',
    disable_version_checks: true,
    disable_auto_updates: true,
    feature_flags: {
      daemon_log_upload: false,
      transcript_streaming: false,
      transcript_sweep: false,
    },
  }, null, 2), { mode: 0o600 });
  chmodSync(upstreamConfig, 0o600);
  return {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    GIT_AI_API_KEY: '',
  };
}

function binaryIdentity(path: string): string | null {
  try {
    const stats = lstatSync(path);
    if (!stats.isFile() || (stats.mode & 0o111) === 0) return null;
    return sha256(readFileSync(path));
  } catch {
    return null;
  }
}

function versionFrom(result: { stdout: string; exitCode: number }): string | null {
  if (result.exitCode !== 0) return null;
  return result.stdout.match(/(?:git-ai\s+)?(\d+\.\d+\.\d+)/)?.[1] ?? null;
}

export function configureGitAiSidecar(input: {
  binaryPath: string;
  enabled: boolean;
  notesExportPolicy: GitAiSidecarConfig['notesExportPolicy'];
  executor?: SidecarExecutor;
}): GitAiSidecarConfig {
  if (!isAbsolute(input.binaryPath) || !['local-only', 'manual-external'].includes(input.notesExportPolicy)) {
    throw new Error('Invalid managed Git AI configuration');
  }
  verifyGitAiVendor();
  const binarySha256 = binaryIdentity(input.binaryPath);
  if (!binarySha256) throw new Error('Managed Git AI binary is missing or not executable');
  const executor = input.executor ?? defaultExecutor;
  const binaryVersion = versionFrom(executor(input.binaryPath, ['--version'], { env: sidecarEnvironment() }));
  if (binaryVersion !== '1.6.16') throw new Error('Managed Git AI binary version does not match frozen source');
  const config: GitAiSidecarConfig = {
    schemaVersion: 'agent-analytics.git-ai-sidecar-config.v1',
    binaryPath: input.binaryPath,
    binarySha256,
    enabled: input.enabled,
    notesExportPolicy: input.notesExportPolicy,
    automaticRepositoryMutation: false,
    telemetry: 'off',
    promptStorage: 'local',
    automaticUpdates: false,
  };
  ensureConfigDir();
  writeFileSync(configPath(), JSON.stringify(config, null, 2), { mode: 0o600 });
  chmodSync(configPath(), 0o600);
  return config;
}

export function readGitAiSidecarConfig(): GitAiSidecarConfigRead {
  let raw: string;
  try {
    raw = readFileSync(configPath(), 'utf8');
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ENOENT'
      ? { status: 'missing', config: null } : { status: 'unavailable', config: null };
  }
  try {
    const parsed = JSON.parse(raw) as Partial<GitAiSidecarConfig>;
    const expectedKeys = [
      'schemaVersion', 'binaryPath', 'binarySha256', 'enabled', 'notesExportPolicy',
      'automaticRepositoryMutation', 'telemetry', 'promptStorage', 'automaticUpdates',
    ];
    if (Object.keys(parsed).length !== expectedKeys.length
        || Object.keys(parsed).some((key) => !expectedKeys.includes(key))
        || expectedKeys.some((key) => !(key in parsed))
        || parsed.schemaVersion !== 'agent-analytics.git-ai-sidecar-config.v1'
        || typeof parsed.binaryPath !== 'string' || !isAbsolute(parsed.binaryPath)
        || typeof parsed.binarySha256 !== 'string' || !/^[a-f0-9]{64}$/.test(parsed.binarySha256)
        || typeof parsed.enabled !== 'boolean'
        || !['local-only', 'manual-external'].includes(String(parsed.notesExportPolicy))
        || parsed.automaticRepositoryMutation !== false
        || parsed.telemetry !== 'off' || parsed.promptStorage !== 'local'
        || parsed.automaticUpdates !== false) return { status: 'corrupt', config: null };
    return { status: 'ready', config: parsed as GitAiSidecarConfig };
  } catch {
    return { status: 'corrupt', config: null };
  }
}

export function loadGitAiSidecarConfig(): GitAiSidecarConfig | null {
  const result = readGitAiSidecarConfig();
  return result.status === 'ready' ? result.config : null;
}

export function inspectGitAiSidecar(options: {
  executor?: SidecarExecutor;
  repositoryPath?: string;
} = {}): GitAiSidecarInspection {
  verifyGitAiVendor();
  const configRead = readGitAiSidecarConfig();
  if (configRead.status !== 'ready') {
    return {
      sourceVerified: true, configured: false, enabled: false, binaryVersion: null,
      healthy: false,
      healthError: configRead.status === 'missing' ? 'not-configured'
        : configRead.status === 'corrupt' ? 'corrupt-config' : 'config-unavailable',
      binarySha256Matches: false, versionMatches: false, statusJsonAvailable: false,
      policyJsonVerified: false,
      notesExportPolicy: 'local-only',
      automaticRepositoryMutation: false,
    };
  }
  const config = configRead.config;
  const executor = options.executor ?? defaultExecutor;
  const currentBinarySha256 = binaryIdentity(config.binaryPath);
  const binarySha256Matches = currentBinarySha256 === config.binarySha256;
  const env = sidecarEnvironment();
  const binaryVersion = binarySha256Matches
    ? versionFrom(executor(config.binaryPath, ['--version'], { env })) : null;
  const versionMatches = binaryVersion === '1.6.16';
  let policyJsonVerified = false;
  if (versionMatches) {
    const policy = executor(config.binaryPath, ['config'], { env });
    try {
      const parsed = JSON.parse(policy.stdout) as Record<string, unknown>;
      const flags = parsed.feature_flags as Record<string, unknown> | undefined;
      policyJsonVerified = policy.exitCode === 0
        && parsed.telemetry_oss_disabled === true
        && parsed.prompt_storage === 'local'
        && parsed.default_prompt_storage === 'local'
        && parsed.disable_version_checks === true
        && parsed.disable_auto_updates === true
        && flags?.daemon_log_upload === false
        && flags.transcript_streaming === false
        && flags.transcript_sweep === false;
    } catch {
      policyJsonVerified = false;
    }
  }
  let statusJsonAvailable = false;
  if (options.repositoryPath && versionMatches) {
    const status = executor(config.binaryPath, ['status', '--json'], { cwd: options.repositoryPath, env });
    try {
      const parsed = JSON.parse(status.stdout) as unknown;
      statusJsonAvailable = status.exitCode === 0 && parsed !== null
        && typeof parsed === 'object' && !Array.isArray(parsed);
    } catch {
      statusJsonAvailable = false;
    }
  }
  const healthy = binarySha256Matches && versionMatches && policyJsonVerified;
  const healthError = healthy ? null
    : currentBinarySha256 === null ? 'binary-unavailable'
      : !binarySha256Matches ? 'binary-changed'
        : !versionMatches ? 'version-mismatch' : 'policy-json-unavailable';
  return {
    sourceVerified: true,
    configured: true,
    enabled: config.enabled,
    healthy,
    healthError,
    binaryVersion,
    binarySha256Matches,
    versionMatches,
    policyJsonVerified,
    statusJsonAvailable,
    notesExportPolicy: config.notesExportPolicy,
    automaticRepositoryMutation: false,
  };
}
