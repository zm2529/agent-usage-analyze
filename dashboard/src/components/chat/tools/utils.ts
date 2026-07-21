/** Parse JSON input safely, return empty object on failure. */
export function parseToolInput(input: string): Record<string, unknown> {
  try { return JSON.parse(input); } catch { return {}; }
}
