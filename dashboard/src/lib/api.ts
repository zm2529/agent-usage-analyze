// HTTP client for the Hono API server.
// Base URL is relative in production (SPA served by the same server).
// In Vite dev mode, the proxy forwards /api -> localhost:7890.

import type { Project, Session, Message, Insight, AnalysisRunRecord, BehaviorReportState, DashboardStats, OverviewAnalytics, OverviewRange, LLMConfig, RuntimeConfig, ExportTemplate, FacetRow, IngestionHealth, HistorySyncResult, PatternOverview, WorkTaskNode, WorkTaskDetail, TrendComparison, Delivery, DeliveryDetail, TaskDeliveryCandidate, BuildermarkGateState, GitAiSidecarState, SemanticAnalysisPreview, SemanticClaim, SemanticAnalysisRun, ScorecardVersion, ScorecardResult, ObserverOverhead, CodexAccountUsage } from '@/lib/types';

const BASE = '/api';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  // Only set Content-Type when a body is present — setting it on GET requests
  // adds unnecessary headers and can confuse some intermediaries.
  const headers: Record<string, string> = { ...(init?.headers as Record<string, string>) };
  if (init?.body) {
    headers['Content-Type'] = 'application/json';
  }
  const res = await fetch(`${BASE}${path}`, { ...init, headers });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`API ${res.status}: ${text}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

// ── Projects ──────────────────────────────────────────────────────────────────

export function fetchProjects() {
  return request<{ projects: Project[] }>('/projects');
}

export function fetchProject(id: string) {
  return request<{ project: Project }>(`/projects/${id}`);
}

// ── Sessions ──────────────────────────────────────────────────────────────────

export function fetchSessions(params?: {
  projectId?: string;
  sourceTool?: string;
  limit?: number;
  offset?: number;
  q?: string;
  from?: string;
  to?: string;
  analysisStatus?: 'analyzed' | 'unanalyzed';
}) {
  const q = new URLSearchParams();
  if (params?.projectId) q.set('projectId', params.projectId);
  if (params?.sourceTool) q.set('sourceTool', params.sourceTool);
  if (params?.limit !== undefined) q.set('limit', String(params.limit));
  if (params?.offset !== undefined) q.set('offset', String(params.offset));
  if (params?.q) q.set('q', params.q);
  if (params?.from) q.set('from', params.from);
  if (params?.to) q.set('to', params.to);
  if (params?.analysisStatus) q.set('analysisStatus', params.analysisStatus);
  const qs = q.toString() ? `?${q.toString()}` : '';
  return request<{ sessions: Session[]; hasMore: boolean }>(`/sessions${qs}`);
}

export function fetchSession(id: string) {
  return request<{ session: Session }>(`/sessions/${id}`);
}

export function patchSession(id: string, body: { customTitle: string }) {
  return request<{ ok: boolean }>(`/sessions/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

export function deleteSession(id: string) {
  return request<{ ok: boolean }>(`/sessions/${id}`, { method: 'DELETE' });
}

export function fetchDeletedSessionCount(projectId?: string) {
  const q = projectId ? `?projectId=${encodeURIComponent(projectId)}` : '';
  return request<{ count: number }>(`/sessions/deleted/count${q}`);
}

// ── Messages ──────────────────────────────────────────────────────────────────

export function fetchMessages(sessionId: string, params?: { limit?: number; offset?: number }) {
  const q = new URLSearchParams();
  if (params?.limit !== undefined) q.set('limit', String(params.limit));
  if (params?.offset !== undefined) q.set('offset', String(params.offset));
  const qs = q.toString() ? `?${q.toString()}` : '';
  return request<{ messages: Message[] }>(`/messages/${sessionId}${qs}`);
}

// ── Insights ──────────────────────────────────────────────────────────────────

export function fetchInsights(params?: {
  projectId?: string;
  sessionId?: string;
  type?: string;
}) {
  const q = new URLSearchParams();
  if (params?.projectId) q.set('projectId', params.projectId);
  if (params?.sessionId) q.set('sessionId', params.sessionId);
  if (params?.type) q.set('type', params.type);
  const qs = q.toString() ? `?${q.toString()}` : '';
  return request<{ insights: Insight[] }>(`/insights${qs}`);
}

export function deleteInsight(id: string) {
  return request<{ ok: boolean }>(`/insights/${id}`, { method: 'DELETE' });
}

export function fetchAnalysisRuns(params?: {
  sessionId?: string;
  analysisType?: string;
  limit?: number;
}) {
  const q = new URLSearchParams();
  if (params?.sessionId) q.set('sessionId', params.sessionId);
  if (params?.analysisType) q.set('analysisType', params.analysisType);
  if (params?.limit !== undefined) q.set('limit', String(params.limit));
  const qs = q.toString() ? `?${q.toString()}` : '';
  return request<{ runs: AnalysisRunRecord[] }>(`/analysis/runs${qs}`);
}

export interface AnalysisUsageSummary {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  estimatedCostUsd: number | null;
  updatedAt: string | null;
}

export function fetchAnalysisUsageSummary() {
  return request<AnalysisUsageSummary>('/analysis/usage/summary');
}

export function translateContent<T>(targetLanguage: 'en' | 'zh-CN', content: T) {
  type TranslationState = {
    status: 'queued' | 'running' | 'completed' | 'failed';
    jobId?: string;
    content?: T;
    cached?: boolean;
    error?: string;
  };
  const wait = () => new Promise((resolve) => setTimeout(resolve, 1_500));
  return (async () => {
    let state = await request<TranslationState>('/translate', {
      method: 'POST',
      body: JSON.stringify({ targetLanguage, content }),
    });
    const startedAt = Date.now();
    while ((state.status === 'queued' || state.status === 'running') && state.jobId) {
      if (Date.now() - startedAt > 330_000) throw new Error('Translation timed out');
      await wait();
      const [language, hash] = state.jobId.split(':');
      state = await request<TranslationState>(`/translate/${language}/${hash}`);
    }
    if (state.status === 'failed') throw new Error(state.error || 'Translation failed');
    if (state.status !== 'completed' || state.content === undefined) {
      throw new Error('Translation did not complete');
    }
    return { content: state.content, cached: Boolean(state.cached) };
  })();
}

export function fetchBehaviorReport() {
  return request<BehaviorReportState>('/behavior-report');
}

export function runBehaviorReport() {
  return request<{ accepted: true; generation: { running: boolean; startedAt: string | null } }>('/behavior-report/run', {
    method: 'POST',
  });
}

// ── Search ────────────────────────────────────────────────────────────────────

export interface SearchSessionResult {
  id: string;
  title: string;
  project_name: string;
  session_character: string | null;
  started_at: string;
  match_field: 'title' | 'summary';
  snippet: string;
}

export interface SearchInsightResult {
  id: string;
  title: string;
  type: string;
  project_name: string;
  session_id: string;
  created_at: string;
  snippet: string;
}

export function fetchSearch(params: { q: string; limit?: number }) {
  const q = new URLSearchParams();
  q.set('q', params.q);
  if (params.limit !== undefined) q.set('limit', String(params.limit));
  return request<{ sessions: SearchSessionResult[]; insights: SearchInsightResult[] }>(
    `/search?${q.toString()}`
  );
}

// ── Analytics ─────────────────────────────────────────────────────────────────

export function fetchDashboardStats(range: '7d' | '30d' | '90d' | 'all' = '7d') {
  return request<{ range: string; stats: DashboardStats }>(`/analytics/dashboard?range=${range}`);
}

export function fetchOverviewAnalytics(range: OverviewRange = '7d') {
  return request<OverviewAnalytics>(`/analytics/overview?range=${range}`);
}

export function fetchCodexAccountUsage() {
  return request<CodexAccountUsage>('/codex/usage');
}

export function analyzeSessionAutomatically(sessionId: string, force = false) {
  return request<{ success: boolean }>('/analysis/automatic-session', {
    method: 'POST', body: JSON.stringify({ sessionId, force }),
  });
}

export function fetchIngestionHealth() {
  return request<IngestionHealth>('/ingestion/health');
}

export function syncHistory(force = false) {
  return request<HistorySyncResult>('/ingestion/sync-history', {
    method: 'POST', body: JSON.stringify({ force }),
  });
}

export function fetchWorkTasks(params?: { limit?: number; offset?: number }) {
  const query = new URLSearchParams();
  if (params?.limit !== undefined) query.set('limit', String(params.limit));
  if (params?.offset !== undefined) query.set('offset', String(params.offset));
  const suffix = query.size > 0 ? `?${query.toString()}` : '';
  return request<{ tasks: WorkTaskNode[]; total: number }>(`/tasks${suffix}`);
}

export function fetchWorkTask(id: string) {
  return request<{ task: WorkTaskDetail }>(`/tasks/${encodeURIComponent(id)}`);
}

export function previewSemanticAnalysis(taskId: string) {
  return request<SemanticAnalysisPreview>('/semantic/preview', {
    method: 'POST', body: JSON.stringify({ taskId }),
  });
}

export function runSemanticAnalysis(taskId: string) {
  return request<
    | { status: 'accepted'; run: SemanticAnalysisRun; claims: SemanticClaim[] }
    | { status: 'disabled' | 'rejected' | 'failed'; reason: string; claims?: [] }
  >('/semantic/analyze', { method: 'POST', body: JSON.stringify({ taskId }) });
}

export function fetchSemanticClaims(taskId: string) {
  const query = new URLSearchParams({ taskId });
  return request<{ claims: SemanticClaim[] }>(`/semantic/claims?${query.toString()}`);
}

export function fetchScorecards(taskId?: string) {
  const query = taskId ? `?${new URLSearchParams({ taskId }).toString()}` : '';
  return request<{ versions: ScorecardVersion[]; results: ScorecardResult[] }>(`/scorecards${query}`);
}

export function fetchObserverOverhead() {
  return request<ObserverOverhead>('/observer-overhead');
}

export function recordAdvisoryOverhead(input: {
  claimId: string;
  action: 'shown' | 'adopted' | 'ignored' | 'dismissed';
}) {
  return request<{ recorded: boolean; degraded: boolean }>('/observer-overhead/advisory', {
    method: 'POST', body: JSON.stringify(input),
  });
}

export function fetchPatternTrends(currentStart: string, currentEnd: string) {
  const query = new URLSearchParams({ currentStart, currentEnd });
  return request<{ comparison: TrendComparison }>(`/patterns/trends?${query.toString()}`);
}

export function fetchPatternOverview() {
  return request<PatternOverview>('/patterns/overview');
}

export function fetchDeliveries() {
  return request<{ deliveries: Delivery[] }>('/deliveries');
}

export function discoverDeliveries() {
  return request<{ repositories: number; deliveries: number; failed: number }>('/deliveries/discover', { method: 'POST' });
}

export function recordTaskArtifact(taskId: string, relativePath: string) {
  return request<{ delivery: Delivery; candidate: TaskDeliveryCandidate }>('/deliveries/artifacts', {
    method: 'POST', body: JSON.stringify({ taskId, relativePath }),
  });
}

export function fetchDelivery(id: string) {
  return request<{ delivery: DeliveryDetail }>(`/deliveries/${encodeURIComponent(id)}`);
}

export function appendDeliveryCorrection(
  deliveryId: string,
  candidateId: string,
  decision: 'confirmed' | 'rejected' | 'pending',
) {
  return request<{ candidate: TaskDeliveryCandidate }>(
    `/deliveries/${encodeURIComponent(deliveryId)}/candidates/${encodeURIComponent(candidateId)}/corrections`,
    { method: 'POST', body: JSON.stringify({ decision }) },
  );
}

export function fetchBuildermarkGateState() {
  return request<BuildermarkGateState>('/buildermark-gate');
}

export function fetchGitAiSidecarState() {
  return request<GitAiSidecarState>('/git-ai-sidecar');
}

// ── Analysis (Phase 4) ────────────────────────────────────────────────────────

interface AnalysisApiResult {
  success: boolean;
  insights?: Array<{ id: string; type: string; title: string }>;
  error?: string;
  usage?: { inputTokens: number; outputTokens: number };
}

export function analyzeSession(sessionId: string) {
  return request<AnalysisApiResult>('/analysis/session', {
    method: 'POST',
    body: JSON.stringify({ sessionId }),
  });
}

// ── Config ────────────────────────────────────────────────────────────────────

export function fetchLlmConfig() {
  return request<LLMConfig>('/config/llm');
}

export function fetchRuntimeConfig() {
  return request<RuntimeConfig>('/config/runtime');
}

export function saveLlmConfig(body: {
  dashboardPort?: number;
  provider?: string;
  model?: string;
  apiKey?: string;
  baseUrl?: string;
  semanticAnalysisEnabled?: boolean;
  analysisMode?: import('./types').AnalysisExecutionMode;
  capabilities?: Partial<import('./types').AnalysisCapabilities>;
}) {
  return request<{ ok: boolean }>('/config/llm', {
    method: 'PUT',
    body: JSON.stringify(body),
  });
}

export function testLlmConfig(body?: {
  provider?: string;
  model?: string;
  apiKey?: string;
  baseUrl?: string;
}) {
  return request<{ success: boolean; error?: string }>('/config/llm/test', {
    method: 'POST',
    body: JSON.stringify(body ?? {}),
  });
}

export function fetchOllamaModels(baseUrl?: string) {
  const qs = baseUrl ? `?baseUrl=${encodeURIComponent(baseUrl)}` : '';
  return request<{ models: Array<{ name: string; size: number; modifiedAt: string }> }>(
    `/config/llm/ollama-models${qs}`
  );
}

export function fetchLlamaCppModels(baseUrl?: string) {
  const qs = baseUrl ? `?baseUrl=${encodeURIComponent(baseUrl)}` : '';
  return request<{ models: Array<{ id: string; object: string }> }>(
    `/config/llm/llamacpp-models${qs}`
  );
}

export function analyzePromptQuality(sessionId: string) {
  return request<AnalysisApiResult>('/analysis/prompt-quality', {
    method: 'POST',
    body: JSON.stringify({ sessionId }),
  });
}

// ── Export ────────────────────────────────────────────────────────────────────

export async function exportMarkdown(body: {
  sessionIds?: string[];
  projectId?: string;
  template?: ExportTemplate;
}): Promise<string> {
  const res = await fetch(`${BASE}/export/markdown`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`Export failed ${res.status}: ${text}`);
  }
  return res.text();
}

// ── LLM Export Generate ───────────────────────────────────────────────────────

export type ExportGenerateFormat = 'agent-rules' | 'knowledge-brief' | 'obsidian' | 'notion';
export type ExportGenerateScope = 'project' | 'all';
export type ExportGenerateDepth = 'essential' | 'standard' | 'comprehensive';

export interface ExportGenerateRequest {
  scope: ExportGenerateScope;
  projectId?: string;
  format: ExportGenerateFormat;
  depth?: ExportGenerateDepth;
}

export interface ExportGenerateMetadata {
  insightCount: number;
  totalInsights: number;
  sessionCount: number;
  projectCount: number;
  scope: ExportGenerateScope;
  depth: ExportGenerateDepth;
}

/**
 * Open an SSE stream for LLM export generation.
 * Returns the raw Response — caller uses parseSSEStream to consume events.
 * Caller is responsible for passing an AbortSignal for cancellation.
 */
export async function exportGenerateStream(
  params: ExportGenerateRequest,
  signal?: AbortSignal
): Promise<Response> {
  const q = new URLSearchParams();
  q.set('scope', params.scope);
  if (params.projectId) q.set('projectId', params.projectId);
  q.set('format', params.format);
  if (params.depth) q.set('depth', params.depth);

  const res = await fetch(`${BASE}/export/generate/stream?${q.toString()}`, { signal });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`Export stream failed ${res.status}: ${text}`);
  }
  return res;
}

// ── Facets & Reflect ─────────────────────────────────────────────────────────

export interface RateLimitInfo {
  count: number;
  sessionsAffected: number;
  examples: string[];
}

export interface PQDimensionScores {
  overall: number;
  context_provision: number | null;  // null if no data for this dimension
  request_specificity: number | null;
  scope_management: number | null;
  information_timing: number | null;
  correction_quality: number | null;
}

export interface FacetAggregation {
  frictionCategories: Array<{
    category: string;
    count: number;
    avg_severity: number;
    examples: string[];
  }>;
  effectivePatterns: Array<{
    category: string;
    label: string;
    frequency: number;
    avg_confidence: number;
    descriptions: string[];
    drivers?: Record<string, number>;  // driver -> count breakdown (user-driven, ai-driven, collaborative)
  }>;
  outcomeDistribution: Record<string, number>;
  workflowDistribution: Record<string, number>;
  characterDistribution: Record<string, number>;
  totalSessions: number;
  frictionTotal: number;
  totalAllSessions: number;
  rateLimitInfo: RateLimitInfo | null;
  streak: number;
  sourceToolCount: number;
  sourceTools: string[];
  pqScores: PQDimensionScores | null;
  lifetimeSessions: number;
  totalTokens: number;
}

export function fetchFacets(params?: {
  project?: string;
  period?: string;
  source?: string;
}) {
  const q = new URLSearchParams();
  if (params?.project) q.set('project', params.project);
  if (params?.period) q.set('period', params.period);
  if (params?.source) q.set('source', params.source);
  const qs = q.toString() ? `?${q.toString()}` : '';
  return request<{ facets: FacetRow[]; missingCount: number; totalSessions: number }>(`/facets${qs}`);
}

export function fetchFacetAggregation(params?: {
  project?: string;
  period?: string;
  source?: string;
}) {
  const q = new URLSearchParams();
  if (params?.project) q.set('project', params.project);
  if (params?.period) q.set('period', params.period);
  if (params?.source) q.set('source', params.source);
  const qs = q.toString() ? `?${q.toString()}` : '';
  return request<FacetAggregation>(`/facets/aggregated${qs}`);
}

export function fetchOutdatedFacetCount(params?: {
  project?: string;
  period?: string;
}) {
  const q = new URLSearchParams();
  if (params?.project) q.set('project', params.project);
  if (params?.period) q.set('period', params.period);
  const qs = q.toString() ? `?${q.toString()}` : '';
  return request<{ count: number }>(`/facets/outdated${qs}`);
}

export function fetchMissingFacetSessionIds(params?: {
  project?: string;
  period?: string;
  source?: string;
}) {
  const q = new URLSearchParams();
  if (params?.project) q.set('project', params.project);
  if (params?.period) q.set('period', params.period);
  if (params?.source) q.set('source', params.source);
  const qs = q.toString() ? `?${q.toString()}` : '';
  return request<{ sessionIds: string[]; count: number }>(`/facets/missing${qs}`);
}

export async function backfillFacets(sessionIds: string[]): Promise<{ completed: number; failed: number }> {
  // The /api/facets/backfill endpoint returns an SSE stream, not JSON.
  // Using raw fetch here instead of request() which calls res.json() and would crash.
  const res = await fetch(`${BASE}/facets/backfill`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionIds }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`API ${res.status}: ${text}`);
  }
  if (!res.body) throw new Error('No response body');

  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  let currentEvent = '';
  let currentData = '';
  let result = { completed: 0, failed: 0 };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += value;
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (line.startsWith('event: ')) {
          currentEvent = line.slice(7).trim();
        } else if (line.startsWith('data: ')) {
          currentData = line.slice(6);
        } else if (line === '' && currentEvent && currentData) {
          if (currentEvent === 'complete') {
            const data = JSON.parse(currentData) as { completed: number; failed: number };
            result = { completed: data.completed, failed: data.failed };
          }
          currentEvent = '';
          currentData = '';
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  return result;
}

export interface WeekInfo {
  week: string;
  sessionCount: number;
  hasSnapshot: boolean;
  generatedAt: string | null;
}

export interface ReflectSnapshot {
  period: string;
  projectId: string;
  results: Record<string, unknown>;
  generatedAt: string;
  windowStart: string | null;
  windowEnd: string;
  sessionCount: number;
  facetCount: number;
}

export function fetchReflectSnapshot(params?: {
  period?: string;
  project?: string;
}) {
  const q = new URLSearchParams();
  if (params?.period) q.set('period', params.period);
  if (params?.project) q.set('project', params.project);
  const qs = q.toString() ? `?${q.toString()}` : '';
  return request<{ snapshot: ReflectSnapshot | null }>(`/reflect/snapshot${qs}`);
}

export function fetchReflectWeeks(params?: { project?: string }) {
  const q = new URLSearchParams();
  if (params?.project) q.set('project', params.project);
  const qs = q.toString() ? `?${q.toString()}` : '';
  return request<{ weeks: WeekInfo[] }>(`/reflect/weeks${qs}`);
}

export async function reflectGenerateStream(
  params: {
    sections?: string[];
    period?: string;
    project?: string;
    source?: string;
  },
  signal?: AbortSignal
): Promise<Response> {
  const res = await fetch(`${BASE}/reflect/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
    signal,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`Reflect generation failed ${res.status}: ${text}`);
  }
  return res;
}

// ── Dispatch (blog post generator) ───────────────────────────────────────────

export type DispatchTone = 'technical' | 'accessible' | 'quick-tips';
export type DispatchFormat = 'blog' | 'linkedin';

export interface DispatchRequest {
  insightIds: string[];
  context: string;
  tone: DispatchTone;
  format: DispatchFormat;
  includeSessionBackground?: boolean;
}

export interface DispatchResponse {
  markdown: string;
  /** Plain text body without YAML frontmatter — use for LinkedIn copy and character count. */
  body: string;
  format: DispatchFormat;
  frontmatter: {
    title: string;
    tags: string[];
    tldr: string;
  };
  wordCount: number;
  characterCount: number;
  degraded: boolean;
  model: string;
  tokensUsed: {
    input: number;
    output: number;
  };
}

export function generateDispatch(body: DispatchRequest): Promise<DispatchResponse> {
  return request<DispatchResponse>('/dispatch/generate', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export interface DispatchImagePromptRequest {
  title: string;
  tags: string[];
  tldr: string;
  format: DispatchFormat;
}

export interface DispatchImagePromptResponse {
  prompt: string;
  model: string;
  tokensUsed: { input: number; output: number };
}

export function generateDispatchImagePrompt(body: DispatchImagePromptRequest): Promise<DispatchImagePromptResponse> {
  return request<DispatchImagePromptResponse>('/dispatch/image-prompt', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

// ── Analysis Queue ────────────────────────────────────────────────────────────

export interface AnalysisQueueItem {
  source_tool: string;
  session_id: string;
  status: 'settling' | 'awaiting-capability' | 'pending' | 'processing' | 'completed' | 'failed';
  runner_type: string;
  latest_turn_id: string | null;
  generation: number;
  transcript_locator: string | null;
  source_basis: string | null;
  not_before: string | null;
  diagnostic: string | null;
  enqueued_at: string;
  started_at: string | null;
  completed_at: string | null;
  error_message: string | null;
  attempt_count: number;
  max_attempts: number;
}

export interface AnalysisQueueStatus {
  settling: number;
  awaitingCapability: number;
  pending: number;
  processing: number;
  completed: number;
  failed: number;
  items: AnalysisQueueItem[];
  latestAutomatic: AnalysisQueueItem | null;
}

export function fetchAnalysisQueue() {
  return request<AnalysisQueueStatus>('/analysis/queue');
}

export function retryPendingAnalysis() {
  return request<{ accepted: boolean; retrying: number }>('/analysis/queue/retry', {
    method: 'POST',
  });
}

export type RuntimeStageState = 'healthy' | 'running' | 'waiting' | 'stale' | 'failed' | 'not-configured';
export interface RuntimeStage {
  state: RuntimeStageState;
  label: string;
  lastSuccessAt: string | null;
  backlog: number;
  failures: number;
  action: { label: string; href: string } | null;
  detail: string;
}
export interface RuntimeStatus {
  generatedAt: string;
  stages: {
    hook: RuntimeStage;
    ingestion: RuntimeStage;
    semanticAnalysis: RuntimeStage;
    behaviorReport: RuntimeStage;
    knowledgeResearch: RuntimeStage;
  };
}

export function fetchRuntimeStatus() {
  return request<RuntimeStatus>('/runtime-status');
}

export interface BehaviorReportSummary {
  promptVersion: string;
  report: {
    headline: string | null;
    generatedAt: string;
    evidenceCutoff: string | null;
    promptVersion: string;
  } | null;
  latestAttempt: {
    status: 'completed' | 'unavailable' | 'failed' | 'rejected';
    createdAt: string;
    promptVersion: string;
    unavailableReason: string | null;
  } | null;
  generation: { running: boolean; startedAt: string | null };
}

export function fetchBehaviorReportSummary() {
  return request<BehaviorReportSummary>('/behavior-report/summary');
}

export interface KnowledgeSourceRef {
  url: string;
  title: string;
  sourceType: 'official' | 'community';
  publishedAt: string;
  fetchedAt: string;
  author: string;
  independentEvidence: string;
  discussionEvidence: string;
}

export interface KnowledgePractice {
  id: string;
  snapshotId: string;
  title: string;
  summary: string;
  applicability: string;
  sourceTrust: 'official' | 'high' | 'medium' | 'limited';
  discussionBreadth: 'high' | 'medium' | 'low' | 'unknown';
  recency: string;
  localRelevance: 'high' | 'medium' | 'low' | 'unknown';
  localEffectStatus: 'supported' | 'not-reviewed' | 'insufficient' | 'negative';
  rationale: string;
  tags: string[];
  sourceRefs: KnowledgeSourceRef[];
  conflicts: string[];
  createdAt: string;
  scope: 'weekly' | 'topic';
  snapshotCreatedAt: string;
}

export interface KnowledgeStatus {
  authorization: { enabled: boolean; authorizedAt: string | null };
  topicSource: 'general-bootstrap' | 'local-analysis';
  due: boolean;
  generation: {
    running: boolean;
    scope: 'weekly' | 'topic' | null;
    startedAt: string | null;
    lastCompletedAt: string | null;
    lastError: string | null;
  };
  latestSnapshot: null | {
    id: string;
    scope: 'weekly' | 'topic';
    topic: string | null;
    snapshotVersion: string;
    promptVersion: string;
    status: 'completed' | 'failed';
    researchRunId: string | null;
    sourceCount: number;
    practiceCount: number;
    querySummary: { labels?: string[] };
    createdAt: string;
  };
  boundary: {
    externalPayload: string;
    excluded: string[];
    localEffect: string;
  };
}

export function fetchKnowledgeStatus() {
  return request<KnowledgeStatus>('/practices/status');
}

export function authorizeKnowledgeResearch() {
  return request<{ enabled: true; authorizedAt: string }>('/practices/authorization', {
    method: 'POST',
    body: JSON.stringify({ acknowledgedExternalResearch: true }),
  });
}

export function setKnowledgeResearchAuthorization(enabled: boolean) {
  return request<{ enabled: boolean; authorizedAt: string | null }>('/practices/authorization', {
    method: 'PATCH',
    body: JSON.stringify({ enabled }),
  });
}

export function refreshKnowledgeResearch(topic?: string) {
  return request<{ accepted: true; scope: 'weekly' | 'topic'; message: string }>('/practices/refresh', {
    method: 'POST',
    body: JSON.stringify(topic ? { topic } : {}),
  });
}

export function fetchKnowledgePractices(filters?: {
  snapshotId?: string;
  trust?: KnowledgePractice['sourceTrust'];
  relevance?: KnowledgePractice['localRelevance'];
  tag?: string;
}) {
  const query = new URLSearchParams();
  if (filters?.snapshotId) query.set('snapshotId', filters.snapshotId);
  if (filters?.trust) query.set('trust', filters.trust);
  if (filters?.relevance) query.set('relevance', filters.relevance);
  if (filters?.tag) query.set('tag', filters.tag);
  const suffix = query.size > 0 ? `?${query.toString()}` : '';
  return request<{ practices: KnowledgePractice[] }>(`/practices${suffix}`);
}

export interface ImprovementObservation {
  id: string;
  taskId: string;
  signal: 'eligible' | 'adoption-observed' | 'adoption-not-observed' | 'counter-evidence' | 'negative-impact';
  rationale: string;
  evidenceRefs: string[];
  analysisRunId: string | null;
  createdAt: string;
}

export interface ImprovementReview {
  id: string;
  outcome: 'improved' | 'no-clear-improvement' | 'insufficient-evidence' | 'negative-impact';
  rationale: string;
  supportingRefs: string[];
  opposingRefs: string[];
  limitations: string[];
  analysisRunId: string | null;
  createdAt: string;
}

export interface ImprovementPlan {
  id: string;
  sourcePracticeId: string | null;
  sourcePracticeTitle: string | null;
  knowledgeSnapshotId: string | null;
  knowledgeSnapshotCreatedAt: string | null;
  basisChanged: boolean;
  latestKnowledgeSnapshotId: string | null;
  earlyReviewRecommended: boolean;
  reportRunId: string | null;
  title: string;
  hypothesis: string;
  applicability: string;
  reviewPlan: {
    version?: string;
    llmDefined?: {
      eligibleTasks?: string;
      observableOutcome?: string;
      guardrail?: string;
      reviewWhen?: string;
      sequencingReason?: string;
    };
    systemLimit?: {
      maxEligibleTasks?: number;
      maxObservationDays?: number;
      stopAtFirstLimit?: boolean;
      explanation?: string;
    };
  };
  status: 'queued' | 'observing' | 'review-ready' | 'reviewed' | 'paused' | 'ended';
  sequence: number;
  matchedTaskCount: number;
  adoptionSignalCount: number;
  maxTaskCount: number;
  maxObservationDays: number;
  evidenceCutoff: string | null;
  createdAt: string;
  updatedAt: string;
  observations: ImprovementObservation[];
  reviews: ImprovementReview[];
  feedback: Array<{
    id: string;
    kind: 'judgment-wrong' | 'not-applicable' | 'continue-observing' | 'end-tracking';
    note: string | null;
    createdAt: string;
  }>;
}

export interface ImprovementsState {
  creationAvailability?: {
    analysis: 'available' | 'requires-refresh' | 'requires-first-run';
    practices: 'available' | 'empty';
  };
  generation: {
    running: boolean;
    action: 'create-plan' | 'review' | null;
    subjectId: string | null;
    startedAt: string | null;
    lastError: string | null;
  };
  limits: {
    maxActivePlans: number;
    maxEligibleTasksPerPlan: number;
    maxObservationDays: number;
    explanation: string;
  };
  plans: ImprovementPlan[];
}

export function fetchImprovements() {
  return request<ImprovementsState>('/improvements');
}

export function trackKnowledgePractice(practiceId: string) {
  return request<{ accepted: true; message: string }>(`/improvements/from-practice/${encodeURIComponent(practiceId)}`, {
    method: 'POST',
  });
}

export function reviewImprovement(planId: string) {
  return request<{ accepted: true; message: string }>(`/improvements/${encodeURIComponent(planId)}/review`, {
    method: 'POST',
  });
}

export function updateImprovementStatus(
  planId: string,
  status: 'observing' | 'paused' | 'ended',
) {
  return request<{ updated: true; status: 'observing' | 'paused' | 'ended' }>(
    `/improvements/${encodeURIComponent(planId)}/status`,
    { method: 'PATCH', body: JSON.stringify({ status }) },
  );
}

export function sendImprovementFeedback(
  planId: string,
  body: {
    kind: 'judgment-wrong' | 'not-applicable' | 'continue-observing' | 'end-tracking';
    note?: string;
  },
) {
  return request<{ id: string; storedLocally: true; message: string }>(
    `/improvements/${encodeURIComponent(planId)}/feedback`,
    { method: 'POST', body: JSON.stringify(body) },
  );
}
