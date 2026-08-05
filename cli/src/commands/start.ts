import chalk from 'chalk';
import { ensureLocalSetup } from './init.js';
import { importCodexHistory, spawnCodexHistoryImport } from './import-codex.js';
import { dashboardCommand } from './dashboard.js';
import { installCodexHook } from '../utils/codex-hooks.js';
import { runSync } from './sync.js';
import type { IngestionProgress } from '../canonical/ingestion.js';
import {
  startAutomaticHistoryAnalysis,
  type HistoryBackfillResult,
} from '../analysis/history-backfill.js';
import { spawnAutomaticBehaviorReport } from '../analysis/behavior-report-scheduler.js';
import ora from 'ora';
import { ensureDashboardService } from '../utils/dashboard-service.js';
import { openUrl } from '../utils/browser.js';

export interface StartOptions {
  port: string;
  open: boolean;
  hook: boolean;
  importHistory: boolean;
  waitForImport: boolean;
}

interface StartDependencies {
  ensureSetup: typeof ensureLocalSetup;
  syncHistory: typeof runSync;
  installHook: typeof installCodexHook;
  importHistory: typeof importCodexHistory;
  startBackgroundImport: typeof spawnCodexHistoryImport;
  launchDashboard: typeof dashboardCommand;
  startDashboardService?: typeof ensureDashboardService;
  openDashboard?: typeof openUrl;
  startHistoryAnalysis?: () => HistoryBackfillResult;
  startBehaviorReport?: () => void;
}

const defaultDependencies: StartDependencies = {
  ensureSetup: ensureLocalSetup,
  syncHistory: runSync,
  installHook: installCodexHook,
  importHistory: importCodexHistory,
  startBackgroundImport: spawnCodexHistoryImport,
  launchDashboard: dashboardCommand,
  startDashboardService: ensureDashboardService,
  openDashboard: openUrl,
  startHistoryAnalysis: startAutomaticHistoryAnalysis,
  startBehaviorReport: spawnAutomaticBehaviorReport,
};

function formatDuration(milliseconds: number): string {
  const seconds = Math.max(1, Math.round(milliseconds / 1_000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return remainder === 0 ? `${minutes}m` : `${minutes}m ${remainder}s`;
}

function foregroundProgressReporter(startedAt: number): (progress: IngestionProgress) => void {
  let announcedCount = false;
  let lastBucket = -1;
  const samples: Array<{ completed: number; at: number }> = [];
  return (progress) => {
    if (progress.phase === 'discovering') {
      console.log(chalk.cyan('  → Reading the local Codex session index…'));
      console.log(chalk.dim('    This imports historical work only; it does not send data or modify Codex sessions.'));
      console.log(chalk.dim('    First import is usually 10 seconds–3 minutes, depending on history size.'));
      return;
    }
    if (progress.phase === 'processing') {
      if (!announcedCount) {
        announcedCount = true;
        console.log(chalk.dim(`    Found ${progress.discoveredSources} session files. Parsing local evidence…`));
      }
      const total = progress.discoveredSources;
      const completed = progress.processedSources;
      if (total === 0) return;
      const percent = Math.min(100, Math.round((completed / total) * 100));
      const bucket = Math.floor(percent / 10);
      if (!process.stdout.isTTY && completed < total && bucket === lastBucket) return;
      lastBucket = bucket;
      const elapsed = Date.now() - startedAt;
      if (samples.at(-1)?.completed !== completed) {
        samples.push({ completed, at: Date.now() });
        if (samples.length > 8) samples.shift();
      }
      const first = samples[0];
      const last = samples.at(-1);
      const sampleElapsed = first && last ? last.at - first.at : 0;
      const sampleProgress = first && last ? last.completed - first.completed : 0;
      const remaining = completed >= Math.min(20, Math.ceil(total * 0.02))
        && sampleElapsed >= 5_000 && sampleProgress > 0 && completed < total
        ? ((total - completed) / (sampleProgress / sampleElapsed))
        : 0;
      const estimate = remaining > 0 ? ` · ETA ~${formatDuration(remaining)}` : '';
      const line = `    Progress ${completed}/${total} files (${percent}%) · elapsed ${formatDuration(elapsed)}${estimate}`;
      if (process.stdout.isTTY && completed < total) process.stdout.write(`\r${chalk.dim(line)}`);
      else console.log(chalk.dim(line));
      return;
    }
    if (progress.phase === 'projecting') {
      if (process.stdout.isTTY) process.stdout.write('\n');
      console.log(chalk.dim('    Building the task and evidence index…'));
    }
  };
}

export async function runStart(
  options: StartOptions,
  dependencies: StartDependencies = defaultDependencies,
): Promise<void> {
  console.log(chalk.cyan('\n  Agent Usage Analyzer — Starting\n'));

  const setup = dependencies.ensureSetup();
  console.log(chalk.green(`  ✓ Local data ${setup.configCreated ? 'initialized' : 'ready'}`));
  const deferAnalysisUntilImport = setup.configCreated && options.importHistory;

  const historySpinner = ora('Checking local Agent history…').start();
  try {
    const sync = await dependencies.syncHistory({ quiet: true });
    const sources = Object.entries(sync.sessionsByProvider)
      .filter(([, count]) => count > 0)
      .map(([source]) => source);
    historySpinner.succeed(`Agent history synced${sources.length ? ` (${sources.join(', ')})` : ''}`);
  } catch (error) {
    historySpinner.stop();
    console.warn(chalk.yellow(`  ! Agent history sync skipped: ${error instanceof Error ? error.message : String(error)}`));
    console.warn(chalk.dim('    The dashboard will still open; run `agent-usage-analyze sync` to retry.'));
  }

  if (options.hook) {
    const hook = dependencies.installHook();
    console.log(chalk.green(`  ✓ Codex capture ${hook.changed ? 'configured' : 'already configured'}`));
    console.log(chalk.dim('    In Codex, review /hooks once if this handler is not trusted yet.'));
  }

  const startAnalysis = (afterImport = false) => {
    let analysis: HistoryBackfillResult | undefined;
    try {
      analysis = dependencies.startHistoryAnalysis?.();
      if (analysis?.enabled) {
        console.log(chalk.green(`  ✓ LLM behavior analysis enabled (${analysis.effectiveRunner})`));
        if (analysis.queued > 0) {
          console.log(chalk.dim(`    Analyzing ${analysis.queued} recent Codex sessions asynchronously; progress appears in the WebUI.`));
          if (analysis.logPath) console.log(chalk.dim(`    Log: ${analysis.logPath}`));
        } else {
          console.log(chalk.dim('    Recent Codex sessions are already analyzed; future completed sessions are automatic.'));
        }
      } else if (analysis) {
        console.warn(chalk.yellow(`  ! LLM analysis unavailable (${analysis.reason}); deterministic analysis remains active.`));
      }
    } catch (error) {
      console.warn(chalk.yellow(`  ! LLM history analysis could not start: ${error instanceof Error ? error.message : String(error)}`));
      console.warn(chalk.dim('    The dashboard will still open; use Settings to inspect the analysis runner.'));
    }
    if (afterImport) {
      try {
        dependencies.startBehaviorReport?.();
      } catch (error) {
        console.warn(chalk.yellow(`  ! Initial behavior report could not start: ${error instanceof Error ? error.message : String(error)}`));
      }
    }
  };

  if (!deferAnalysisUntilImport) {
    startAnalysis();
  }

  if (options.importHistory) {
    if (options.waitForImport) {
      try {
        const startedAt = Date.now();
        const summary = await dependencies.importHistory({
          onProgress: foregroundProgressReporter(startedAt),
        });
        console.log(chalk.green(`  ✓ Codex history imported (${summary.insertedEvents} new events)`));
        if (deferAnalysisUntilImport) startAnalysis(true);
      } catch (error) {
        console.warn(chalk.yellow(`  ! History import skipped: ${error instanceof Error ? error.message : String(error)}`));
        console.warn(chalk.dim('    The dashboard will still open; run `agent-usage-analyze import-codex` to retry.'));
      }
    } else {
      try {
        const background = dependencies.startBackgroundImport({
          analyzeAfterImport: deferAnalysisUntilImport,
        });
        console.log(chalk.green('  ✓ Codex history import started in the background'));
        console.log(chalk.dim('    What: scanning local Codex sessions and building task/evidence records.'));
        console.log(chalk.dim('    Progress and live ETA appear at the top of the WebUI; the dashboard opens now.'));
        if (deferAnalysisUntilImport) {
          console.log(chalk.dim('    LLM session analysis and the first behavior report start automatically when import completes.'));
        }
        console.log(chalk.dim(`    Log: ${background.logPath}`));
      } catch (error) {
        console.warn(chalk.yellow(`  ! Background history import could not start: ${error instanceof Error ? error.message : String(error)}`));
        console.warn(chalk.dim('    The dashboard will still open; run `agent-usage-analyze import-codex` to retry.'));
      }
    }
  }

  console.log(chalk.green('  ✓ Starting local dashboard service'));
  if (dependencies.startDashboardService) {
    const port = Number(options.port);
    const service = await dependencies.startDashboardService(port);
    const url = `http://localhost:${port}`;
    if (options.open) dependencies.openDashboard?.(url);
    console.log(chalk.green(`  ✓ Dashboard ready: ${url}`));
    console.log(chalk.dim(service.persistent
      ? '    The terminal can now be closed. The dashboard will start automatically when you sign in.'
      : '    The dashboard is running in the background for this session; rerun `agent-usage-analyze start` after sign-in if needed.'));
    console.log('');
  } else {
    await dependencies.launchDashboard({
      port: options.port,
      open: options.open,
      sync: false,
    });
  }
}

export async function startCommand(options: StartOptions): Promise<void> {
  await runStart(options);
}
