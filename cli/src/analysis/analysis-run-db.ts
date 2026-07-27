import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { getDb } from '../db/client.js';

export type AnalysisRunStatus = 'completed' | 'unavailable' | 'failed' | 'rejected';

export interface AnalysisRunRecord {
  id: string;
  analysisType: string;
  sessionId: string | null;
  status: AnalysisRunStatus;
  unavailableReason: string | null;
  provider: string | null;
  model: string | null;
  promptVersion: string;
  systemPrompt: string | null;
  inputPrompt: string | null;
  inputSummary: Record<string, unknown>;
  outputJson: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  durationMs: number | null;
  createdAt: string;
}

export interface RecordAnalysisRunInput {
  analysisType: string;
  sessionId?: string | null;
  status: AnalysisRunStatus;
  unavailableReason?: string | null;
  provider?: string | null;
  model?: string | null;
  promptVersion: string;
  systemPrompt?: string | null;
  inputPrompt?: string | null;
  inputSummary: Record<string, unknown>;
  outputJson?: string | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  durationMs?: number | null;
}

export function recordAnalysisRun(
  input: RecordAnalysisRunInput,
  db: Database.Database = getDb(),
): string {
  const id = `analysis-run:${randomUUID()}`;
  db.prepare(`INSERT INTO analysis_runs (
    id, analysis_type, session_id, status, unavailable_reason, provider, model,
    prompt_version, system_prompt, input_prompt, input_summary_json, output_json,
    input_tokens, output_tokens, duration_ms
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    id, input.analysisType, input.sessionId ?? null, input.status,
    input.unavailableReason ?? null, input.provider ?? null, input.model ?? null,
    input.promptVersion, input.systemPrompt ?? null, input.inputPrompt ?? null,
    JSON.stringify(input.inputSummary), input.outputJson ?? null,
    input.inputTokens ?? null, input.outputTokens ?? null, input.durationMs ?? null,
  );
  return id;
}

/**
 * A session worker can briefly hold SQLite's single-writer slot while it
 * commits a large analysis packet. Keep an already-computed LLM result in
 * memory and retry only the immutable ledger insert instead of rerunning the
 * model or failing the whole report.
 */
export async function recordAnalysisRunWithRetry(
  input: RecordAnalysisRunInput,
  db: Database.Database = getDb(),
  options: { attempts?: number; delayMs?: number } = {},
): Promise<string> {
  const attempts = Math.max(1, options.attempts ?? 4);
  const delayMs = Math.max(1, options.delayMs ?? 250);
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return recordAnalysisRun(input, db);
    } catch (error) {
      const code = (error as { code?: unknown }).code;
      if ((code !== 'SQLITE_BUSY' && code !== 'SQLITE_LOCKED') || attempt === attempts) throw error;
      await new Promise((resolve) => setTimeout(resolve, delayMs * attempt));
    }
  }
  throw new Error('unreachable analysis-run retry state');
}

export function listAnalysisRuns(
  filter: { sessionId?: string; analysisType?: string; limit?: number } = {},
  db: Database.Database = getDb(),
): AnalysisRunRecord[] {
  const conditions: string[] = [];
  const params: Array<string | number> = [];
  if (filter.sessionId) {
    conditions.push('session_id = ?');
    params.push(filter.sessionId);
  }
  if (filter.analysisType) {
    conditions.push('analysis_type = ?');
    params.push(filter.analysisType);
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const rows = db.prepare(`SELECT id, analysis_type AS analysisType,
    session_id AS sessionId, status, unavailable_reason AS unavailableReason,
    provider, model, prompt_version AS promptVersion, system_prompt AS systemPrompt,
    input_prompt AS inputPrompt, input_summary_json AS inputSummaryJson,
    output_json AS outputJson, input_tokens AS inputTokens,
    output_tokens AS outputTokens, duration_ms AS durationMs, created_at AS createdAt
    FROM analysis_runs ${where}
    ORDER BY created_at DESC, id DESC LIMIT ?`).all(...params, Math.min(filter.limit ?? 100, 500)) as Array<{
      id: string; analysisType: string; sessionId: string | null; status: AnalysisRunStatus;
      unavailableReason: string | null; provider: string | null; model: string | null;
      promptVersion: string; systemPrompt: string | null; inputPrompt: string | null;
      inputSummaryJson: string; outputJson: string | null; inputTokens: number | null;
      outputTokens: number | null; durationMs: number | null; createdAt: string;
    }>;
  return rows.map(({ inputSummaryJson, ...row }) => ({
    ...row,
    inputSummary: JSON.parse(inputSummaryJson) as Record<string, unknown>,
  }));
}
