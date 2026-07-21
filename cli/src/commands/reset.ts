import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { closeDb, getDbPath } from '../db/client.js';
import { archiveLocalAnalysisData } from '../db/local-data-lifecycle.js';
import { getSyncStatePath } from '../utils/config.js';
import { captureError, classifyError, trackEvent } from '../utils/telemetry.js';

export const resetCommand = new Command('reset')
  .description('Archive local analysis data so it can be rebuilt or recovered')
  .option('--confirm', 'Skip confirmation prompt')
  .action(async (options) => {
    console.log(chalk.yellow.bold('\n  This archives the local analysis database and sync state.'));
    console.log(chalk.gray('  Imported source history and Git repositories are never changed.\n'));

    if (!options.confirm) {
      const readline = await import('readline');
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      const answer = await new Promise<string>((resolve) => {
        rl.question(chalk.cyan('Type "ARCHIVE" to confirm: '), resolve);
      });
      rl.close();
      if (answer !== 'ARCHIVE') {
        console.log(chalk.gray('\nAborted. No local analysis data was archived.'));
        return;
      }
    }

    const spinner = ora('Archiving local analysis data...').start();
    try {
      closeDb();
      const result = archiveLocalAnalysisData({
        dbPath: getDbPath(),
        syncStatePath: getSyncStatePath(),
      });
      if (result.status === 'nothing-to-archive') spinner.info('No local analysis data existed');
      else spinner.succeed('Local analysis data archived');
      if (result.databaseBackupPath) {
        console.log(chalk.gray(`  Database backup: ${result.databaseBackupPath}`));
      }
      if (result.syncStateBackupPath) {
        console.log(chalk.gray(`  Sync-state backup: ${result.syncStateBackupPath}`));
      }
      console.log(chalk.gray(`  Recovery: ${result.recovery}`));
      trackEvent('cli_reset', { success: true, mode: 'recoverable-archive' });
      console.log(chalk.green(`\n  Archive complete. Run \`${result.rebuildCommand}\` to rebuild analysis.\n`));
    } catch (error) {
      spinner.fail(`Failed to archive local data: ${error instanceof Error ? error.message : error}`);
      console.error(chalk.red('\nAborted. Any partial moves were rolled back.'));
      console.error(chalk.dim('Run `agent-analytics doctor` if the problem persists.'));
      const { error_type, error_message } = classifyError(error);
      trackEvent('cli_reset', { success: false, error_type, error_message });
      captureError(error, { command: 'reset', error_type });
      process.exitCode = 1;
    }
  });
