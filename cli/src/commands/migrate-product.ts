import chalk from 'chalk';
import { closeDb, getDbPath } from '../db/client.js';
import { expandProjectContract } from '../db/product-migration.js';

export function migrateProductCommand(): void {
  closeDb();
  const result = expandProjectContract({ dbPath: getDbPath() });
  console.log(chalk.green(`Product database: ${result.status} (V${result.targetSchemaVersion})`));
  if (result.backupPath) console.log(chalk.gray(`Backup: ${result.backupPath}`));
  console.log(chalk.gray(`Migration report: ${result.reportPath}`));
}
