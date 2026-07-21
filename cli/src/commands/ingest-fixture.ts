import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { getDb } from '../db/client.js';
import {
  ingestSourceAdapter,
  parseCanonicalBatch,
  type CanonicalBatch,
  type SourceAdapter,
  type SourceArtifact,
} from '../canonical/ingestion.js';

function readCanonicalBatch(filePath: string): CanonicalBatch {
  return parseCanonicalBatch(JSON.parse(readFileSync(resolve(filePath), 'utf8')));
}

export async function ingestFixtureCommand(filePath: string): Promise<void> {
  const batch = readCanonicalBatch(filePath);
  const adapter: SourceAdapter = {
    name: 'canonical-fixture',
    async discover(): Promise<SourceArtifact[]> {
      return [batch.artifact];
    },
    async parse(_artifact, context): Promise<CanonicalBatch> {
      return {
        ...batch,
        previousCursor: context.currentCursor,
        nextCursor: context.currentCursor && context.currentCursor.position > batch.nextCursor.position
          ? context.currentCursor
          : batch.nextCursor,
      };
    },
  };
  const summary = await ingestSourceAdapter(adapter, getDb());
  process.stdout.write(`${JSON.stringify(summary)}\n`);
}
