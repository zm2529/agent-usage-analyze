import chalk from 'chalk';
import { getAllProviders } from '../../providers/registry.js';

/**
 * Render a step-by-step setup guide for first-time users.
 * Shown instead of the normal check list when: never synced + 0 sessions + no hook.
 */
export async function renderFirstRun(version: string): Promise<void> {
  // Count discoverable sessions across all providers
  let sessionCount = 0;
  for (const provider of getAllProviders()) {
    try {
      const files = await provider.discover();
      sessionCount += files.length;
    } catch {
      // Provider not available
    }
  }

  console.log(chalk.cyan(`\n  Agent Analytics — Doctor  v${version}`));
  console.log(chalk.dim('  ────────────────────────────────────────────────'));
  console.log('');
  console.log('  Looks like you\'re just getting started. Here\'s what to do:');
  console.log('');

  // Step 1
  console.log(chalk.white('  Step 1 — Sync your sessions'));
  console.log(chalk.cyan('    agent-analytics sync'));
  if (sessionCount > 0) {
    console.log(chalk.dim(`    Found ${sessionCount} session(s) ready to import.`));
  }
  console.log('');

  // Step 2
  console.log(chalk.white('  Step 2 — Open the dashboard'));
  console.log(chalk.cyan('    agent-analytics dashboard'));
  console.log('');

  // Step 3
  console.log(chalk.white('  Step 3 — Auto-sync future sessions  (recommended)'));
  console.log(chalk.cyan('    agent-analytics install-hook'));
  console.log('');

  // Step 4
  console.log(chalk.white('  Step 4 — Set up AI analysis  (optional)'));
  console.log(chalk.cyan('    agent-analytics config set-provider ollama llama3.3   # free, local'));
  console.log('');

  console.log(chalk.dim('  ────────────────────────────────────────────────'));
  console.log('  Run `agent-analytics doctor` again after syncing to verify your setup.');
  console.log('');
}
