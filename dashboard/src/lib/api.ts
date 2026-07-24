// HTTP client for the Hono API server.
// Base URL is relative in production (SPA served by the same server).
// In Vite dev mode, the proxy forwards /api -> localhost:7890.

import type { Project, Session, Message, Insight, AnalysisRunRecord, BehaviorReportState, DashboardStats, OverviewAnalytics, OverviewRange, LLMConfig, RuntimeConfig, ExportTemplate, FacetRow, IngestionHealth, HistorySyncResult, PatternOverview, WorkTaskNode, WorkTaskDetail, TrendComparison, Delivery, DeliveryDetail, TaskDeliveryCandidate, BuildermarkGateState, GitAiSidecarState, SemanticAnalysisPreview, SemanticClaim, SemanticAnalysisRun, ScorecardVersion, ScorecardResult, ObserverOverhead, AdviceState, CodexAccountUsage } from '@/lib/types';

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
}) {
  const q = new URLSearchParams();
  if (params?.projectId) q.set('projectId', params.projectId);
  if (params?.sourceTool) q.set('sourceTool', params.sourceTool);
  if (params?.limit !== undefined) q.set('limit', String(params.limit));
  if (params?.offset !== undefined) q.set('offset', String(params.offset));
  const qs = q.toString() ? `?${q.toString()}` : '';
  return request<{ sessions: Session[] }>(`/sessions${qs}`);
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

export function fetchBehaviorReport() {
  return request<BehaviorReportState>('/behavior-report');
}

export function runBehaviorReport() {
  return request<BehaviorReportState & { status: 'completed' | 'unavailable'; reason?: string }>('/behavior-report/run', {
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

export function fetchAdvice(taskId?: string) {
  const query = taskId ? `?${new URLSearchParams({ taskId }).toString()}` : '';
  return request<AdviceState>(`/advice${query}`);
}

export function recordAdviceEvent(input:
  | { taskId: string; issueKey: string; action: 'shown' }
  | { taskId: string; issueKey: string; action: 'adopted' | 'ignored' | 'dismissed'; interventionId: string }
  | { taskId: string; issueKey: string; action: 'outcome'; interventionId: string;
      outcome: 'improved' | 'not-improved' | 'unknown' }) {
  return request<{ recorded: boolean; degraded: boolean; id?: string; interventionId?: string }>('/advice/events', {
    method: 'POST', body: JSON.stringify(input),
  });
}

export function setAdviceMute(input: {
  scopeKind: 'issue' | 'category'; scopeKey: string; mutedUntil: string | null;
}) {
  return request<void>('/advice/mutes', { method: 'POST', body: JSON.stringify(input) });
}

export function clearAdviceMute(input: { scopeKind: 'issue' | 'category'; scopeKey: string }) {
  return request<void>('/advice/mutes', { method: 'DELETE', body: JSON.stringify(input) });
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
