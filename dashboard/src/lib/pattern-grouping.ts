import { parseJsonField } from '@/lib/types';
import type { Insight } from '@/lib/types';

/**
 * Union-Find with iterative path compression.
 * Groups insights that share linked_insight_ids.
 */
function find(parent: Map<string, string>, id: string): string {
  if (!parent.has(id)) parent.set(id, id);
  let root = id;
  while (parent.get(root) !== root) {
    root = parent.get(root)!;
  }
  // Path compression
  let current = id;
  while (current !== root) {
    const next = parent.get(current)!;
    parent.set(current, root);
    current = next;
  }
  return root;
}

function union(parent: Map<string, string>, a: string, b: string) {
  const ra = find(parent, a);
  const rb = find(parent, b);
  if (ra !== rb) parent.set(ra, rb);
}

export function buildPatternGroups(insights: Insight[]): Map<string, Set<string>> {
  const linkedToInsights = new Map<string, Set<string>>();
  for (const insight of insights) {
    const linkedIds = insight.linked_insight_ids
      ? parseJsonField<string[]>(insight.linked_insight_ids, [])
      : [];
    for (const linkedId of linkedIds) {
      const set = linkedToInsights.get(linkedId) || new Set();
      set.add(insight.id);
      linkedToInsights.set(linkedId, set);
    }
  }

  const parent = new Map<string, string>();
  for (const [, insightIds] of linkedToInsights) {
    const arr = [...insightIds];
    for (let i = 1; i < arr.length; i++) {
      union(parent, arr[0], arr[i]);
    }
  }

  const groups = new Map<string, Set<string>>();
  for (const [, insightIds] of linkedToInsights) {
    for (const id of insightIds) {
      const root = find(parent, id);
      const set = groups.get(root) || new Set();
      set.add(id);
      groups.set(root, set);
    }
  }

  return groups;
}
