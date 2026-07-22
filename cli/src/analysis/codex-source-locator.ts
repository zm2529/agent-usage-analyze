import { createHash } from 'crypto';
import {
  closeSync, existsSync, openSync, readFileSync, readSync, readdirSync, realpathSync, statSync,
} from 'fs';
import { isAbsolute, join, relative, resolve } from 'path';

export interface CodexRolloutLocation {
  path: string | null;
  locatorAccepted: boolean;
  diagnostic: string | null;
}

function within(root: string, candidate: string): boolean {
  const child = relative(root, candidate);
  return child === '' || (!child.startsWith('..') && !isAbsolute(child));
}

function supportedRoots(codexHome: string): string[] {
  return ['sessions', 'archived_sessions'].map((name) => resolve(codexHome, name));
}

function safeSupportedPath(codexHome: string, locator: string): string | null {
  if (!isAbsolute(locator)) return null;
  const lexical = resolve(locator);
  const lexicalRoot = supportedRoots(codexHome).find((root) => within(root, lexical));
  if (!lexicalRoot || !existsSync(lexicalRoot) || !existsSync(lexical)) return null;
  try {
    const realRoot = realpathSync(lexicalRoot);
    const realFile = realpathSync(lexical);
    if (!within(realRoot, realFile) || !statSync(realFile).isFile()) return null;
    return realFile;
  } catch {
    return null;
  }
}

function walk(directory: string, files: string[], depth = 0): void {
  if (depth > 10 || !existsSync(directory)) return;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) walk(path, files, depth + 1);
    else if (entry.isFile() && entry.name.startsWith('rollout-') && entry.name.endsWith('.jsonl')) files.push(path);
  }
}

export function readCodexRolloutIdentity(path: string): string | null {
  try {
    const descriptor = openSync(path, 'r');
    const prefix = Buffer.alloc(64 * 1024);
    let length = 0;
    try {
      length = readSync(descriptor, prefix, 0, prefix.length, 0);
    } finally {
      closeSync(descriptor);
    }
    for (const rawLine of prefix.subarray(0, length).toString('utf8').split('\n').slice(0, 64)) {
      if (!rawLine.trim()) continue;
      try {
        const raw = JSON.parse(rawLine) as Record<string, unknown>;
        const payload = typeof raw.payload === 'object' && raw.payload !== null
          ? raw.payload as Record<string, unknown>
          : {};
        const identity = raw.type === 'session_meta' ? payload.id
          : ['input', 'item.completed'].includes(String(raw.type)) ? raw.thread_id : undefined;
        if (typeof identity === 'string' && identity.length > 0) return identity;
      } catch {
        continue;
      }
    }
  } catch {
    return null;
  }
  return null;
}

export function discoverCodexRolloutPaths(codexHome: string): string[] {
  const files: string[] = [];
  for (const root of supportedRoots(codexHome)) walk(root, files);
  return files.sort();
}

export function locateCodexRollout(options: {
  codexHome: string;
  sessionId: string;
  locator?: string | null;
}): CodexRolloutLocation {
  let locatorDiagnostic: string | null = null;
  if (options.locator) {
    const supported = safeSupportedPath(options.codexHome, options.locator);
    if (!supported) {
      locatorDiagnostic = 'locator-outside-supported-roots';
    } else if (readCodexRolloutIdentity(supported) !== options.sessionId) {
      locatorDiagnostic = 'locator-session-mismatch';
    } else {
      return { path: supported, locatorAccepted: true, diagnostic: null };
    }
  }

  const matches = discoverCodexRolloutPaths(options.codexHome)
    .filter((path) => readCodexRolloutIdentity(path) === options.sessionId)
    .sort((left, right) => statSync(right).mtimeMs - statSync(left).mtimeMs);
  if (matches.length === 0) {
    return { path: null, locatorAccepted: false, diagnostic: 'source-not-found' };
  }
  return { path: realpathSync(matches[0]!), locatorAccepted: false, diagnostic: locatorDiagnostic };
}

export function codexRolloutContentBasis(path: string): string {
  return `rollout-sha256:${createHash('sha256').update(readFileSync(path)).digest('hex')}`;
}
