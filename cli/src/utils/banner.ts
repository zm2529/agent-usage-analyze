import chalk from 'chalk';
import { readFileSync } from 'fs';

const purple = chalk.hex('#8b5cf6');

function getVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf-8'));
    return pkg.version ?? '';
  } catch {
    return '';
  }
}

/**
 * Print the compact product banner without inherited upstream artwork.
 */
export function printBanner(): void {
  const version = getVersion();
  const versionTag = version ? chalk.dim(` v${version}`) : '';
  console.log(purple.bold('  AGENT USAGE ANALYZER') + versionTag);
  console.log('');
}
