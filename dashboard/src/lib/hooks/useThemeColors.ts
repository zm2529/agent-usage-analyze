import { useMemo } from 'react';

/**
 * Returns resolved colors for use in Recharts inline styles.
 * Uses fixed light-mode hex values — the dashboard doesn't currently
 * support dark mode switching via next-themes, so we default to light.
 */
export function useThemeColors() {
  return useMemo(() => ({
    tooltipBg: 'oklch(1 0 0)',
    tooltipBorder: 'oklch(0.922 0 0)',
  }), []);
}
