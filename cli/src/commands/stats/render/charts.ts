import { colors } from './colors.js';
import type { Period } from '../data/types.js';

const SPARK_CHARS = ['▁', '▂', '▃', '▅', '▇'];

export function sparkline(values: number[]): string {
  if (values.length === 0) return '';
  const max = Math.max(...values);
  return values
    .map(v => {
      if (max === 0) return SPARK_CHARS[0];
      const idx = Math.round((v / max) * 4);
      return SPARK_CHARS[idx];
    })
    .map(char => colors.sparkChar(char))
    .join('');
}

export function sparklineLabels(period: Period): string {
  if (period === '7d') return 'M T W T F S S';
  if (period === '30d') return '';  // Too many daily labels
  return '';
}

export function barChart(
  items: { label: string; value: number; suffix: string }[],
  barWidth: number,
): string[] {
  if (items.length === 0) return [];

  if (barWidth === 0) {
    // Narrow terminal: simple list format
    return items.map(item =>
      `  ${colors.project(item.label.padEnd(20))}  ${item.suffix}`
    );
  }

  const maxValue = Math.max(...items.map(i => i.value));
  const maxLabelLen = Math.min(20, Math.max(...items.map(i => i.label.length)));

  return items.map(item => {
    const label = item.label.length > 20
      ? item.label.slice(0, 17) + '...'
      : item.label;
    const paddedLabel = label.padEnd(maxLabelLen);

    const filled = maxValue === 0 ? 0 : Math.round((item.value / maxValue) * barWidth);
    const empty = barWidth - filled;

    const bar = colors.barFilled('█'.repeat(filled))
              + colors.barEmpty('░'.repeat(empty));

    return `  ${colors.project(paddedLabel)}  ${bar}  ${item.suffix}`;
  });
}
