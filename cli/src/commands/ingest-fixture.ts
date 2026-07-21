import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { getDb } from '../db/client.js';
import {
  ingestSourceAdapter,
  type CanonicalBatch,
  type SourceAdapter,
  type SourceArtifact,
} from '../canonical/ingestion.js';

function readCanonicalBatch(filePath: string): CanonicalBatch {
  const parsed = JSON.parse(readFileSync(resolve(filePath), 'utf8')) as Partial<CanonicalBatch>;
  if (!parsed.artifact || !parsed.era || !Array.isArray(parsed.events) || !parsed.coverage) {
    throw new Error('Fixture must contain artifact, era, events, and coverage');
  }
  if (typeof parsed.nextCursor !== 'string' || !Array.isArray(parsed.diagnostics)) {
    throw new Error('Fixture must contain diagnostics and nextCursor');
  }
  return parsed as CanonicalBatch;
}

export async function ingestFixtureCommand(filePath: string): Promise<void> {
  const batch = readCanonicalBatch(filePath);
  const adapter: SourceAdapter = {
    name: 'canonical-fixture',
    async discover(): Promise<SourceArtifact[]> {
      return [batch.artifact];
    },
    async parse(): Promise<CanonicalBatch> {
      return batch;
    },
  };
  const summary = await ingestSourceAdapter(adapter, getDb());
  process.stdout.write(`${JSON.stringify(summary)}\n`);
}
