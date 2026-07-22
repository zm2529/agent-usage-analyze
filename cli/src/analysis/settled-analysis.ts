import type Database from 'better-sqlite3';
import { runInsightsCommand, StaleAnalysisGenerationError } from '../commands/insights.js';
import { ClaudeNativeRunner } from './native-runner.js';
import { CodexNativeRunner } from './codex-native-runner.js';
import { ProviderRunner } from './provider-runner.js';
import type { EffectiveAnalysisRunner } from './execution-policy.js';
import type { AnalysisRunner } from './runner-types.js';
import type { ClaimedSettledImport } from './settled-import.js';

export interface SettledAnalysisSelection {
  effectiveRunner: EffectiveAnalysisRunner;
  reason: string;
  model?: string;
}

export interface SettledAnalysisDependencies {
  now(): Date;
  buildRunner(selection: SettledAnalysisSelection): AnalysisRunner | null;
  analyze(
    sessionId: string,
    runner: AnalysisRunner,
    commitGuard: () => boolean,
    finalize: () => boolean,
  ): Promise<void>;
}

export interface SettledAnalysisResult {
  status: 'completed' | 'awaiting-capability' | 'stale';
  diagnostic: string | null;
}

const REMOTE_RUNNERS = new Set<EffectiveAnalysisRunner>([
  'provider', 'codex-native', 'claude-native',
]);

export function defaultSettledAnalysisDependencies(): SettledAnalysisDependencies {
  return {
    now: () => new Date(),
    buildRunner: (selection) => {
      switch (selection.effectiveRunner) {
        case 'provider': return ProviderRunner.fromConfig();
        case 'codex-native': return new CodexNativeRunner({ model: selection.model });
        case 'claude-native': return new ClaudeNativeRunner();
        default: return null;
      }
    },
    analyze: (sessionId, runner, commitGuard, finalize) => runInsightsCommand({
      sessionId, native: false, force: true, quiet: true,
      _runner: runner, _commitGuard: commitGuard, _automaticPrivacy: true,
      _finalize: finalize,
    }),
  };
}

/** Analyze only the compatibility projection belonging to the claimed generation. */
export async function processSettledAnalysis(
  db: Database.Database,
  claimed: ClaimedSettledImport,
  selection: SettledAnalysisSelection,
  deps: SettledAnalysisDependencies,
): Promise<SettledAnalysisResult> {
  if (!REMOTE_RUNNERS.has(selection.effectiveRunner)) {
    const current = db.prepare(`SELECT 1 FROM analysis_queue
      WHERE source_tool = ? AND session_id = ? AND generation = ? AND status = 'awaiting-capability'`)
      .get(claimed.sourceTool, claimed.sessionId, claimed.generation);
    if (!current) return { status: 'stale', diagnostic: null };
    db.prepare(`UPDATE analysis_queue SET diagnostic = ?
      WHERE source_tool = ? AND session_id = ? AND generation = ? AND status = 'awaiting-capability'`)
      .run(selection.reason, claimed.sourceTool, claimed.sessionId, claimed.generation);
    return { status: 'awaiting-capability', diagnostic: selection.reason };
  }

  const claimedForAnalysis = db.prepare(`UPDATE analysis_queue
    SET status = 'processing', started_at = ?, completed_at = NULL, diagnostic = ?
    WHERE source_tool = ? AND session_id = ? AND generation = ? AND status = 'awaiting-capability'`)
    .run(
      deps.now().toISOString(), selection.reason,
      claimed.sourceTool, claimed.sessionId, claimed.generation,
    ).changes === 1;
  if (!claimedForAnalysis) return { status: 'stale', diagnostic: null };

  const runner = deps.buildRunner(selection);
  if (!runner) {
    db.prepare(`UPDATE analysis_queue SET status = 'awaiting-capability', started_at = NULL
      WHERE source_tool = ? AND session_id = ? AND generation = ? AND status = 'processing'`)
      .run(claimed.sourceTool, claimed.sessionId, claimed.generation);
    return { status: 'awaiting-capability', diagnostic: selection.reason };
  }

  const commitGuard = () => Boolean(db.prepare(`SELECT 1 FROM analysis_queue
    WHERE source_tool = ? AND session_id = ? AND generation = ? AND status = 'processing'`)
    .get(claimed.sourceTool, claimed.sessionId, claimed.generation));
  const finalize = () => db.prepare(`UPDATE analysis_queue
    SET status = 'completed', completed_at = ?, started_at = NULL, diagnostic = ?, error_message = NULL
    WHERE source_tool = ? AND session_id = ? AND generation = ? AND status = 'processing'`)
    .run(
      deps.now().toISOString(), selection.reason,
      claimed.sourceTool, claimed.sessionId, claimed.generation,
    ).changes === 1;
  try {
    await deps.analyze(`codex:${claimed.sessionId}`, runner, commitGuard, finalize);
  } catch (error) {
    if (error instanceof StaleAnalysisGenerationError) {
      return { status: 'stale', diagnostic: null };
    }
    throw error;
  }

  const completed = Boolean(db.prepare(`SELECT 1 FROM analysis_queue
    WHERE source_tool = ? AND session_id = ? AND generation = ? AND status = 'completed'`)
    .get(claimed.sourceTool, claimed.sessionId, claimed.generation));
  return completed
    ? { status: 'completed', diagnostic: selection.reason }
    : { status: 'stale', diagnostic: null };
}
