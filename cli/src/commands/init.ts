import inquirer from 'inquirer';
import chalk from 'chalk';
import { saveConfig, getConfigDir, getInstallationId, isConfigured } from '../utils/config.js';
import { getDb } from '../db/client.js';
import { trackEvent, captureError, classifyError } from '../utils/telemetry.js';
import type { ClaudeInsightConfig } from '../types.js';

export interface InitOptions {
  // No options needed for local-first setup
}

export interface LocalSetupResult {
  configCreated: boolean;
  configDir: string;
}

/**
 * Create the minimum private local state required by every command.
 * This is intentionally idempotent so the one-command startup path never
 * overwrites an existing configuration.
 */
export function ensureLocalSetup(): LocalSetupResult {
  const configCreated = !isConfigured();
  if (configCreated) {
    // `sync` is retained in the on-disk schema for backwards compatibility.
    // Codex ingestion itself reads from the canonical rollout adapter.
    const config: ClaudeInsightConfig = {
      sync: { excludeProjects: [] },
      dashboard: { analysis: { mode: 'auto' } },
    };
    saveConfig(config);
  }

  getInstallationId();
  getDb();
  return { configCreated, configDir: getConfigDir() };
}

/**
 * Initialize Agent Usage Analyzer configuration.
 * Sets up sync preferences and initializes the local SQLite database.
 */
export async function initCommand(_options: InitOptions = {}): Promise<void> {
  console.log(chalk.cyan('\n  Agent Usage Analyzer Setup\n'));

  if (isConfigured()) {
    const { overwrite } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'overwrite',
        message: 'Configuration already exists. Overwrite?',
        default: false,
      },
    ]);

    if (!overwrite) {
      console.log(chalk.yellow('Setup cancelled.'));
      return;
    }
  }

  // Initialize private config and database (creates schema if first run)
  try {
    ensureLocalSetup();
    console.log(chalk.green(`\n  Database initialized at ${getConfigDir()}/data.db`));
  } catch (error) {
    console.log(chalk.red(`\n  Database initialization failed: ${error instanceof Error ? error.message : 'Unknown error'}`));
    const { error_type, error_message } = classifyError(error);
    trackEvent('cli_init', { success: false, error_type, error_message });
    captureError(error, { command: 'init', error_type });
    process.exit(1);
  }

  console.log(chalk.green('\n  Configuration saved!'));
  console.log(chalk.gray(`  Config location: ${getConfigDir()}/config.json`));

  console.log(chalk.cyan('\n  Setup complete! Start with:\n'));
  console.log(chalk.white('     agent-usage-analyze start'));
  console.log(chalk.gray('     Syncs supported agents, optimizes Codex capture, and opens the dashboard.\n'));

  trackEvent('cli_init', { success: true });
}
