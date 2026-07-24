import chalk from 'chalk';
import { getAllProviders } from '../../providers/registry.js';

/**
 * Render a step-by-step setup guide for first-time users.
 * Shown instead of the normal check list when: never synced + 0 sessions + no hook.
 */
export async function renderFirstRun(version: string): Promise<void> {
  // Count discoverable sessions across the existing compatibility providers.
  let sessionCount = 0;
  for (const provider of getAllProviders()) {
    try {
      const files = await provider.discover();
      sessionCount += files.length;
    } catch {
      // Provider not available
    }
  }

  console.log(chalk.cyan(`\n  Agent Usage Analyzer — Doctor  v${version}`));
  console.log(chalk.dim('  ────────────────────────────────────────────────'));
  console.log('');
  console.log('  Looks like you\'re just getting started. One command does the setup:');
  console.log('');
  console.log(chalk.cyan('    agent-usage-analyze start'));
  if (sessionCount > 0) {
    console.log(chalk.dim(`    Found ${sessionCount} existing local session record(s).`));
  }
  console.log('');
  console.log(chalk.dim('  This initializes local data, configures Codex capture, imports history, and opens the dashboard.'));
  console.log(chalk.dim('  Codex may ask you to trust the local handler once in /hooks.'));

  console.log(chalk.dim('  ────────────────────────────────────────────────'));
  console.log('  Run `agent-usage-analyze doctor` any time to verify local health.');
  console.log('');
}
