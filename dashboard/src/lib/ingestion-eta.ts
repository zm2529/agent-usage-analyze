export interface ProgressSample {
  completed: number;
  at: number;
}

export function estimateRemainingMs(
  samples: ProgressSample[],
  total: number,
): number | null {
  if (samples.length < 2 || total <= 0) return null;
  const latest = samples.at(-1)!;
  if (latest.completed >= total || latest.completed < Math.min(20, Math.ceil(total * 0.02))) return null;
  const windowStart = Math.max(0, samples.length - 8);
  const recent = samples.slice(windowStart);
  const first = recent[0]!;
  const elapsed = latest.at - first.at;
  const processed = latest.completed - first.completed;
  if (elapsed < 5_000 || processed <= 0) return null;
  const rate = processed / elapsed;
  return Math.max(0, (total - latest.completed) / rate);
}
