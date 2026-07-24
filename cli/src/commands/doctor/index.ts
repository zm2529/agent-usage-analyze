import { readFileSync } from 'fs';
import chalk from 'chalk';
import { loadSyncState } from '../../utils/config.js';
import { getDb } from '../../db/client.js';
import { hookAlreadyInstalled, loadClaudeSettings } from '../../utils/hooks-utils.js';
import { environmentChecks } from './checks/environment.js';
import { databaseChecks } from './checks/database.js';
import { configChecks } from './checks/config.js';
import { providerChecks } from './checks/providers.js';
import { analysisChecks } from './checks/analysis.js';
import { hooksChecks } from './checks/hooks.js';
import { syncChecks } from './checks/sync.js';
import { dashboardChecks } from './checks/dashboard.js';
import { runChecks, renderJson } from './runner.js';
import { renderFirstRun } from './first-run.js';
import type { Section } from './types.js';
import { inspectCodexHook } from '../../utils/codex-hooks.js';

function getVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf-8'));
    return pkg.version ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

function isFirstRun(): boolean {
  // Check 1: never synced
  const syncState = loadSyncState();
  if (syncState.lastSync !== '') return false;

  // Check 2: 0 sessions in DB
  try {
    const db = getDb();
    const row = db.prepare('SELECT COUNT(*) as cnt FROM sessions').get() as { cnt: number };
    if (row.cnt > 0) return false;
  } catch {
    // DB not available — still qualifies as first run
  }

  // Check 3: hook not installed
  const settings = loadClaudeSettings();
  if (settings?.hooks?.SessionEnd && hookAlreadyInstalled(settings.hooks.SessionEnd)) {
    return false;
  }
  if (inspectCodexHook().installed) return false;

  return true;
}

export interface DoctorOptions {
  fix?: boolean;
  verbose?: boolean;
  json?: boolean;
}

export async function doctorCommand(opts: DoctorOptions = {}): Promise<void> {
  const version = getVersion();

  // First-run detection: show setup guide instead of check list
  if (!opts.json && isFirstRun()) {
    await renderFirstRun(version);
    return;
  }

  if (!opts.json) {
    console.log(chalk.cyan(`\n  Agent Usage Analyzer — Doctor  v${version}`));
    console.log(chalk.dim('  ────────────────────────────────────────────────'));
  }

  const sections: Section[] = [
    { label: 'Environment', checks: environmentChecks() },
    { label: 'Database', checks: databaseChecks() },
    { label: 'Config', checks: configChecks() },
    { label: 'Session Sources', checks: providerChecks() },
    { label: 'AI Analysis', checks: analysisChecks() },
    { label: 'Hooks', checks: hooksChecks() },
    { label: 'Sync State', checks: syncChecks() },
    { label: 'Dashboard', checks: dashboardChecks() },
  ];

  const { results, hasFail } = await runChecks(sections, {
    verbose: opts.verbose,
    json: opts.json,
    fix: opts.fix,
  });

  if (opts.json) {
    console.log(renderJson(results, version));
  }

  if (hasFail) {
    process.exitCode = 1;
  }
}
