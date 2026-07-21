import chalk from 'chalk';

export const colors = {
  // Structural
  header:     (text: string) => chalk.cyan.bold(text),
  label:      (text: string) => chalk.gray(text),
  value:      (text: string) => chalk.white.bold(text),
  divider:    (width: number) => chalk.gray('─'.repeat(width)),
  hint:       (text: string) => chalk.gray.italic(`  → ${text}`),

  // Money — color-coded by amount
  money:      (amount: number) => {
    const formatted = `$${amount.toFixed(2)}`;
    if (amount >= 20) return chalk.red.bold(formatted);
    if (amount >= 5) return chalk.yellow.bold(formatted);
    return chalk.green.bold(formatted);
  },
  moneyNeutral: (amount: number) => chalk.green.bold(`$${amount.toFixed(2)}`),

  // Data types
  project:    (name: string) => chalk.white(name),
  model:      (name: string) => chalk.magenta(name),
  source:     (name: string) => chalk.blue(name),
  timestamp:  (text: string) => chalk.gray(text),

  // States
  success:    (text: string) => chalk.green(text),
  warning:    (text: string) => chalk.yellow(text),
  error:      (text: string) => chalk.red(text),

  // Charts
  sparkChar:  (char: string) => chalk.cyan(char),
  barFilled:  (chars: string) => chalk.cyan(chars),
  barEmpty:   (chars: string) => chalk.gray(chars),

  // Session characters — color-coded by type
  character: (char: string): string => {
    const map: Record<string, (s: string) => string> = {
      deep_focus:    chalk.blue,
      bug_hunt:      chalk.red,
      feature_build: chalk.green,
      exploration:   chalk.yellow,
      refactor:      chalk.magenta,
      learning:      chalk.cyan,
      quick_task:    chalk.gray,
    };
    const display = char.replace(/_/g, ' ');
    return (map[char] ?? chalk.gray)(`[${display}]`);
  },
};
