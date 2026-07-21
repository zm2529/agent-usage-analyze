// Prompt quality category labels and type detection for dashboard rendering.
// Category normalization happens server-side at write time — client only needs display helpers.
// Keep in sync with server/src/llm/prompt-quality-normalize.ts (labels and strength set).

const PQ_CATEGORY_LABELS: Record<string, string> = {
  'vague-request': 'Vague Request',
  'missing-context': 'Missing Context',
  'late-constraint': 'Late Constraint',
  'unclear-correction': 'Unclear Correction',
  'scope-drift': 'Scope Drift',
  'missing-acceptance-criteria': 'Missing Acceptance Criteria',
  'assumption-not-surfaced': 'Assumption Not Surfaced',
  'precise-request': 'Precise Request',
  'effective-context': 'Effective Context',
  'productive-correction': 'Productive Correction',
};

const STRENGTH_CATEGORIES = new Set([
  'precise-request', 'effective-context', 'productive-correction',
]);

export function getPQCategoryLabel(category: string): string {
  if (PQ_CATEGORY_LABELS[category]) return PQ_CATEGORY_LABELS[category];
  return category
    .split('-')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

export function getPQCategoryType(category: string): 'deficit' | 'strength' {
  return STRENGTH_CATEGORIES.has(category) ? 'strength' : 'deficit';
}
