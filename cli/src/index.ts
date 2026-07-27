#!/usr/bin/env node

import { readFileSync } from 'fs';
import { Command } from 'commander';
import { initCommand } from './commands/init.js';
import { syncCommand, getTrivialSessions, pruneTrivialSessions } from './commands/sync.js';
import { statusCommand } from './commands/status.js';
import { installHookCommand, uninstallHookCommand } from './commands/install-hook.js';
import { openCommand } from './commands/open.js';
import { dashboardCommand } from './commands/dashboard.js';
import { resetCommand } from './commands/reset.js';
import { statsCommand } from './commands/stats/index.js';
import { configCommand } from './commands/config.js';
import { telemetryCommand } from './commands/telemetry.js';
import { reflectCommand } from './commands/reflect.js';
import { insightsCommand, insightsCheckCommand } from './commands/insights.js';
import { sessionEndCommand } from './commands/session-end.js';
import { buildQueueCommand } from './commands/queue.js';
import { doctorCommand } from './commands/doctor/index.js';
import { showTelemetryNoticeIfNeeded } from './utils/telemetry.js';
import { ingestFixtureCommand } from './commands/ingest-fixture.js';
import { importCodexCommand } from './commands/import-codex.js';
import { migrateProductCommand } from './commands/migrate-product.js';
import { buildermarkGateCommand } from './commands/buildermark-gate.js';
import {
  gitAiProspectiveGateCommand,
  gitAiSidecarBuildCommand,
  gitAiSidecarConfigureCommand,
  gitAiSidecarInspectCommand,
  gitAiSidecarVerifyCommand,
} from './commands/git-ai-sidecar.js';
import { advisoryCommand } from './commands/advisory.js';
import { codexStopCommand } from './commands/codex-stop.js';
import { startCommand } from './commands/start.js';
import { runAutomaticBehaviorReport, runManualBehaviorReport } from './analysis/behavior-report-scheduler.js';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf-8'));

const program = new Command();

program
  .name('agent-usage-analyze')
  .description('Local usage, behavior, and improvement analytics for coding agents')
  .version(pkg.version);

program
  .command('start')
  .description('Sync supported agents, optimize Codex capture, and open the dashboard')
  .option('-p, --port <number>', 'Dashboard port', String(7890))
  .option('--no-open', 'Do not open the browser automatically')
  .option('--no-hook', 'Do not install or refresh the Codex capture hook')
  .option('--no-import', 'Do not import existing Codex history')
  .option('--wait-for-import', 'Wait for the Codex backfill and show progress in this terminal')
  .action((options: { port: string; open: boolean; hook: boolean; import: boolean; waitForImport?: boolean }) => startCommand({
    port: options.port,
    open: options.open,
    hook: options.hook,
    importHistory: options.import,
    waitForImport: options.waitForImport ?? false,
  }));

program
  .command('init', { hidden: true })
  .description('Initialize the local database')
  .action(initCommand);

const syncCmd = program
  .command('sync', { hidden: true })
  .description('Refresh the legacy local session projection')
  .option('-f, --force', 'Force re-sync all sessions (also restores hidden sessions)')
  .option('-p, --project <name>', 'Only sync sessions from a specific project')
  .option('-s, --source <name>', 'Only sync one stored source identifier')
  .option('--dry-run', 'Show what would be synced without making changes')
  .option('-q, --quiet', 'Suppress output (useful for hooks)')
  .option('-v, --verbose', 'Show diagnostic warnings from providers')
  .option('--regenerate-titles', 'Regenerate titles for all sessions')
  .action(syncCommand);

syncCmd
  .command('prune')
  .description('Soft-delete sessions with ≤2 messages (trivial abandoned sessions)')
  .action(async () => {
    const chalk = (await import('chalk')).default;
    const { default: inquirer } = await import('inquirer');
    console.log(chalk.cyan('\n  Agent Usage Analyzer — Prune\n'));

    const sessions = getTrivialSessions();
    if (sessions.length === 0) {
      console.log(chalk.green('  No trivial sessions found. Nothing to prune.'));
      return;
    }

    console.log(chalk.white(`  Found ${sessions.length} session${sessions.length !== 1 ? 's' : ''} with ≤2 messages:\n`));
    for (const s of sessions) {
      const label = s.title ?? chalk.dim('(no title)');
      console.log(`  ${chalk.dim('·')} ${label} ${chalk.dim(`[${s.project_name}, ${s.message_count} msg]`)}`);
    }
    console.log('');

    const { confirmed } = await inquirer.prompt<{ confirmed: boolean }>([
      {
        type: 'confirm',
        name: 'confirmed',
        message: `Soft-delete these ${sessions.length} session${sessions.length !== 1 ? 's' : ''}? (Restorable with sync --force)`,
        default: false,
      },
    ]);

    if (!confirmed) {
      console.log(chalk.yellow('\n  Cancelled. No sessions were hidden.'));
      return;
    }

    const { deleted } = pruneTrivialSessions(sessions.map((s) => s.id));
    console.log(chalk.green(`\n  Hidden ${deleted} session${deleted !== 1 ? 's' : ''}.`));
    console.log(chalk.dim('  Use agent-usage-analyze sync --force to restore hidden sessions.'));
  });

program
  .command('status')
  .description('Show Agent Usage Analyzer status')
  .action(statusCommand);

program
  .command('ingest-fixture <path>', { hidden: true })
  .description('Import a synthetic canonical batch for local validation')
  .action(ingestFixtureCommand);

program
  .command('import-codex', { hidden: true })
  .description('Explicitly import active and archived Codex rollouts into the canonical store')
  .option('--home <path>', 'Use an isolated Codex home instead of the configured default')
  .action(importCodexCommand);

program
  .command('migrate-product', { hidden: true })
  .description('Backup and migrate a frozen legacy database into the canonical product schema')
  .action(migrateProductCommand);

program
  .command('advisory [task_id]', { hidden: true })
  .description('Read at most one non-blocking local suggestion for a Codex task')
  .option('--hook', 'Read task or session context from stdin without echoing the prompt')
  .option('--timeout-ms <number>', 'Fail-open query budget in milliseconds', '75')
  .action((taskId: string | undefined, options: { hook?: boolean; timeoutMs?: string }) =>
    advisoryCommand(taskId, options));

program
  .command('buildermark-gate <evidence>', { hidden: true })
  .description('Run the isolated Buildermark historical-helper gate from sanitized local evidence JSON')
  .requiredOption('--repository <path>', 'Repository whose immutable commits the evidence references')
  .action((evidence: string, options: { repository: string }) => {
    const report = buildermarkGateCommand(evidence, options);
    if (report.status === 'failed') process.exitCode = 2;
  });

const gitAiSidecar = program
  .command('git-ai-sidecar', { hidden: true })
  .description('Build, configure, and inspect the pinned local Git AI sidecar');

gitAiSidecar.command('verify')
  .description('Verify every file in the frozen vendored Git AI source')
  .action(() => { gitAiSidecarVerifyCommand(); });

gitAiSidecar.command('build')
  .description('Build the frozen sidecar with Cargo locked and offline')
  .option('--allow-network', 'Explicitly allow Cargo to fetch only locked dependencies')
  .action((options: { allowNetwork?: boolean }) => { gitAiSidecarBuildCommand(options); });

gitAiSidecar.command('configure')
  .description('Configure product-side consumption without installing repository hooks')
  .requiredOption('--binary <path>', 'Absolute path to the frozen Git AI binary')
  .option('--enable', 'Request consumption after the prospective gate passes')
  .option('--notes-export <policy>', 'local-only or manual-external', 'local-only')
  .action((options: { binary: string; enable?: boolean; notesExport: 'local-only' | 'manual-external' }) => {
    gitAiSidecarConfigureCommand(options);
  });

gitAiSidecar.command('inspect')
  .description('Inspect pinned version and optional read-only Git AI status JSON')
  .option('--repository <path>', 'Disposable or explicitly selected repository for status inspection')
  .action((options: { repository?: string }) => { gitAiSidecarInspectCommand(options); });

program.command('git-ai-gate <evidence>', { hidden: true })
  .description('Run the disposable prospective Git AI safety matrix from sanitized local evidence JSON')
  .requiredOption('--repository <path>', 'Disposable repository containing the referenced commits and local Notes')
  .action((evidence: string, options: { repository: string }) => {
    const report = gitAiProspectiveGateCommand(evidence, options);
    if (report.status === 'failed') process.exitCode = 2;
  });

program
  .command('install-hook', { hidden: true })
  .description('Install automatic Codex capture')
  .action(() => installHookCommand({ source: 'codex' }));

program
  .command('uninstall-hook', { hidden: true })
  .description('Remove automatic Codex capture')
  .action(() => uninstallHookCommand({ source: 'codex' }));

program.command('codex-stop', { hidden: true })
  .description('Internal fail-open Codex Stop hook entry point')
  .option('-q, --quiet')
  .option('--managed-hook <marker>')
  .action((options: { quiet?: boolean; managedHook?: string }) => codexStopCommand(options));

program.command('behavior-report-auto', { hidden: true })
  .description('Internal Hook-triggered cross-session report scheduler')
  .action(async () => { await runAutomaticBehaviorReport(); });

program.command('behavior-report-run', { hidden: true })
  .description('Internal user-triggered cross-session report worker')
  .action(async () => { await runManualBehaviorReport(); });

program
  .command('doctor')
  .description('Check the local Agent Usage Analyzer installation')
  .option('--fix', 'Apply safe idempotent fixes automatically')
  .option('--verbose', 'Show probed paths for skipped items')
  .option('--json', 'Machine-readable JSON output')
  .action(async (opts) => {
    await doctorCommand({ fix: opts.fix, verbose: opts.verbose, json: opts.json });
  });

program
  .command('open', { hidden: true })
  .description('Open the local dashboard in your browser')
  .option('--project', 'Open filtered to the current project')
  .action(openCommand);

program
  .command('dashboard', { hidden: true })
  .description('Open the already-configured local dashboard')
  .option('-p, --port <number>', 'Port number', String(7890))
  .option('--no-open', 'Do not open browser automatically')
  .option('--sync', 'Explicitly sync the legacy Codex session projection before starting')
  .action(dashboardCommand);

program.addCommand(resetCommand);
program.addCommand(statsCommand);
program.addCommand(configCommand);
program.addCommand(telemetryCommand);
program.addCommand(reflectCommand, { hidden: true });


// session-end command — single SessionEnd hook entry point (sync + enqueue + spawn worker)
program
  .command('session-end', { hidden: true })
  .description('SessionEnd hook: sync session, enqueue for analysis, spawn background worker')
  .option('--native', 'Use the configured native analysis runner')
  .option('-s, --source <tool>', 'Stored source identifier')
  .option('-q, --quiet', 'Suppress output')
  .option('--model <model>', 'Model override for native analysis')
  .action(async (opts) => {
    await sessionEndCommand({ native: opts.native ?? true, quiet: opts.quiet, source: opts.source, model: opts.model });
  });

// queue command suite — manage the analysis_queue
program.addCommand(buildQueueCommand(), { hidden: true });

// insights command — analyze a session using the configured execution policy
const insightsCmd = program
  .command('insights [session_id]', { hidden: true })
  .description('Analyze a session with AI — extracts insights and prompt quality score')
  .option('--native', 'Use the configured native analysis runner')
  .option('--hook', 'Read session context from stdin for a legacy hook')
  .option('-s, --source <tool>', 'Stored source identifier')
  .option('--force', 'Re-analyze even if already analyzed at this session length')
  .option('-q, --quiet', 'Suppress output')
  .option('--model <model>', 'Model override for native analysis')
  .action(async (sessionId: string | undefined, opts) => {
    await insightsCommand(sessionId, opts);
  });

insightsCmd
  .command('check')
  .description('Check for unanalyzed sessions in the last N days')
  .option('--days <n>', 'Lookback window in days', '7')
  .option('-q, --quiet', 'Machine-readable output (just count)')
  .option('--analyze', 'Process all found sessions sequentially')
  .action(async (opts) => {
    await insightsCheckCommand({
      days: opts.days ? parseInt(opts.days, 10) : 7,
      quiet: opts.quiet,
      analyze: opts.analyze,
    });
  });

// The default path is the same idempotent one-command startup as `start`.
program.action(async () => {
  await startCommand({
    port: '7890', open: true, hook: true, importHistory: true, waitForImport: false,
  });
});

// Show one-time telemetry disclosure before any command runs
// Skip for --version/-V and --help/-h since those commands don't need it
const isVersionOrHelp = process.argv.some(arg => ['--version', '-V', '--help', '-h'].includes(arg));
const isReadOnlyAdvisory = process.argv[2] === 'advisory';
if (!isVersionOrHelp && !isReadOnlyAdvisory) {
  showTelemetryNoticeIfNeeded();
}

program.parse();
