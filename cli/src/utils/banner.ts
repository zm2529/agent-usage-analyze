import chalk from 'chalk';
import { readFileSync } from 'fs';

const LOGO_ART = `
   ____          _        ___           _       _     _
  / ___|___   __| | ___  |_ _|_ __  ___(_) __ _| |__ | |_ ___
 | |   / _ \\ / _\` |/ _ \\  | || '_ \\/ __| |/ _\` | '_ \\| __/ __|
 | |__| (_) | (_| |  __/  | || | | \\__ \\ | (_| | | | | |_\\__ \\
  \\____\\___/ \\__,_|\\___| |___|_| |_|___/_|\\__, |_| |_|\\__|___/
                                           |___/`;

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
 * Print the branded ASCII art banner.
 * Purple logo text with a dim version tag on the last line.
 */
export function printBanner(): void {
  const version = getVersion();
  const versionTag = version ? chalk.dim(` v${version}`) : '';
  console.log(purple(LOGO_ART) + versionTag);
  console.log('');
}
