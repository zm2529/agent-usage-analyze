import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';

export interface GitCommitDeliverySource {
  objectId: string;
  occurredAt: string;
  message: string;
  branches: string[];
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function git(repositoryPath: string, args: string[]): string {
  return execFileSync('git', ['-C', repositoryPath, ...args], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 10_000,
  }).trim();
}

function normalizedRemote(repositoryPath: string, remote: string): string {
  const scp = !remote.includes('://') ? remote.match(/^(?:[^@/]+@)?([^:/]+):(.+)$/) : null;
  if (scp) {
    return `${scp[1]!.toLowerCase()}/${scp[2]!.replace(/^\/+|\/+$/g, '').replace(/\.git$/i, '')}`;
  }
  if (/^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(remote)) {
    const url = new URL(remote);
    return `${url.hostname.toLowerCase()}${url.port ? `:${url.port}` : ''}/${url.pathname.replace(/^\/+|\/+$/g, '').replace(/\.git$/i, '')}`;
  }
  return `local:${realpathSync(resolve(repositoryPath, remote))}`;
}

export function repositoryIdentity(repositoryPath: string): string {
  let identity: string;
  try {
    const remote = git(repositoryPath, ['config', '--get', 'remote.origin.url']);
    if (!remote) throw new Error('missing remote');
    identity = `remote:${normalizedRemote(repositoryPath, remote)}`;
  } catch {
    const commonDirectory = git(repositoryPath, ['rev-parse', '--git-common-dir']);
    identity = `local:${realpathSync(resolve(repositoryPath, commonDirectory))}`;
  }
  return `repository:sha256:${hash(identity)}`;
}

export function discoverGitCommits(repositoryPath: string): GitCommitDeliverySource[] {
  return git(repositoryPath, ['log', '--all', '--format=%H%x00%cI%x00%B%x1e'])
    .split('\x1e').map((value) => value.trim()).filter(Boolean).map((record) => {
      const [objectId, occurredAt, ...messageParts] = record.split('\0');
      if (!objectId || !occurredAt) throw new Error('Git produced an incomplete commit identity');
      return {
        objectId,
        occurredAt,
        message: messageParts.join('\0'),
        branches: git(repositoryPath, ['branch', '--all', '--contains', objectId, '--format=%(refname:short)'])
          .split('\n').map((value) => value.trim()).filter(Boolean),
      };
    });
}
