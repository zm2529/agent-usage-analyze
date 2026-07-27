import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const paths: string[] = [];
afterEach(() => {
  for (const path of paths.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe('release secret audit', () => {
  it('discovers and rejects a seeded credential in an actual npm package input', () => {
    const repository = join(dirname(fileURLToPath(import.meta.url)), '../../..');
    const packageOverlay = mkdtempSync(join(tmpdir(), 'agent-analytics-audit-package-'));
    paths.push(packageOverlay);
    const seeded = join(packageOverlay, 'release-audit-seeded-secret.txt');
    writeFileSync(seeded, 'aws_access_key_id=AKIA1234567890ABCDEF\n');
    let failure: { status?: number; stderr?: string } | null = null;
    try {
      execFileSync(process.execPath, ['scripts/release-audit.mjs'], {
        cwd: repository,
        env: { ...process.env, AGENT_ANALYTICS_AUDIT_PACKAGE_OVERLAY_DIR: packageOverlay },
        encoding: 'utf8',
        stdio: 'pipe',
      });
    } catch (error) {
      failure = error as { status?: number; stderr?: string };
    }
    expect(failure?.status).toBe(1);
    expect(failure?.stderr).toContain(
      'possible aws-access-key in package input: server-dist/release-audit-seeded-secret.txt',
    );
  }, 90_000);

  it('preserves secret findings when npm pack returns no manifest', () => {
    const repository = join(dirname(fileURLToPath(import.meta.url)), '../../..');
    const packageOverlay = mkdtempSync(join(tmpdir(), 'agent-analytics-audit-package-'));
    const fakeBin = mkdtempSync(join(tmpdir(), 'agent-analytics-audit-bin-'));
    paths.push(packageOverlay, fakeBin);
    writeFileSync(
      join(packageOverlay, 'release-audit-seeded-secret.txt'),
      'aws_access_key_id=AKIA1234567890ABCDEF\n',
    );
    mkdirSync(fakeBin, { recursive: true });
    const fakeNpm = join(fakeBin, 'npm');
    writeFileSync(fakeNpm, '#!/bin/sh\nprintf \"[]\\n\"\n');
    chmodSync(fakeNpm, 0o700);
    let failure: { status?: number; stderr?: string } | null = null;
    try {
      execFileSync(process.execPath, ['scripts/release-audit.mjs'], {
        cwd: repository,
        env: {
          ...process.env,
          PATH: `${fakeBin}:${process.env.PATH ?? ''}`,
          AGENT_ANALYTICS_AUDIT_PACKAGE_OVERLAY_DIR: packageOverlay,
        },
        encoding: 'utf8',
        stdio: 'pipe',
      });
    } catch (error) {
      failure = error as { status?: number; stderr?: string };
    }
    expect(failure?.status).toBe(1);
    expect(failure?.stderr).toContain(
      'possible aws-access-key in package input: server-dist/release-audit-seeded-secret.txt',
    );
    expect(failure?.stderr).toContain('npm pack did not return a package manifest');
  }, 90_000);
});
