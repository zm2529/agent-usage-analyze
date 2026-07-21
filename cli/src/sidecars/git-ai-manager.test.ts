import { createHash } from 'node:crypto';
import {
  chmodSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildGitAiSidecar,
  configureGitAiSidecar,
  inspectGitAiSidecar,
  readGitAiSidecarConfig,
  verifyGitAiVendor,
  type SidecarExecutor,
} from './git-ai-manager.js';

const created: string[] = [];

afterEach(() => {
  delete process.env.AGENT_ANALYTICS_CONFIG_DIR;
  for (const path of created.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe('managed Git AI sidecar', () => {
  it('verifies the complete frozen source and builds it with Cargo offline', () => {
    const verification = verifyGitAiVendor();
    expect(verification).toMatchObject({
      verified: true,
      name: 'git-ai',
      sourceVersion: '1.6.16',
      sourceCommit: 'da79071f21f3b018aa7d4ee4e7d5fa8bf3555a88',
      sourceTree: 'bdc44638c44dc0f7220f1d77f8d9c7da95da5944',
      license: 'Apache-2.0',
      notesSchema: 'authorship/3.0.0',
      patchCount: 0,
      checkedFiles: 869,
    });

    const calls: Array<{ file: string; args: string[]; cwd?: string; env?: NodeJS.ProcessEnv }> = [];
    const executor: SidecarExecutor = (file, args, options) => {
      calls.push({ file, args, cwd: options.cwd, env: options.env });
      return { stdout: '', exitCode: 0 };
    };
    const built = buildGitAiSidecar({ executor });

    expect(built).toMatchObject({ verifiedSource: true, offline: true, profile: 'release' });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      file: 'cargo',
      args: ['build', '--locked', '--offline', '--release'],
    });
    expect(calls[0]!.env).toMatchObject({ CARGO_NET_OFFLINE: 'true' });
    expect(calls[0]!.cwd).toContain('/cli/vendor/git-ai');

    const fetched = buildGitAiSidecar({ executor, allowNetwork: true });
    expect(fetched).toMatchObject({ verifiedSource: true, offline: false, profile: 'release' });
    expect(calls[1]).toMatchObject({
      file: 'cargo',
      args: ['build', '--locked', '--release'],
    });
    expect(calls[1]!.env?.CARGO_NET_OFFLINE).toBeUndefined();
  });

  it('rejects symlink type and executable-mode drift even when file bytes are unchanged', () => {
    const verification = verifyGitAiVendor();
    const fixtureRoot = mkdtempSync(join(tmpdir(), 'agent-analytics-git-ai-vendor-'));
    created.push(fixtureRoot);
    const fixtureVendor = join(fixtureRoot, 'git-ai');
    const buildRoot = join(verification.vendorRoot, 'target');
    cpSync(verification.vendorRoot, fixtureVendor, {
      recursive: true,
      dereference: false,
      preserveTimestamps: true,
      verbatimSymlinks: true,
      filter: (source) => source !== buildRoot && !source.startsWith(`${buildRoot}/`),
    });
    cpSync(join(verification.vendorRoot, '..', 'git-ai-files.sha256'), join(fixtureRoot, 'git-ai-files.sha256'));
    cpSync(join(verification.vendorRoot, '..', 'git-ai-manifest.json'), join(fixtureRoot, 'git-ai-manifest.json'));
    const fixtureOptions = {
      vendorRoot: fixtureVendor,
      manifestPath: join(fixtureRoot, 'git-ai-manifest.json'),
    };

    const claudeLink = join(fixtureVendor, 'CLAUDE.md');
    const claudeTarget = readlinkSync(claudeLink);
    const sameBytes = readFileSync(claudeLink);
    unlinkSync(claudeLink);
    writeFileSync(claudeLink, sameBytes);
    expect(() => verifyGitAiVendor(fixtureOptions)).toThrow(/integrity|manifest/i);

    unlinkSync(claudeLink);
    symlinkSync(claudeTarget, claudeLink);
    chmodSync(join(fixtureVendor, 'install.sh'), 0o644);
    expect(() => verifyGitAiVendor(fixtureOptions)).toThrow(/integrity|manifest/i);
  });

  it('rejects a modified source archive even when its checksum files are re-signed locally', () => {
    const verification = verifyGitAiVendor();
    const fixtureRoot = mkdtempSync(join(tmpdir(), 'agent-analytics-git-ai-resigned-'));
    created.push(fixtureRoot);
    const fixtureVendor = join(fixtureRoot, 'git-ai');
    const buildRoot = join(verification.vendorRoot, 'target');
    cpSync(verification.vendorRoot, fixtureVendor, {
      recursive: true,
      dereference: false,
      preserveTimestamps: true,
      verbatimSymlinks: true,
      filter: (source) => source !== buildRoot && !source.startsWith(`${buildRoot}/`),
    });
    const checksumPath = join(fixtureRoot, 'git-ai-files.sha256');
    const manifestPath = join(fixtureRoot, 'git-ai-manifest.json');
    cpSync(join(verification.vendorRoot, '..', 'git-ai-files.sha256'), checksumPath);
    cpSync(join(verification.vendorRoot, '..', 'git-ai-manifest.json'), manifestPath);
    const originalManifest = readFileSync(manifestPath, 'utf8');
    const patchedManifest = JSON.parse(originalManifest) as Record<string, unknown>;
    patchedManifest.patchStack = ['local.patch'];
    writeFileSync(manifestPath, JSON.stringify(patchedManifest, null, 2));
    expect(() => verifyGitAiVendor({ vendorRoot: fixtureVendor, manifestPath }))
      .toThrow(/manifest|integrity/i);
    writeFileSync(manifestPath, originalManifest);

    const readmePath = join(fixtureVendor, 'README.md');
    writeFileSync(readmePath, `${readFileSync(readmePath, 'utf8')}\nlocal change\n`);
    const changedHash = createHash('sha256').update(readFileSync(readmePath)).digest('hex');
    const changedChecksums = readFileSync(checksumPath, 'utf8').replace(
      /^100644 [a-f0-9]{64}  README\.md$/m,
      `100644 ${changedHash}  README.md`,
    );
    writeFileSync(checksumPath, changedChecksums);
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, unknown>;
    manifest.fileManifestSha256 = createHash('sha256').update(changedChecksums).digest('hex');
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

    expect(() => verifyGitAiVendor({ vendorRoot: fixtureVendor, manifestPath }))
      .toThrow(/manifest|tree|integrity/i);
  });

  it('stores explicit local policy and inspects JSON without installing hooks or pushing notes', () => {
    const configDir = mkdtempSync(join(tmpdir(), 'agent-analytics-git-ai-config-'));
    created.push(configDir);
    process.env.AGENT_ANALYTICS_CONFIG_DIR = configDir;
    const binaryPath = join(configDir, 'git-ai-frozen');
    writeFileSync(binaryPath, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    const configureCalls: Array<{ file: string; args: string[]; env?: NodeJS.ProcessEnv }> = [];
    const config = configureGitAiSidecar({
      binaryPath,
      enabled: false,
      notesExportPolicy: 'local-only',
      executor: (file, args, options) => {
        configureCalls.push({ file, args, env: options.env });
        return { stdout: 'git-ai 1.6.16\n', exitCode: 0 };
      },
    });

    expect(config).toMatchObject({
      schemaVersion: 'agent-analytics.git-ai-sidecar-config.v1',
      binaryPath,
      enabled: false,
      notesExportPolicy: 'local-only',
      automaticRepositoryMutation: false,
      telemetry: 'off',
      promptStorage: 'local',
      automaticUpdates: false,
    });
    expect(config.binarySha256).toMatch(/^[a-f0-9]{64}$/);
    expect(configureCalls).toHaveLength(1);
    expect(configureCalls[0]).toMatchObject({ file: binaryPath, args: ['--version'] });
    const isolatedHome = join(configDir, 'git-ai-runtime-home');
    expect(configureCalls[0]!.env).toMatchObject({ HOME: isolatedHome, USERPROFILE: isolatedHome, GIT_AI_API_KEY: '' });
    expect(JSON.parse(readFileSync(join(isolatedHome, '.git-ai', 'config.json'), 'utf8'))).toEqual({
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
    });
    const persisted = readFileSync(join(configDir, 'git-ai-sidecar.json'), 'utf8');
    expect(persisted).not.toMatch(/hook|push|remote/i);

    const calls: Array<{ file: string; args: string[]; cwd?: string }> = [];
    const executor: SidecarExecutor = (file, args, options) => {
      calls.push({ file, args, cwd: options.cwd });
      if (args[0] === '--version') return { stdout: 'git-ai 1.6.16\n', exitCode: 0 };
      if (args[0] === 'config') return {
        stdout: JSON.stringify({
          telemetry_oss_disabled: true,
          prompt_storage: 'local',
          default_prompt_storage: 'local',
          disable_version_checks: true,
          disable_auto_updates: true,
          feature_flags: {
            daemon_log_upload: false,
            transcript_streaming: false,
            transcript_sweep: false,
          },
        }),
        exitCode: 0,
      };
      return { stdout: '{"checkpoints":[],"stats":{"unknown_lines":4}}', exitCode: 0 };
    };
    const inspection = inspectGitAiSidecar({ executor, repositoryPath: '/tmp/disposable-repo' });

    expect(inspection).toMatchObject({
      configured: true,
      enabled: false,
      healthy: true,
      healthError: null,
      binaryVersion: '1.6.16',
      binarySha256Matches: true,
      policyJsonVerified: true,
      versionMatches: true,
      statusJsonAvailable: true,
      notesExportPolicy: 'local-only',
      automaticRepositoryMutation: false,
    });
    expect(calls).toEqual([
      { file: binaryPath, args: ['--version'], cwd: undefined },
      { file: binaryPath, args: ['config'], cwd: undefined },
      { file: binaryPath, args: ['status', '--json'], cwd: '/tmp/disposable-repo' },
    ]);

    writeFileSync(binaryPath, '#!/bin/sh\n# changed after configure\nexit 0\n', { mode: 0o755 });
    expect(inspectGitAiSidecar({ executor })).toMatchObject({
      healthy: false, binarySha256Matches: false, healthError: 'binary-changed',
    });
  });

  it('distinguishes missing, corrupt, and unreadable product configuration', () => {
    const configDir = mkdtempSync(join(tmpdir(), 'agent-analytics-git-ai-config-state-'));
    created.push(configDir);
    process.env.AGENT_ANALYTICS_CONFIG_DIR = configDir;
    const path = join(configDir, 'git-ai-sidecar.json');

    expect(readGitAiSidecarConfig()).toEqual({ status: 'missing', config: null });
    writeFileSync(path, '{broken', { mode: 0o600 });
    expect(readGitAiSidecarConfig()).toEqual({ status: 'corrupt', config: null });
    rmSync(path);
    mkdirSync(path);
    expect(readGitAiSidecarConfig()).toEqual({ status: 'unavailable', config: null });
  });
});
