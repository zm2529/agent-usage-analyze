import { readFileSync } from 'node:fs';
import { getDb } from '../db/client.js';
import {
  buildGitAiSidecar,
  configureGitAiSidecar,
  inspectGitAiSidecar,
  verifyGitAiVendor,
  type GitAiSidecarConfig,
} from '../sidecars/git-ai-manager.js';
import {
  runGitAiProspectiveGate,
  type GitAiGateReport,
  type GitAiProspectiveEvidenceEnvelope,
} from '../canonical/git-ai-gate.js';

function emit<T>(value: T): T {
  console.log(JSON.stringify(value));
  return value;
}

export function gitAiSidecarVerifyCommand() {
  return emit(verifyGitAiVendor());
}

export function gitAiSidecarBuildCommand(options: { allowNetwork?: boolean } = {}) {
  return emit(buildGitAiSidecar({ allowNetwork: options.allowNetwork }));
}

export function gitAiSidecarConfigureCommand(options: {
  binary: string;
  enable?: boolean;
  notesExport?: GitAiSidecarConfig['notesExportPolicy'];
}) {
  return emit(configureGitAiSidecar({
    binaryPath: options.binary,
    enabled: options.enable ?? false,
    notesExportPolicy: options.notesExport ?? 'local-only',
  }));
}

export function gitAiSidecarInspectCommand(options: { repository?: string }) {
  return emit(inspectGitAiSidecar({ repositoryPath: options.repository }));
}

export function gitAiProspectiveGateCommand(
  evidencePath: string,
  options: { repository: string },
): GitAiGateReport {
  const evidence = JSON.parse(readFileSync(evidencePath, 'utf8')) as GitAiProspectiveEvidenceEnvelope;
  return emit(runGitAiProspectiveGate(getDb(), { repositoryPath: options.repository, evidence }));
}
