// ──────────────────────────────────────────────────────
// Fuzzy string matching utilities
//
// Shared between FirestoreDataSource and LocalDataSource
// for --project name resolution.
// ──────────────────────────────────────────────────────

/** Standard Levenshtein distance between two strings */
export function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));

  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,      // deletion
        dp[i][j - 1] + 1,      // insertion
        dp[i - 1][j - 1] + cost // substitution
      );
    }
  }

  return dp[m][n];
}

/** Returns candidate names within maxDistance, sorted by distance */
export function findSimilarNames(input: string, candidates: string[], maxDistance = 3): string[] {
  const lower = input.toLowerCase();
  return candidates
    .map((name) => ({ name, distance: levenshtein(lower, name.toLowerCase()) }))
    .filter(({ distance }) => distance <= maxDistance)
    .sort((a, b) => a.distance - b.distance)
    .map(({ name }) => name);
}
