import { CodexRolloutAdapter } from '../canonical/codex-rollout.js';
import { ingestSourceAdapter } from '../canonical/ingestion.js';
import { getDb } from '../db/client.js';

export async function importCodexCommand(options: { home?: string }): Promise<void> {
  const summary = await ingestSourceAdapter(new CodexRolloutAdapter(options.home), getDb());
  process.stdout.write(`${JSON.stringify(summary)}\n`);
}
