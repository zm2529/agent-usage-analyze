// Dashboard-specific types matching the Hono API response format.
// The server returns SQLite rows as-is — snake_case keys, ISO 8601 date strings.
// Convert to Date objects only at the component boundary when needed.

export type ExportTemplate = 'knowledge-base' | 'agent-rules';

export interface IngestionHealth {
  status: 'never-run' | 'running' | 'completed' | 'completed-with-errors' | 'failed';
  diagnostics: Array<{ severity: string; code: string; count: number }>;
  coverage: {
    discovered: number;
    parsed: number;
    skipped: number;
    failed: number;
    unknown: number;
  };
  eventCount: number;
  sourceCount: number;
  eras: Array<{
    id: string;
    mode: 'historical-backfill' | 'continuous-observation';
    parserVersion: string;
  }>;
}

export interface WorkTaskNode {
  id: string;
  rootTaskId: string;
  parentTaskId: string | null;
  threadId: string;
  role: string;
  status: string;
  startedAt: string;
  endedAt: string | null;
  repository: { root: string | null; worktree: string | null; branch: string | null };
}

export interface WorkTaskDetail {
  id: string;
  nodes: WorkTaskNode[];
  events: Array<{
    id: string; sourceArtifactId: string; sequence: number; kind: string; actor: string;
    sensitivity: string; occurredAt: string; taskId: string | null; threadId: string | null;
    turnId: string | null; attempt: number | null; generation: number | null; payloadRef: string | null;
  }>;
  tokenDeltas: Array<{
    eventId: string; taskId: string; laneKey: string; segment: number; status: string;
    inputTokens: number | null; cachedInputTokens: number | null;
    cacheCreationTokens: number | null; outputTokens: number | null;
    reasoningTokens: number | null; compactionTokens: number | null;
  }>;
  coverage: { discovered: number; parsed: number; skipped: number; failed: number; unknown: number };
  diagnostics: Array<{ severity: string; code: string; count: number }>;
  deliveries: TaskDeliveryCandidate[];
}

export type DeliveryKind = 'git-commit' | 'test-run' | 'local-artifact';
export interface Delivery {
  id: string;
  kind: DeliveryKind;
  repositoryIdentity: string;
  resultIdentity: string;
  occurredAt: string;
  metadata: Record<string, unknown>;
}
export interface DeliveryEvidence {
  id: string;
  evidenceType: string;
  position: 'supports' | 'opposes' | 'limits';
  sourceCategory: 'deterministic' | 'human-corrected';
  algorithmVersion: string;
  coverage: number;
  confidence: number;
  eraCompatibility: 'compatible' | 'limited' | 'incomparable';
  eraIds: string[];
  humanStatus: 'unreviewed' | 'confirmed' | 'rejected' | 'corrected';
  facts: Array<{ deliveryId: string; taskId: string; factRef?: string }>;
}
export interface TaskDeliveryCandidate {
  id: string;
  taskId: string;
  delivery: Delivery;
  algorithmVersion: string;
  coverage: number;
  confidence: number;
  status: 'candidate' | 'abstained' | 'confirmed' | 'rejected' | 'pending';
  evidence: DeliveryEvidence[];
}
export interface DeliveryDetail extends Delivery {
  candidates: TaskDeliveryCandidate[];
}

export type BuildermarkGateStatus = 'disabled' | 'testing' | 'passed' | 'failed';
export interface BuildermarkGateReport {
  id: string;
  helper: 'buildermark';
  helperVersion: string;
  helperSourceCommit: string;
  evidenceSchemaVersion: string;
  mode: 'synthetic' | 'real';
  status: 'testing' | 'passed' | 'failed';
  importedCommits: number;
  referencedCommits: number;
  candidates: number;
  reviewedCandidates: number;
  obviousMisattributions: number;
  evidenceCounts: { exact: number; formatting: number; fallback: number; deletion: number };
  diagnosticCodes: string[];
  failureCodes: string[];
  reportHash: string;
  completedAt: string;
}
export interface BuildermarkGateState {
  status: BuildermarkGateStatus;
  experimentalEnabled: boolean;
  latestRun: BuildermarkGateReport | null;
  realGatePassed: boolean;
  syntheticGatePassed: boolean;
  stateError: 'corrupt-report' | null;
}

export type GitAiScenarioKind = 'clean' | 'pre-existing-dirty' | 'missing-baseline'
  | 'partial-stage' | 'amend' | 'rebase' | 'linked-worktree'
  | 'same-worktree-concurrent' | 'unsupported-client';
export interface GitAiGateReport {
  id: string;
  status: 'passed' | 'failed';
  sourceVersion: '1.6.16';
  sourceCommit: string;
  notesSchema: 'authorship/3.0.0';
  notesExportPolicy: 'local-explicit';
  candidateEvidence: number;
  abstentions: number;
  scenarios: Array<{
    kind: GitAiScenarioKind;
    support: 'supported' | 'limited' | 'abstained';
    outcome: 'candidate' | 'abstained';
    reason: string | null;
  }>;
  failureCodes: string[];
  completedAt: string;
  reportHash: string;
}
export interface GitAiSidecarState {
  status: 'disabled' | 'testing' | 'passed' | 'failed';
  gatePassed: boolean;
  configured: boolean;
  configuredEnabled: boolean;
  binaryHealthy: boolean;
  binaryVersion: string | null;
  consumptionEnabled: boolean;
  sourceVersion: '1.6.16';
  sourceCommit: string;
  notesSchema: 'authorship/3.0.0';
  notesExportPolicy: 'local-only' | 'manual-external';
  automaticRepositoryMutation: false;
  latestRun: GitAiGateReport | null;
  stateError: 'corrupt-report' | 'corrupt-config' | 'config-unavailable'
    | 'sidecar-health-check-failed' | null;
}

export type SemanticAnalysisPreview =
  | { status: 'disabled'; reason: 'not-enabled'; deterministicAvailable: true }
  | {
    status: 'ready'; provider: string; model: string; locality: 'local' | 'remote';
    evidenceScope: { firstTurn: string | null; lastTurn: string | null; turnCount: number; eventCount: number };
    inputCoverage: number; estimatedInputTokens: number; estimatedCostUsd: number | null;
    deterministicAvailable: true;
  };

export interface SemanticAnalysisRun {
  id: string;
  provider: string;
  model: string;
  locality: 'local' | 'remote';
  rubricVersion: string;
  analysisVersion: string;
  inputCoverage: number;
  estimatedInputTokens: number;
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: number | null;
}

export interface SemanticClaim {
  id: string;
  sourceCategory: 'llm-semantic';
  claimType: 'pattern-explanation' | 'improvement-advice';
  title: string;
  summary: string;
  expectedBenefit: string;
  verification: string;
  confidence: number;
  evidenceRefs: string[];
  run: SemanticAnalysisRun;
}

export type ScorecardStatus = 'draft' | 'calibrating' | 'active' | 'retired';
export interface ScorecardVersion {
  id: string;
  name: string;
  version: string;
  definitionHash: string;
  status: ScorecardStatus;
  features: Array<{ key: string; label: string; weight: number; requiresQualityGate: boolean }>;
  qualityGates: string[];
  safetyGates: string[];
  missingRules: Record<string, 'unavailable' | 'neutral'>;
  thresholds: { minimumCoverage: number };
  calibrationDataVersion: string | null;
  scope: { kind: 'personal'; taskRole?: string };
  evidenceRefs: string[];
  createdAt: string;
}

export interface ScorecardResult {
  id: string;
  taskId: string;
  rootTaskId: string;
  scorecardVersionId: string;
  rawFeatures: Record<string, number | null>;
  gateResults: { quality: boolean; safety: boolean; calibration: boolean };
  coverage: number;
  uncertainty: number;
  indexValue: number | null;
  unavailableReason: 'scorecard-not-active' | 'calibration-not-passed' | 'quality-gate-failed'
    | 'safety-gate-failed' | 'insufficient-coverage' | 'missing-feature'
    | 'task-not-found' | 'out-of-scope' | null;
  evidenceRefs: string[];
  evidenceLinks: Array<{ ref: string; eventId: string; rootTaskId: string }>;
  createdAt: string;
}

export interface ObserverOverhead {
  eventCount: number;
  degraded: boolean;
  diagnostics: Array<{
    id: string; category: 'import' | 'llm' | 'sidecar' | 'advisory'; observerRunId: string;
    code: 'observer-write-failed' | 'observer-measurement-failed'; occurredAt: string;
  }>;
  totals: {
    cpuMs: number; wallMs: number; dbBytesDelta: number; inputTokens: number | null;
    outputTokens: number | null; costUsd: number | null; sidecarMs: number;
  };
  advisory: { shown: number; adopted: number; ignored: number; dismissed: number };
  byCategory: Array<{ category: 'import' | 'llm' | 'sidecar' | 'advisory'; eventCount: number; wallMs: number }>;
  recentEvents: Array<{
    id: string; subjectKind: 'observer'; category: 'import' | 'llm' | 'sidecar' | 'advisory';
    observerRunId: string; analyzedTaskId?: string; cpuMs?: number; wallMs?: number;
    dbBytesDelta?: number; inputTokens?: number; outputTokens?: number; costUsd?: number | null;
    sidecarMs?: number; advisoryAction?: 'shown' | 'adopted' | 'ignored' | 'dismissed';
    evidenceRefs: string[]; occurredAt: string;
  }>;
}

export interface AdvisorySuggestion {
  taskId: string;
  issueKey: string;
  sourceCategory: 'deterministic' | 'llm-semantic';
  triggerFact: string;
  expectedBenefit: string;
  confidence: number;
  coverage: number;
  evidenceRefs: string[];
  verification: string;
  muted: boolean;
}

export interface AdviceState {
  status: 'ok';
  active: AdvisorySuggestion[];
  muted: AdvisorySuggestion[];
  history: {
    events: Array<{
      id: string; interventionId: string; issueKey: string; taskId: string;
      action: 'shown' | 'adopted' | 'ignored' | 'dismissed' | 'outcome';
      outcome: 'improved' | 'not-improved' | 'unknown' | null;
      observationEraId: string; coverage: number; evidenceRefs: string[]; occurredAt: string;
    }>;
    comparisons: Array<{
      interventionId: string; issueKey: string; kind: 'observational-before-after'; causal: false;
      baseline: { observationEraId: string; coverage: number; occurredAt: string };
      followup: {
        observationEraId: string; coverage: number;
        outcome: 'improved' | 'not-improved' | 'unknown'; occurredAt: string;
      };
    }>;
  };
  attention: { shown: number; adopted: number; ignored: number; dismissed: number };
  diagnostics: string[];
}

export type TrendState = 'new' | 'persistent' | 'improving' | 'regressed' | 'resolved' | 'incomparable';
export interface AnalysisClaim {
  id: string;
  pattern: string;
  sourceCategory: 'deterministic' | 'statistical' | 'llm-semantic' | 'human-corrected';
  algorithmVersion: string;
  window: { start: string; end: string };
  sampleCount: number;
  totalTaskCount: number;
  coverage: number;
  confidence: number;
  eraCompatibility: 'compatible' | 'limited' | 'incomparable';
  sampleTaskRefs: string[];
  evidenceRefs: string[];
  evidence: Array<{
    id: string; evidenceType: string; subjectRef: string; position: string;
    sourceCategory: string; algorithmVersion: string; coverage: number;
    confidence: number; eraCompatibility: string; eraIds: string[];
    humanStatus: string; factRefs: string[];
    facts: Array<{ eventId: string; taskId: string }>;
  }>;
}
export interface TrendComparison {
  previousWindow: { start: string; end: string; taskCount: number; coverage: number; eras: Array<{ id: string; mode: string; parserVersion: string; capabilities: string[]; startsAt: string; endsAt: string | null; coverage: number }> };
  currentWindow: { start: string; end: string; taskCount: number; coverage: number; eras: Array<{ id: string; mode: string; parserVersion: string; capabilities: string[]; startsAt: string; endsAt: string | null; coverage: number }> };
  eraCompatibility: 'compatible' | 'limited' | 'incomparable';
  trends: Array<{
    pattern: string; label: string; observableFact: string; state: TrendState;
    change: number | null; unknownReason: string | null;
    previous: AnalysisClaim | null; current: AnalysisClaim | null;
    conflictingEvidence: AnalysisClaim['evidence'];
  }>;
}

export interface Project {
  id: string;
  name: string;
  path: string;
  git_remote_url: string | null;
  session_count: number;
  last_activity: string;        // ISO 8601
  created_at: string;           // ISO 8601
  updated_at: string;           // ISO 8601
  total_input_tokens?: number;
  total_output_tokens?: number;
  cache_creation_tokens?: number;
  cache_read_tokens?: number;
  estimated_cost_usd?: number;
}

export type SessionCharacter =
  | 'deep_focus'
  | 'bug_hunt'
  | 'feature_build'
  | 'exploration'
  | 'refactor'
  | 'learning'
  | 'quick_task';

export type TitleSource = 'claude' | 'user_message' | 'insight' | 'character' | 'fallback';

export interface Session {
  id: string;
  project_id: string;
  project_name: string;
  project_path: string;
  git_remote_url: string | null;
  summary: string | null;
  custom_title: string | null;
  generated_title: string | null;
  title_source: TitleSource | null;
  session_character: SessionCharacter | null;
  started_at: string;           // ISO 8601
  ended_at: string;             // ISO 8601
  message_count: number;
  user_message_count: number;
  assistant_message_count: number;
  tool_call_count: number;
  git_branch: string | null;
  claude_version: string | null;
  source_tool: string | null;
  device_id: string | null;
  device_hostname: string | null;
  device_platform: string | null;
  synced_at: string;            // ISO 8601
  total_input_tokens: number | null;
  total_output_tokens: number | null;
  cache_creation_tokens: number | null;
  cache_read_tokens: number | null;
  estimated_cost_usd: number | null;
  models_used: string | null;   // JSON-encoded string[] — decode with parseJsonField<string[]>(x, [])
  primary_model: string | null;
  usage_source: string | null;
  compact_count: number;
  auto_compact_count: number;
  slash_commands: string | null; // JSON-encoded string[] — decode with parseJsonField<string[]>(x, [])
}

export type InsightType = 'summary' | 'decision' | 'learning' | 'technique' | 'prompt_quality';
export type InsightScope = 'session' | 'project' | 'overall';

export interface Insight {
  id: string;
  session_id: string;
  project_id: string;
  project_name: string;
  type: InsightType;
  title: string;
  content: string;
  summary: string;
  bullets: string;              // JSON-encoded string[] — decode with parseJsonField<string[]>(x, [])
  confidence: number;
  source: 'llm';
  metadata: string;             // JSON-encoded Record<string,unknown> — decode with parseJsonField<T>(x, {})
  timestamp: string;            // ISO 8601
  created_at: string;           // ISO 8601
  scope: InsightScope;
  analysis_version: string;
  linked_insight_ids: string | null; // JSON-encoded string[] | null — decode with parseJsonField<string[]>(x, [])
}

export interface ToolCall {
  id: string;                   // tool_use_id from JSONL
  name: string;
  input: string;                // serialized JSON from CLI
}

export interface ToolResult {
  toolUseId: string;            // References ToolCall.id
  output: string;               // Truncated tool output
}

export interface Message {
  id: string;
  session_id: string;
  type: 'user' | 'assistant' | 'system';
  content: string;
  thinking: string | null;
  tool_calls: string;           // JSON-encoded array from SQLite
  tool_results: string;         // JSON-encoded array from SQLite
  usage: string | null;         // JSON-encoded object from SQLite
  timestamp: string;            // ISO 8601
  parent_id: string | null;
}

// Daily stats from /api/analytics/usage
export interface DailyStats {
  date: string;
  session_count: number;
  message_count: number;
  insight_count: number;
  total_tokens?: number;
  estimated_cost_usd?: number;
}

/**
 * Safely parse a JSON-encoded string field from the SQLite API response.
 * Returns defaultValue if the field is null, empty, or invalid JSON.
 *
 * DECODE PATTERN for all JSON-encoded columns in this file:
 *   Always use parseJsonField<T>(field, defaultValue) — never bare JSON.parse().
 *   For array fields, pass [] as defaultValue and verify Array.isArray() at use site
 *   if the consumer calls array methods (.map, .filter, etc.), since parseJsonField
 *   trusts the type parameter and cannot verify shape at runtime.
 *
 * JSON-encoded columns in Session: models_used, slash_commands
 * JSON-encoded columns in Insight: bullets, metadata, linked_insight_ids
 */
export function parseJsonField<T>(value: string | null | undefined, defaultValue: T): T {
  if (!value) return defaultValue;
  try {
    return JSON.parse(value) as T;
  } catch {
    return defaultValue;
  }
}

// Dashboard stats from /api/analytics/dashboard
export interface DashboardStats {
  session_count: number;
  active_projects: number;
  total_messages: number | null;
  total_tool_calls: number | null;
  total_duration_min: number | null;
  total_input_tokens: number | null;
  total_output_tokens: number | null;
  cache_creation_tokens: number | null;
  cache_read_tokens: number | null;
  estimated_cost_usd: number | null;
}

/**
 * Typed metadata for insight rendering.
 * Mirrors cli/src/types.ts InsightMetadata — all fields optional since
 * sessions may not have all metadata populated.
 */
export interface InsightMetadata {
  // Decision fields
  situation?: string;
  choice?: string;
  reasoning?: string;
  alternatives?: Array<string | { option: string; rejected_because: string }>;
  trade_offs?: string;
  revisit_when?: string;
  evidence?: string[];
  // Learning fields
  symptom?: string;
  root_cause?: string;
  takeaway?: string;
  applies_when?: string;
  // Summary fields — narrative outcome from LLM summary extraction.
  // Distinct from session_facets.outcome_satisfaction ('high'|'medium'|'low'|'abandoned')
  // which is a quantitative satisfaction rating used on the Patterns page.
  outcome?: 'success' | 'partial' | 'abandoned' | 'blocked';
  // Legacy learning/technique
  context?: string;
  applicability?: string;
  // Prompt quality fields (new taxonomy — v3.x)
  efficiency_score?: number;
  message_overhead?: number;
  takeaways?: Array<{
    type: 'improve' | 'reinforce';
    category: string;
    label: string;
    message_ref: string;
    original?: string;
    better_prompt?: string;
    why?: string;
    what_worked?: string;
    why_effective?: string;
  }>;
  findings?: Array<{
    category: string;
    type: 'deficit' | 'strength';
    description: string;
    message_ref: string;
    impact: 'high' | 'medium' | 'low';
    confidence: number;
    suggested_improvement?: string;
  }>;
  dimension_scores?: {
    context_provision: number;
    request_specificity: number;
    scope_management: number;
    information_timing: number;
    correction_quality: number;
  };
  // Legacy prompt quality fields (pre-taxonomy — still in old insights)
  efficiencyScore?: number;
  wastedTurns?: Array<{ messageIndex: number; whatWentWrong?: string; reason?: string; originalMessage?: string; suggestedRewrite?: string; turnsWasted?: number }>;
  antiPatterns?: Array<{ name: string; description?: string; count: number; examples: string[]; fix?: string }>;
  sessionTraits?: Array<{ trait: string; severity: string; description: string; evidence?: string; suggestion?: string }>;
  potentialMessageReduction?: number;
}

// Raw session_facets row as returned by GET /api/facets
export interface FacetRow {
  session_id: string;
  outcome_satisfaction: string;
  workflow_pattern: string | null;
  had_course_correction: number;
  course_correction_reason: string | null;
  iteration_count: number;
  friction_points: string;     // JSON-encoded FrictionPoint[]
  effective_patterns: string;  // JSON-encoded EffectivePattern[]
  extracted_at: string;
  analysis_version: string;
}

export interface FrictionPoint {
  category: string;
  attribution?: 'user-actionable' | 'ai-capability' | 'environmental';
  description: string;
  severity: 'high' | 'medium' | 'low';
  resolution: 'resolved' | 'workaround' | 'unresolved';
}

export interface EffectivePattern {
  category: string;
  description: string;
  confidence: number;
  driver?: 'user-driven' | 'ai-driven' | 'collaborative';
}

// Prefill data for DispatchDrawer when opened from InsightsPage
export interface DispatchPrefill {
  sessionId: string;
  title: string;
  format: 'blog' | 'linkedin';
  contextMarkdown: string;
}

// LLM config from /api/config/llm
export interface LLMConfig {
  dashboardPort: number;
  provider?: 'openai' | 'anthropic' | 'gemini' | 'ollama' | 'llamacpp';
  model?: string;
  apiKey?: string;      // masked by server before returning (first4...last4)
  baseUrl?: string;
  semanticProviderLocality?: 'local' | 'remote';
  semanticAnalysisEnabled: boolean;
  analysis: AnalysisExecutionState;
}

export type AnalysisExecutionMode = 'auto' | 'codex-native' | 'claude-native' | 'provider' | 'local-only' | 'off';

export interface AnalysisExecutionState {
  mode: AnalysisExecutionMode;
  effectiveRunner: 'provider' | 'codex-native' | 'claude-native' | 'local-only' | 'off' | 'unavailable';
  authentication: 'chatgpt' | 'api-key' | 'access-token' | 'not-logged-in' | 'unknown' | 'cli-missing' | 'provider' | 'claude-auth-unverified' | 'none';
  locality: 'local' | 'remote';
  reason: string;
  provider?: string;
  model?: string;
}

export interface RuntimeConfig {
  dataDirectory: string;
  listenAddress: string;
  sources: Array<{ kind: string; count: number }>;
  eras: Array<{ mode: string; parserVersion: string; count: number }>;
  llm: { configured: boolean; provider?: string; model?: string; locality?: 'local' | 'remote'; enabled: boolean };
  analysis: AnalysisExecutionState;
  migration: { databaseSchema: number; status: string; completedAt: string | null };
  dataActions: {
    exportPath: string; archiveCommand: string; rebuildCommand: string; scope: string; recovery: string;
  };
}
