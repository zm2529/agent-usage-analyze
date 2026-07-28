import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { parseProductProcessIds, removeProductOwnedFiles } from './uninstall.js';

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-uninstall-test-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('removeProductOwnedFiles', () => {
  it('removes current, legacy, explicit state and generated hook artifacts', () => {
    const sandbox = makeTempDir();
    const homeDir = path.join(sandbox, 'home');
    const cwd = path.join(sandbox, 'source');
    const configDir = path.join(sandbox, 'custom-agent-data');
    const codexRoot = path.join(homeDir, '.codex');
    fs.mkdirSync(cwd, { recursive: true });
    for (const target of [
      path.join(homeDir, '.agent-usage-analyze'),
      path.join(homeDir, '.agent-analytics'),
      configDir,
    ]) {
      fs.mkdirSync(target, { recursive: true });
      fs.writeFileSync(path.join(target, 'data.db'), 'test');
    }
    fs.mkdirSync(codexRoot, { recursive: true });
    fs.writeFileSync(path.join(codexRoot, 'hooks.json'), '{}');
    fs.writeFileSync(path.join(codexRoot, 'hooks.json.agent-analytics-1.bak'), 'backup');
    fs.writeFileSync(path.join(codexRoot, 'unrelated.json'), '{}');
    fs.mkdirSync(path.join(homeDir, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(homeDir, '.claude', 'settings.json'), '{}');

    removeProductOwnedFiles({ homeDir, cwd, configDir, codexRoot });

    expect(fs.existsSync(path.join(homeDir, '.agent-usage-analyze'))).toBe(false);
    expect(fs.existsSync(path.join(homeDir, '.agent-analytics'))).toBe(false);
    expect(fs.existsSync(configDir)).toBe(false);
    expect(fs.existsSync(path.join(codexRoot, 'hooks.json'))).toBe(false);
    expect(fs.existsSync(path.join(codexRoot, 'hooks.json.agent-analytics-1.bak'))).toBe(false);
    expect(fs.existsSync(path.join(codexRoot, 'unrelated.json'))).toBe(true);
    expect(fs.existsSync(path.join(homeDir, '.claude', 'settings.json'))).toBe(false);
  });

  it('refuses broad paths that contain the home or source tree', () => {
    const sandbox = makeTempDir();
    const homeDir = path.join(sandbox, 'home');
    const cwd = path.join(sandbox, 'source');
    fs.mkdirSync(homeDir, { recursive: true });
    fs.mkdirSync(cwd, { recursive: true });

    expect(() => removeProductOwnedFiles({
      homeDir,
      cwd,
      configDir: sandbox,
      codexRoot: path.join(homeDir, '.codex'),
    })).toThrow(/unsafe data path/);
  });
});

describe('parseProductProcessIds', () => {
  it('returns only Agent Usage Analyzer CLI processes', () => {
    const table = [
      '  100 /opt/homebrew/bin/node /tmp/agent-usage-analyze/cli/dist/index.js dashboard',
      '  101 /opt/homebrew/bin/node /usr/local/lib/node_modules/agent-usage-analyze/dist/index.js queue settle',
      '  102 /opt/homebrew/bin/node /tmp/other/dist/index.js start',
      '  103 /Applications/Code.app/Contents/MacOS/Electron /tmp/agent-usage-analyze/README.md',
    ].join('\n');

    expect(parseProductProcessIds(table, 101)).toEqual([100]);
  });
});
