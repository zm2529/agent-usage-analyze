import chalk from 'chalk';
import { colors } from './colors.js';

export function getTerminalWidth(): number {
  return process.stdout.columns || 80;
}

export function getBarWidth(): number {
  const width = getTerminalWidth();
  if (width >= 100) return 20;
  if (width >= 80) return 16;
  if (width >= 60) return 12;
  return 0;
}

export function getGridColumns(): number {
  const width = getTerminalWidth();
  if (width >= 80) return 3;
  if (width >= 60) return 2;
  return 1;
}

export function sectionHeader(title: string, rightText?: string): string {
  const width = getTerminalWidth() - 4;
  const header = colors.header(title.toUpperCase());
  const right = rightText ? colors.label(rightText) : '';
  const gap = width - title.length - (rightText?.length ?? 0);
  return `\n  ${header}${' '.repeat(Math.max(1, gap))}${right}\n  ${colors.divider(width)}`;
}

export function metricGrid(metrics: { label: string; value: string }[]): string {
  const cols = getGridColumns();
  const colWidth = cols === 3 ? 22 : cols === 2 ? 30 : 40;
  const lines: string[] = [];

  for (let i = 0; i < metrics.length; i += cols) {
    const row = metrics.slice(i, i + cols);
    const formatted = row.map(m =>
      `${colors.label(m.label.padEnd(10))} ${colors.value(m.value.padStart(colWidth - 12))}`
    );
    lines.push('  ' + formatted.join('  '));
  }

  return lines.join('\n');
}

export function projectCardHeader(name: string): string {
  const width = getTerminalWidth() - 4;
  const nameSection = `${chalk.gray('─ ')}${chalk.white.bold(name)} `;
  const remaining = width - name.length - 3;
  return `\n  ${nameSection}${chalk.gray('─'.repeat(Math.max(0, remaining)))}`;
}
