import { readFileSync } from 'node:fs';
import { getDb } from '../db/client.js';
import {
  runBuildermarkGate,
  type BuildermarkEvidenceEnvelope,
  type BuildermarkGateReport,
} from '../canonical/buildermark-gate.js';

export function buildermarkGateCommand(
  evidencePath: string,
  options: { repository: string },
): BuildermarkGateReport {
  const evidence = JSON.parse(readFileSync(evidencePath, 'utf8')) as BuildermarkEvidenceEnvelope;
  const report = runBuildermarkGate(getDb(), { repositoryPath: options.repository, evidence });
  console.log(JSON.stringify(report));
  return report;
}
