import inquirer from 'inquirer';
import chalk from 'chalk';
import { saveConfig, getConfigDir, isConfigured } from '../utils/config.js';
import { getDb } from '../db/client.js';
import { trackEvent, captureError, classifyError } from '../utils/telemetry.js';
import type { ClaudeInsightConfig } from '../types.js';

export interface InitOptions {
  // No options needed for local-first setup
}

/**
 * Initialize Agent Analytics configuration.
 * Sets up sync preferences and initializes the local SQLite database.
 */
export async function initCommand(_options: InitOptions = {}): Promise<void> {
  console.log(chalk.cyan('\n  Agent Analytics Setup\n'));

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

  // Save minimal config
  const config: ClaudeInsightConfig = {
    sync: { claudeDir: '~/.claude/projects', excludeProjects: [] },
  };
  saveConfig(config);

  // Initialize database (creates schema if first run)
  try {
    getDb();
    console.log(chalk.green('\n  Database initialized at ~/.agent-analytics/data.db'));
  } catch (error) {
    console.log(chalk.red(`\n  Database initialization failed: ${error instanceof Error ? error.message : 'Unknown error'}`));
    const { error_type, error_message } = classifyError(error);
    trackEvent('cli_init', { success: false, error_type, error_message });
    captureError(error, { command: 'init', error_type });
    process.exit(1);
  }

  console.log(chalk.green('\n  Configuration saved!'));
  console.log(chalk.gray(`  Config location: ${getConfigDir()}/config.json`));

  console.log(chalk.cyan('\n  Setup complete! You can now run:\n'));
  console.log(chalk.gray('     agent-analytics              # sync + open dashboard'));
  console.log(chalk.gray('     agent-analytics stats        # terminal analytics'));
  console.log(chalk.gray('     agent-analytics config llm   # configure AI analysis (optional)\n'));

  trackEvent('cli_init', { success: true });
}
