/**
 * Parse an integer query parameter with a safe default.
 * Returns the default if the value is missing, NaN, negative, or non-finite.
 */
export function parseIntParam(value: string | undefined, defaultVal: number): number {
  const n = value !== undefined ? parseInt(value, 10) : defaultVal;
  return Number.isFinite(n) && n >= 0 ? n : defaultVal;
}

/**
 * Safely parse a JSON-encoded string field from SQLite.
 * Returns defaultValue if the field is null, empty, or invalid JSON.
 * Mirrors dashboard/src/lib/types.ts parseJsonField — keep in sync.
 */
export function safeParseJson<T>(value: string | null | undefined, defaultValue: T): T {
  if (!value) return defaultValue;
  try {
    return JSON.parse(value) as T;
  } catch {
    return defaultValue;
  }
}
