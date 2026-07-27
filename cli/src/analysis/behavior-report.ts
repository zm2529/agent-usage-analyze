import type Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { getDb } from '../db/client.js';
import { classifyStoredUserMessage } from './message-format.js';
import { recordAnalysisRun } from './analysis-run-db.js';
import { createAnalysisRunnerFromPolicy } from './runner-factory.js';
import type { AnalysisRunner, RunAnalysisResult } from './runner-types.js';
import { agentAppliedSkillNames, userInvokedSkillNames } from './skill-usage.js';
import { loadConfig } from '../utils/config.js';

export const BEHAVIOR_REPORT_PROMPT_VERSION = 'behavior-report-v9';

export type DimensionConfidence = 'high' | 'medium' | 'low';
export type DimensionStatus = 'established' | 'candidate' | 'qualitative';

export interface DynamicBehaviorDimension {
  id: string;
  label: string;
  status: DimensionStatus;
  observation: string;
  benefitHypothesis: string;
  applicability: string[];
  limitations: string[];
  confidence: DimensionConfidence;
  evidenceRefs: string[];
}

export interface BehaviorReport {
  identity: { title: string; stage: string; rationale: string; evidenceRefs: string[] };
  headline: string;
  summary: string;
  portrait: Array<{ title: string; finding: string; evidenceRefs: string[] }>;
  strengths: Array<{ title: string; explanation: string; mechanism: string; evidenceRefs: string[] }>;
  bottlenecks: Array<{
    title: string; explanation: string; mechanism: string; counterEvidence: string[]; evidenceRefs: string[];
  }>;
  dimensions: DynamicBehaviorDimension[];
  skillAssessments: Array<{
    name: string;
    fit: 'appropriate' | 'mixed' | 'uncertain';
    observation: string;
    issue: string | null;
    recommendation: string;
    evidenceRefs: string[];
  }>;
  runtimeAssessments: Array<{
    category: 'model' | 'reasoning-effort';
    target: string;
    fit: 'appropriate' | 'mixed' | 'uncertain';
    observation: string;
    issue: string | null;
    recommendation: string;
    applicability: string;
    evidenceRefs: string[];
  }>;
  contextDocumentAssessments: Array<{
    documentRef: string;
    name: string;
    assessment: 'helpful' | 'mixed' | 'costly' | 'uncertain';
    observation: string;
    tokenCost: string;
    optimization: string | null;
    evidenceRefs: string[];
  }>;
  tokenEfficiencyFindings: Array<{
    title: string;
    observation: string;
    savingMechanism: string;
    applicability: string;
    evidenceRefs: string[];
  }>;
  skillOpportunities: Array<{
    type: 'existing-skill' | 'create-skill';
    name: string;
    necessity: 'high' | 'medium';
    trigger: string;
    evidence: string;
    expectedBenefit: string;
    evidenceRefs: string[];
  }>;
  developmentPlan: {
    northStar: string;
    operatingRules: string[];
    experiments: Array<{
      title: string;
      hypothesis: string;
      eligibleCohort: string;
      observableOutcome: string;
      guardrail: string;
      reviewAfter: string;
      evidenceRefs: string[];
    }>;
    taskTemplate: string;
  };
  uncertainty: string;
}

interface BehaviorResearch {
  profileThesis: string;
  behavioralFindings: Array<{
    title: string; observation: string; mechanism: string; applicability: string[];
    counterEvidence: string[]; evidenceRefs: string[];
  }>;
  dimensions: Array<{
    id: string;
    label: string;
    status: DimensionStatus;
    observation: string;
    mechanism: string;
    applicability: string[];
    counterEvidence: string[];
    benefitHypothesis: string;
    confidence: DimensionConfidence;
    evidenceRefs: string[];
  }>;
  contradictions: string[];
  missingEvidence: string[];
}

interface SessionRow {
  id: string;
  projectId: string;
  projectName: string;
  startedAt: string;
  endedAt: string;
  compactCount: number;
  toolCallCount: number;
  projectPath: string;
  inputTokens: number | null;
  outputTokens: number | null;
  cacheCreationTokens: number | null;
  cacheReadTokens: number | null;
}

interface MessageRow {
  sessionId: string;
  type: 'user' | 'assistant';
  content: string;
  timestamp: string;
  toolCalls: string | null;
}

export interface BehaviorReportDataset {
  window: { startsAt: string; endsAt: string; spanDays: number };
  basis: {
    generatedAt: string;
    latestSessionAt: string | null;
    latestLlmAnalysisAt: string | null;
  };
  coverage: {
    windowSessions: number;
    structurallyAnalyzedSessions: number;
    semanticEnrichedSessions: number;
    structuralRatio: number;
    semanticEnrichmentRatio: number;
  };
  activity: Record<string, number>;
  promptSignals: Record<string, number>;
  representativeEpisodes: Array<{
    sessionRef: string;
    cohort: { projectRef: string; projectLabel: string; lengthBand: 'short' | 'medium' | 'long' };
    activity: {
      durationMinutes: number; userMessages: number; assistantMessages: number;
      toolCalls: number; compactCount: number;
    };
    runtime: { models: string[]; reasoningEfforts: string[] };
    behaviorSignals: {
      firstMessage: {
        hasPathContext: boolean;
        hasConstraintUpfront: boolean;
        hasValidationUpfront: boolean;
        hasSkillReference: boolean;
      };
      openingMessageCluster: { ref: string; sessions: number };
      followups: { messages: number; shortMessages: number; shortRate: number };
      semanticEnriched: boolean;
    };
    selectionReasons: string[];
    findings: Array<{
      type: string; title: string; summary: string;
      findingCategories: Array<Record<string, unknown>>; skillUsage: Array<Record<string, unknown>>;
    }>;
  }>;
  runtimeUsage: {
    models: Array<{ name: string; turns: number; sessions: number; sessionRefs: string[] }>;
    reasoningEfforts: Array<{ name: string; turns: number; sessions: number; sessionRefs: string[] }>;
    measurementNote: string;
  };
  leverage: {
    skills: {
      explicitInvocations: number;
      automaticInvocations: number;
      agentReadEvents: number;
      coveredSessions: number;
      items: Array<{
        name: string;
        invocations: number;
        userInvocations: number;
        automaticInvocations: number;
        agentReadEvents: number;
        sessions: number;
        sessionShare: number;
        weeklyInvocations: [number, number, number, number];
        lastUsedAt: string | null;
        coUsedWith: Array<{ name: string; sessions: number }>;
      }>;
    };
    tools: {
      totalCalls: number;
      coveredTasks: number;
      families: Array<{
        family: string;
        calls: number;
        tasks: number;
      }>;
      topTools: Array<{ name: string; calls: number; tasks: number }>;
    };
  };
  contextDocuments: {
    discovered: number;
    estimatedTokens: number;
    items: Array<{
      documentRef: string;
      name: string;
      scope: 'project' | 'ancestor';
      projects: string[];
      bytes: number;
      lines: number;
      headings: number;
      directiveSignals: number;
      estimatedTokens: number;
      coveredSessions: number;
      medianUserMessages: number;
      shortFollowupRate: number;
      compactionRate: number;
    }>;
    measurementNote: string;
  };
  tokenEfficiency: {
    inputTokens: number;
    outputTokens: number;
    cacheCreationTokens: number;
    cacheReadTokens: number;
    cacheReadShare: number;
    tokensPerUserMessage: number;
    sessionsWithCompaction: number;
    longSessions: number;
    p90UserMessages: number;
    measurementNote: string;
  };
}

interface CanonicalToolRow {
  taskId: string;
  rootTaskId: string;
  threadId: string | null;
  occurredAt: string;
  payloadJson: string;
}

interface TurnContextRow {
  threadId: string | null;
  payloadJson: string;
}

function percentile(values: number[], fraction: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * fraction;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  return Number((sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower)).toFixed(1));
}

function median(values: number[]): number { return percentile(values, 0.5); }

function safeObject(raw: string): Record<string, unknown> {
  try {
    const value = JSON.parse(raw) as unknown;
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  } catch { return {}; }
}

function ratio(part: number, total: number): number {
  return total === 0 ? 0 : Number((part / total).toFixed(3));
}

function toolFamily(name: string): string {
  const normalized = name.toLowerCase();
  if (['exec', 'exec_command', 'write_stdin', 'bash', 'shell'].includes(normalized)) return 'shell';
  if (['spawn_agent', 'wait_agent', 'send_message', 'followup_task', 'list_agents', 'close_agent', 'interrupt_agent', 'send_input'].includes(normalized)) return 'agent-orchestration';
  if (normalized === 'apply_patch' || normalized.includes('edit') || normalized.includes('write_file')) return 'editing';
  if (normalized.includes('playwright') || normalized.includes('browser') || ['view_image', 'get_app_state', 'click', 'press_key'].includes(normalized)) return 'browser-ui';
  if (normalized === 'update_plan' || normalized === 'get_goal' || normalized === 'update_goal') return 'planning';
  if (normalized.startsWith('mcp') || normalized === 'tool_search' || normalized.includes('mcp_resource')) return 'mcp-external';
  if (normalized.includes('read') || normalized.includes('search') || normalized.includes('find') || normalized.includes('codegraph')) return 'search-read';
  return 'other';
}

const CONTEXT_DOCUMENT_NAMES = ['AGENTS.md', 'CLAUDE.md', 'CODEX.md', '.codex/instructions.md'];

function contextDocumentPaths(projectPath: string): Array<{ path: string; scope: 'project' | 'ancestor' }> {
  const start = resolve(projectPath);
  const result: Array<{ path: string; scope: 'project' | 'ancestor' }> = [];
  const seen = new Set<string>();
  let directory = start;
  try { if (!statSync(directory).isDirectory()) directory = dirname(directory); } catch { return result; }
  for (let depth = 0; depth < 5; depth += 1) {
    for (const name of CONTEXT_DOCUMENT_NAMES) {
      const candidate = join(directory, name);
      if (seen.has(candidate) || !existsSync(candidate)) continue;
      try {
        if (!statSync(candidate).isFile()) continue;
        seen.add(candidate);
        result.push({ path: candidate, scope: depth === 0 ? 'project' : 'ancestor' });
      } catch { /* project may disappear while the report is being prepared */ }
    }
    const parent = dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  return result;
}

function buildContextDocumentSummary(
  sessions: SessionRow[],
  humanCounts: Map<string, number>,
  humanMessages: MessageRow[],
): BehaviorReportDataset['contextDocuments'] {
  const discovered = new Map<string, {
    path: string; scope: 'project' | 'ancestor'; sessions: Set<string>; projects: Set<string>;
  }>();
  for (const session of sessions) {
    for (const document of contextDocumentPaths(session.projectPath)) {
      const current = discovered.get(document.path) ?? {
        ...document, sessions: new Set<string>(), projects: new Set<string>(),
      };
      current.sessions.add(session.id);
      current.projects.add(session.projectName);
      discovered.set(document.path, current);
    }
  }
  const messagesBySession = new Map<string, MessageRow[]>();
  for (const message of humanMessages) {
    messagesBySession.set(message.sessionId, [...(messagesBySession.get(message.sessionId) ?? []), message]);
  }
  const items = [...discovered.values()].flatMap((document) => {
    try {
      const content = readFileSync(document.path, 'utf8').slice(0, 100_000);
      const covered = [...document.sessions];
      const followups = covered.flatMap((sessionId) => (messagesBySession.get(sessionId) ?? []).slice(1));
      const compacted = sessions.filter((session) => document.sessions.has(session.id) && session.compactCount > 0).length;
      return [{
        documentRef: `context:${createHash('sha256').update(document.path).digest('hex').slice(0, 12)}`,
        name: basename(document.path),
        scope: document.scope,
        projects: [...document.projects].sort(),
        bytes: Buffer.byteLength(content),
        lines: content ? content.split(/\r?\n/).length : 0,
        headings: (content.match(/^#{1,6}\s+/gm) ?? []).length,
        directiveSignals: (content.match(/\b(?:must|should|never|always|禁止|必须|应该|不要|仅限)\b/gi) ?? []).length,
        estimatedTokens: Math.ceil(content.length / 4),
        coveredSessions: covered.length,
        medianUserMessages: median(covered.map((sessionId) => humanCounts.get(sessionId) ?? 0)),
        shortFollowupRate: ratio(followups.filter((message) => message.content.trim().length <= 40).length, followups.length),
        compactionRate: ratio(compacted, covered.length),
      }];
    } catch { return []; }
  }).sort((left, right) => right.coveredSessions - left.coveredSessions || left.name.localeCompare(right.name));
  return {
    discovered: items.length,
    estimatedTokens: items.reduce((sum, item) => sum + item.estimatedTokens, 0),
    items: items.slice(0, 24),
    measurementNote: '只向模型提供文档名称、体量、指令密度和覆盖会话的行为统计；不发送文档正文。相关性不能单独证明文档造成了结果。',
  };
}

/** Build a privacy-bounded dataset: aggregates and prior LLM conclusions only, never raw message text. */
export function buildBehaviorReportDataset(
  db: Database.Database = getDb(),
  now = new Date(),
  options: { includeLeverage?: boolean } = {},
): BehaviorReportDataset {
  const endsAt = now.toISOString();
  const startsAt = new Date(now.getTime() - 30 * 86_400_000).toISOString();
  const candidateSessions = db.prepare(`SELECT id, project_id AS projectId, project_name AS projectName,
      project_path AS projectPath, started_at AS startedAt, ended_at AS endedAt,
      (compact_count + auto_compact_count) AS compactCount, tool_call_count AS toolCallCount,
      total_input_tokens AS inputTokens, total_output_tokens AS outputTokens,
      cache_creation_tokens AS cacheCreationTokens, cache_read_tokens AS cacheReadTokens
    FROM sessions WHERE deleted_at IS NULL AND started_at >= ? AND started_at <= ?
    ORDER BY started_at`).all(startsAt, endsAt) as SessionRow[];
  const messages = db.prepare(`SELECT message.session_id AS sessionId, message.type, message.content,
      message.timestamp, message.tool_calls AS toolCalls
    FROM messages message JOIN sessions session ON session.id = message.session_id
    WHERE session.deleted_at IS NULL AND session.started_at >= ? AND session.started_at <= ?
      AND message.type IN ('user', 'assistant')
    ORDER BY message.session_id, message.timestamp, message.id`).all(startsAt, endsAt) as MessageRow[];
  const humanMessages = messages.filter((message) => message.type === 'user'
    && classifyStoredUserMessage(message.content) === 'human');
  const assistantCounts = new Map<string, number>();
  const humanCounts = new Map<string, number>();
  for (const message of messages) {
    if (message.type === 'assistant') assistantCounts.set(message.sessionId, (assistantCounts.get(message.sessionId) ?? 0) + 1);
  }
  for (const message of humanMessages) humanCounts.set(message.sessionId, (humanCounts.get(message.sessionId) ?? 0) + 1);
  const sessions = candidateSessions.filter((session) => (humanCounts.get(session.id) ?? 0) > 0);
  const eligibleIds = new Set(sessions.map((session) => session.id));
  const eligibleThreadIds = new Set(sessions.flatMap((session) => {
    const nativeId = session.id.startsWith('codex:') ? session.id.slice('codex:'.length) : session.id;
    return [session.id, nativeId];
  }));
  const sessionIdByThreadId = new Map(sessions.flatMap((session) => {
    const nativeId = session.id.startsWith('codex:') ? session.id.slice('codex:'.length) : session.id;
    return [[session.id, session.id], [nativeId, session.id]] as Array<[string, string]>;
  }));
  const runtimeBySession = new Map<string, { models: Set<string>; reasoningEfforts: Set<string> }>();
  const modelStats = new Map<string, { turns: number; sessions: Set<string> }>();
  const effortStats = new Map<string, { turns: number; sessions: Set<string> }>();
  const turnContexts = db.prepare(`SELECT thread_id AS threadId, payload_json AS payloadJson
    FROM canonical_events
    WHERE kind = 'turn-context' AND occurred_at >= ? AND occurred_at <= ?
    ORDER BY occurred_at, sequence`).all(startsAt, endsAt) as TurnContextRow[];
  for (const context of turnContexts) {
    if (!context.threadId || !eligibleThreadIds.has(context.threadId)) continue;
    const sessionId = sessionIdByThreadId.get(context.threadId);
    if (!sessionId) continue;
    const payload = safeObject(context.payloadJson);
    const model = typeof payload.model === 'string' ? payload.model.trim() : '';
    const effort = typeof payload.effort === 'string' ? payload.effort.trim().toLowerCase() : '';
    const runtime = runtimeBySession.get(sessionId)
      ?? { models: new Set<string>(), reasoningEfforts: new Set<string>() };
    if (model) {
      runtime.models.add(model);
      const stat = modelStats.get(model) ?? { turns: 0, sessions: new Set<string>() };
      stat.turns += 1;
      stat.sessions.add(sessionId);
      modelStats.set(model, stat);
    }
    if (effort) {
      runtime.reasoningEfforts.add(effort);
      const stat = effortStats.get(effort) ?? { turns: 0, sessions: new Set<string>() };
      stat.turns += 1;
      stat.sessions.add(sessionId);
      effortStats.set(effort, stat);
    }
    runtimeBySession.set(sessionId, runtime);
  }
  const analyzedRows = db.prepare(`SELECT DISTINCT insight.session_id AS id FROM insights insight
    JOIN sessions session ON session.id = insight.session_id
    WHERE insight.source = 'llm' AND insight.type IN ('summary', 'decision', 'learning', 'prompt_quality')
      AND lower(trim(insight.title)) NOT IN ('no coding activity captured', 'no coding session activity was captured')
      AND session.deleted_at IS NULL AND session.started_at >= ? AND session.started_at <= ?`).all(startsAt, endsAt) as Array<{ id: string }>;
  const semanticEnrichedIds = new Set(analyzedRows.filter((row) => eligibleIds.has(row.id)).map((row) => row.id));
  const eligibleHumanMessages = humanMessages.filter((message) => eligibleIds.has(message.sessionId));
  const firstBySession = new Map<string, MessageRow>();
  for (const message of eligibleHumanMessages) if (!firstBySession.has(message.sessionId)) firstBySession.set(message.sessionId, message);
  const followups = eligibleHumanMessages.filter((message) => firstBySession.get(message.sessionId) !== message);
  const firstMessages = [...firstBySession.values()];
  const openingClusterCounts = new Map<string, number>();
  for (const message of firstMessages) {
    const normalized = message.content.trim().replace(/\s+/g, ' ');
    const ref = createHash('sha256').update(normalized).digest('hex').slice(0, 12);
    openingClusterCounts.set(ref, (openingClusterCounts.get(ref) ?? 0) + 1);
  }
  const projectsByDay = new Map<string, Set<string>>();
  for (const session of sessions) {
    const day = session.startedAt.slice(0, 10);
    const projects = projectsByDay.get(day) ?? new Set<string>();
    projects.add(session.projectId);
    projectsByDay.set(day, projects);
  }
  const taskCounts = db.prepare(`SELECT
      SUM(CASE WHEN id = root_task_id THEN 1 ELSE 0 END) AS roots,
      SUM(CASE WHEN id <> root_task_id THEN 1 ELSE 0 END) AS children
    FROM work_tasks WHERE started_at >= ? AND started_at <= ?`).get(startsAt, endsAt) as { roots: number | null; children: number | null };
  const oldest = sessions[0]?.startedAt ?? endsAt;
  const newest = sessions.at(-1)?.startedAt ?? endsAt;
  const spanDays = sessions.length < 2 ? 0 : Number(((Date.parse(newest) - Date.parse(oldest)) / 86_400_000).toFixed(1));
  const pathPattern = /(?:^|\s)(?:\/[\w.@+~-]+\/|[A-Za-z]:\\|[\w.-]+\/[\w.-]+)/;
  const constraintPattern = /(?:must|must not|only|preserve|do not|禁止|不要|只能|必须|保持|不变量)/i;
  const validationPattern = /(?:test|verify|lint|build|typecheck|xcodebuild|gradle|验证|测试|构建|检查)/i;
  const skillPattern = /(?:\$[\w:-]+|\bskill\b|\bOMX\b|技能)/i;
  const correctionPattern = /(?:不是|不对|仍然|还是|遗漏|改成|修正|补充|actually|instead|still|wrong|missed|change it to)/i;
  const projectSwitchesWithinTwoHours = sessions.slice(1).filter((session, index) => {
    const previous = sessions[index]!;
    return session.projectId !== previous.projectId
      && Date.parse(session.startedAt) - Date.parse(previous.startedAt) <= 2 * 60 * 60 * 1_000;
  }).length;

  const priorRows = db.prepare(`SELECT session_id AS sessionId, type, title, summary, metadata,
      created_at AS createdAt
    FROM insights WHERE source = 'llm' AND created_at >= ?
      AND type IN ('summary', 'decision', 'learning', 'prompt_quality')
    ORDER BY created_at DESC`).all(startsAt) as Array<{
      sessionId: string; type: string; title: string; summary: string; metadata: string; createdAt: string;
    }>;
  const priorLlmFindings = priorRows.filter((row) => eligibleIds.has(row.sessionId)
    && !['no coding activity captured', 'no coding session activity was captured'].includes(row.title.trim().toLowerCase()))
    .map((row) => {
    const metadata = safeObject(row.metadata);
    const findingCategories = Array.isArray(metadata.findings)
      ? metadata.findings.slice(0, 8).map((item) => {
        const finding = item && typeof item === 'object' ? item as Record<string, unknown> : {};
        return { category: finding.category, type: finding.type, impact: finding.impact };
      }) : [];
    const skillUsage = Array.isArray(metadata.skill_usage)
      ? metadata.skill_usage.slice(0, 8).map((item) => {
        const usage = item && typeof item === 'object' ? item as Record<string, unknown> : {};
        return {
          name: usage.name,
          fit: usage.fit,
          observation: usage.observation,
          issue: usage.issue,
          recommendation: usage.recommendation,
        };
      }) : [];
    return {
      sessionRef: row.sessionId,
      type: row.type,
      title: row.title,
      summary: row.summary,
      findingCategories,
      skillUsage,
    };
  });
  const findingsBySession = new Map<string, typeof priorLlmFindings>();
  for (const finding of priorLlmFindings) {
    const current = findingsBySession.get(finding.sessionRef) ?? [];
    current.push(finding);
    findingsBySession.set(finding.sessionRef, current);
  }
  const episodeCandidates: BehaviorReportDataset['representativeEpisodes'] = [];
  const messagesBySession = new Map<string, MessageRow[]>();
  for (const message of eligibleHumanMessages) {
    messagesBySession.set(message.sessionId, [...(messagesBySession.get(message.sessionId) ?? []), message]);
  }
  const highToolThreshold = percentile(sessions.map((session) => session.toolCallCount), 0.9);
  for (const session of sessions) {
    const sessionRef = session.id;
    const findings = findingsBySession.get(sessionRef) ?? [];
    const sessionMessages = messagesBySession.get(sessionRef) ?? [];
    const firstMessage = sessionMessages[0]?.content ?? '';
    const openingMessageRef = createHash('sha256')
      .update(firstMessage.trim().replace(/\s+/g, ' '))
      .digest('hex').slice(0, 12);
    const sessionFollowups = sessionMessages.slice(1);
    const shortFollowupCount = sessionFollowups.filter((message) => message.content.trim().length <= 40).length;
    const userMessages = humanCounts.get(sessionRef) ?? 0;
    const lengthBand = userMessages <= 3 ? 'short' : userMessages <= 10 ? 'medium' : 'long';
    const categories = findings.flatMap((finding) => finding.findingCategories)
      .map((finding) => String(finding.category ?? ''));
    const hasSkill = findings.some((finding) => finding.skillUsage.length > 0);
    const selectionReasons = ['structural-analysis', `length:${lengthBand}`];
    if (semanticEnrichedIds.has(sessionRef)) selectionReasons.push('semantic-enrichment');
    if (hasSkill) selectionReasons.push('skill-use');
    if (session.compactCount > 0) selectionReasons.push('context-compaction');
    if (highToolThreshold > 0 && session.toolCallCount >= highToolThreshold) selectionReasons.push('high-tool-use');
    if (sessionFollowups.length >= 2 && ratio(shortFollowupCount, sessionFollowups.length) >= 0.5) {
      selectionReasons.push('short-steering');
    }
    if (sessionFollowups.some((message) => correctionPattern.test(message.content))
      || categories.some((category) => ['productive-correction', 'late-constraint'].includes(category))) {
      selectionReasons.push('course-correction');
    }
    episodeCandidates.push({
      sessionRef,
      cohort: { projectRef: session.projectId, projectLabel: session.projectName, lengthBand },
      activity: {
        durationMinutes: Math.max(0, Math.round((Date.parse(session.endedAt) - Date.parse(session.startedAt)) / 60_000)),
        userMessages,
        assistantMessages: assistantCounts.get(sessionRef) ?? 0,
        toolCalls: session.toolCallCount,
        compactCount: session.compactCount,
      },
      runtime: {
        models: [...(runtimeBySession.get(sessionRef)?.models ?? [])],
        reasoningEfforts: [...(runtimeBySession.get(sessionRef)?.reasoningEfforts ?? [])],
      },
      behaviorSignals: {
        firstMessage: {
          hasPathContext: pathPattern.test(firstMessage),
          hasConstraintUpfront: constraintPattern.test(firstMessage),
          hasValidationUpfront: validationPattern.test(firstMessage),
          hasSkillReference: skillPattern.test(firstMessage),
        },
        openingMessageCluster: {
          ref: `opening:${openingMessageRef}`,
          sessions: openingClusterCounts.get(openingMessageRef) ?? 1,
        },
        followups: {
          messages: sessionFollowups.length,
          shortMessages: shortFollowupCount,
          shortRate: ratio(shortFollowupCount, sessionFollowups.length),
        },
        semanticEnriched: semanticEnrichedIds.has(sessionRef),
      },
      selectionReasons,
      findings: findings.slice(0, 8).map(({ sessionRef: _sessionRef, ...finding }) => finding),
    });
  }
  const buckets = new Map<string, typeof episodeCandidates>();
  for (const episode of episodeCandidates) {
    const key = `${episode.cohort.projectRef}:${episode.cohort.lengthBand}`;
    buckets.set(key, [...(buckets.get(key) ?? []), episode]);
  }
  const episodeScore = (episode: typeof episodeCandidates[number]) => episode.activity.compactCount * 4
    + (episode.cohort.lengthBand === 'long' ? 6 : episode.cohort.lengthBand === 'medium' ? 3 : 0)
    + (episode.selectionReasons.includes('course-correction') ? 3 : 0)
    + (episode.selectionReasons.includes('high-tool-use') ? 2 : 0)
    + (episode.behaviorSignals.semanticEnriched ? 1 : 0);
  for (const bucket of buckets.values()) {
    bucket.sort((left, right) => episodeScore(right) - episodeScore(left)
      || left.sessionRef.localeCompare(right.sessionRef));
  }
  const representativeEpisodes = episodeCandidates.filter((episode) => episode.behaviorSignals.semanticEnriched)
    .sort((left, right) => episodeScore(right) - episodeScore(left)
      || left.sessionRef.localeCompare(right.sessionRef))
    .slice(0, 6);
  const selectedRefs = new Set(representativeEpisodes.map((episode) => episode.sessionRef));
  while (representativeEpisodes.length < 24 && [...buckets.values()].some((bucket) => bucket.length > 0)) {
    for (const bucket of buckets.values()) {
      let episode = bucket.shift();
      while (episode && selectedRefs.has(episode.sessionRef)) episode = bucket.shift();
      if (episode) {
        representativeEpisodes.push(episode);
        selectedRefs.add(episode.sessionRef);
      }
      if (representativeEpisodes.length >= 24) break;
    }
  }
  const runtimeUsage: BehaviorReportDataset['runtimeUsage'] = {
    models: [...modelStats.entries()]
      .map(([name, stat]) => ({
        name, turns: stat.turns, sessions: stat.sessions.size, sessionRefs: [...stat.sessions].slice(0, 12),
      }))
      .sort((left, right) => right.turns - left.turns || left.name.localeCompare(right.name)),
    reasoningEfforts: [...effortStats.entries()]
      .map(([name, stat]) => ({
        name, turns: stat.turns, sessions: stat.sessions.size, sessionRefs: [...stat.sessions].slice(0, 12),
      }))
      .sort((left, right) => right.turns - left.turns || left.name.localeCompare(right.name)),
    measurementNote: '模型与推理强度来自每轮 Agent 上下文。使用更多、更强或更贵的配置不自动代表更合适；只有结合任务类型和可观察结果才能评价。',
  };
  const emptyLeverage: BehaviorReportDataset['leverage'] = {
    skills: {
      explicitInvocations: 0, automaticInvocations: 0, agentReadEvents: 0,
      coveredSessions: 0, items: [],
    },
    tools: { totalCalls: 0, coveredTasks: 0, families: [], topTools: [] },
  };
  let leverage = emptyLeverage;
  if (options.includeLeverage !== false) {
  const taskIdentityRows = db.prepare(`SELECT id, root_task_id AS rootTaskId, thread_id AS threadId
    FROM work_tasks WHERE started_at >= ? AND started_at <= ?`).all(startsAt, endsAt) as Array<{
      id: string; rootTaskId: string; threadId: string;
    }>;
  const eligibleRootTaskIds = new Set(taskIdentityRows
    .filter((row) => row.id === row.rootTaskId && eligibleThreadIds.has(row.threadId))
    .map((row) => row.rootTaskId));
  const toolRows = (db.prepare(`SELECT event.task_id AS taskId, task.root_task_id AS rootTaskId,
      event.thread_id AS threadId,
      event.occurred_at AS occurredAt, event.payload_json AS payloadJson
    FROM work_tasks task
    CROSS JOIN canonical_events event INDEXED BY idx_canonical_events_task_time ON event.task_id = task.id
    WHERE event.kind = 'tool-call'
      AND task.started_at >= ? AND task.started_at <= ?
    ORDER BY event.occurred_at, event.sequence`).all(startsAt, endsAt) as CanonicalToolRow[])
    .filter((row) => eligibleRootTaskIds.has(row.rootTaskId));
  const parsedTools = toolRows.map((row) => {
    const payload = safeObject(row.payloadJson);
    return {
      ...row,
      name: typeof payload.toolName === 'string' && payload.toolName.trim() ? payload.toolName.trim() : 'unknown',
    };
  });
  const toolStats = new Map<string, { calls: number; tasks: Set<string> }>();
  const familyStats = new Map<string, { calls: number; tasks: Set<string> }>();
  for (const row of parsedTools) {
    const tool = toolStats.get(row.name) ?? { calls: 0, tasks: new Set<string>() };
    tool.calls += 1;
    tool.tasks.add(row.taskId);
    toolStats.set(row.name, tool);
    const familyName = toolFamily(row.name);
    const family = familyStats.get(familyName) ?? { calls: 0, tasks: new Set<string>() };
    family.calls += 1;
    family.tasks.add(row.taskId);
    familyStats.set(familyName, family);
  }
  const skillSessions = new Map<string, Set<string>>();
  const userSkillInvocations = new Map<string, number>();
  const automaticSkillInvocations = new Map<string, number>();
  const agentSkillReads = new Map<string, number>();
  const skillWeeklyInvocations = new Map<string, [number, number, number, number]>();
  const skillLastUsedAt = new Map<string, string>();
  const skillsBySession = new Map<string, Set<string>>();
  const userSkillsBySession = new Map<string, Set<string>>();
  for (const message of eligibleHumanMessages) {
    const names = userInvokedSkillNames(message.content);
    const sessionNames = skillsBySession.get(message.sessionId) ?? new Set<string>();
    const userSessionNames = userSkillsBySession.get(message.sessionId) ?? new Set<string>();
    for (const name of names) {
      userSkillInvocations.set(name, (userSkillInvocations.get(name) ?? 0) + 1);
      const covered = skillSessions.get(name) ?? new Set<string>();
      covered.add(message.sessionId);
      skillSessions.set(name, covered);
      sessionNames.add(name);
      userSessionNames.add(name);
      const weekly = skillWeeklyInvocations.get(name) ?? [0, 0, 0, 0];
      const position = Math.min(3, Math.max(0, Math.floor(
        (Date.parse(message.timestamp) - Date.parse(startsAt)) / (7.5 * 86_400_000),
      )));
      weekly[position] += 1;
      skillWeeklyInvocations.set(name, weekly);
      if (!skillLastUsedAt.has(name) || message.timestamp > skillLastUsedAt.get(name)!) {
        skillLastUsedAt.set(name, message.timestamp);
      }
    }
    skillsBySession.set(message.sessionId, sessionNames);
    userSkillsBySession.set(message.sessionId, userSessionNames);
  }
  for (const message of messages.filter((item) => item.type === 'assistant' && eligibleIds.has(item.sessionId))) {
    const sessionNames = skillsBySession.get(message.sessionId) ?? new Set<string>();
    const userSessionNames = userSkillsBySession.get(message.sessionId) ?? new Set<string>();
    for (const name of agentAppliedSkillNames(message.toolCalls)) {
      agentSkillReads.set(name, (agentSkillReads.get(name) ?? 0) + 1);
      if (!userSessionNames.has(name)) {
        automaticSkillInvocations.set(name, (automaticSkillInvocations.get(name) ?? 0) + 1);
      }
      const covered = skillSessions.get(name) ?? new Set<string>();
      covered.add(message.sessionId);
      skillSessions.set(name, covered);
      sessionNames.add(name);
      const weekly = skillWeeklyInvocations.get(name) ?? [0, 0, 0, 0];
      if (!userSessionNames.has(name)) {
        const position = Math.min(3, Math.max(0, Math.floor(
          (Date.parse(message.timestamp) - Date.parse(startsAt)) / (7.5 * 86_400_000),
        )));
        weekly[position] += 1;
        skillWeeklyInvocations.set(name, weekly);
      }
      if (!skillLastUsedAt.has(name) || message.timestamp > skillLastUsedAt.get(name)!) {
        skillLastUsedAt.set(name, message.timestamp);
      }
    }
    skillsBySession.set(message.sessionId, sessionNames);
  }
  const coUse = (name: string) => {
    const counts = new Map<string, number>();
    for (const names of skillsBySession.values()) {
      if (!names.has(name)) continue;
      for (const other of names) if (other !== name) counts.set(other, (counts.get(other) ?? 0) + 1);
    }
    return [...counts.entries()].map(([other, count]) => ({ name: other, sessions: count }))
      .sort((a, b) => b.sessions - a.sessions || a.name.localeCompare(b.name)).slice(0, 3);
  };
  leverage = {
    skills: {
      explicitInvocations: [...userSkillInvocations.values()].reduce((sum, count) => sum + count, 0),
      automaticInvocations: [...automaticSkillInvocations.values()].reduce((sum, count) => sum + count, 0),
      agentReadEvents: [...agentSkillReads.values()].reduce((sum, count) => sum + count, 0),
      coveredSessions: new Set([...skillSessions.values()].flatMap((ids) => [...ids])).size,
      items: [...new Set([
        ...userSkillInvocations.keys(),
        ...automaticSkillInvocations.keys(),
        ...agentSkillReads.keys(),
      ])].map((name) => {
        const covered = skillSessions.get(name) ?? new Set<string>();
        const userInvocations = userSkillInvocations.get(name) ?? 0;
        const automaticInvocations = automaticSkillInvocations.get(name) ?? 0;
        return {
          name,
          invocations: userInvocations + automaticInvocations,
          userInvocations,
          automaticInvocations,
          agentReadEvents: agentSkillReads.get(name) ?? 0,
          sessions: covered.size,
          sessionShare: ratio(covered.size, sessions.length),
          weeklyInvocations: skillWeeklyInvocations.get(name) ?? [0, 0, 0, 0],
          lastUsedAt: skillLastUsedAt.get(name) ?? null,
          coUsedWith: coUse(name),
        };
      }).sort((a, b) => b.invocations - a.invocations || a.name.localeCompare(b.name)).slice(0, 12),
    },
    tools: {
      totalCalls: parsedTools.length,
      coveredTasks: new Set(parsedTools.map((row) => row.taskId)).size,
      families: [...familyStats.entries()].map(([family, value]) => ({
        family,
        calls: value.calls,
        tasks: value.tasks.size,
      })).sort((a, b) => b.calls - a.calls),
      topTools: [...toolStats.entries()].map(([name, value]) => ({ name, calls: value.calls, tasks: value.tasks.size }))
        .sort((a, b) => b.calls - a.calls || a.name.localeCompare(b.name)).slice(0, 12),
    },
  };
  }
  const contextDocuments = buildContextDocumentSummary(sessions, humanCounts, eligibleHumanMessages);
  const inputTokens = sessions.reduce((sum, session) => sum + (session.inputTokens ?? 0), 0);
  const outputTokens = sessions.reduce((sum, session) => sum + (session.outputTokens ?? 0), 0);
  const cacheCreationTokens = sessions.reduce((sum, session) => sum + (session.cacheCreationTokens ?? 0), 0);
  const cacheReadTokens = sessions.reduce((sum, session) => sum + (session.cacheReadTokens ?? 0), 0);
  const observedTokenVolume = inputTokens + outputTokens + cacheCreationTokens + cacheReadTokens;
  const tokenEfficiency: BehaviorReportDataset['tokenEfficiency'] = {
    inputTokens,
    outputTokens,
    cacheCreationTokens,
    cacheReadTokens,
    cacheReadShare: ratio(cacheReadTokens, observedTokenVolume),
    tokensPerUserMessage: eligibleHumanMessages.length === 0
      ? 0 : Math.round(observedTokenVolume / eligibleHumanMessages.length),
    sessionsWithCompaction: sessions.filter((session) => session.compactCount > 0).length,
    longSessions: sessions.filter((session) => (humanCounts.get(session.id) ?? 0) > 12).length,
    p90UserMessages: percentile(sessions.map((session) => humanCounts.get(session.id) ?? 0), 0.9),
    measurementNote: 'Token 为客户端可观察用量；缓存字段按来源上报口径展示。只能提出节省机制与适用场景，不能把更低 token 自动等同于更高质量。',
  };
  return {
    window: { startsAt, endsAt, spanDays },
    basis: {
      generatedAt: endsAt,
      latestSessionAt: sessions.at(-1)?.startedAt ?? null,
      latestLlmAnalysisAt: priorRows[0]?.createdAt ?? null,
    },
    coverage: {
      windowSessions: sessions.length,
      structurallyAnalyzedSessions: sessions.length,
      semanticEnrichedSessions: semanticEnrichedIds.size,
      structuralRatio: ratio(sessions.length, sessions.length),
      semanticEnrichmentRatio: ratio(semanticEnrichedIds.size, sessions.length),
    },
    activity: {
      rootTasks: taskCounts.roots ?? 0,
      subagentTasks: taskCounts.children ?? 0,
      userMessages: eligibleHumanMessages.length,
      medianUserMessagesPerSession: median(sessions.map((session) => humanCounts.get(session.id) ?? 0)),
      p90UserMessagesPerSession: percentile(sessions.map((session) => humanCounts.get(session.id) ?? 0), 0.9),
      compactCount: sessions.reduce((sum, session) => sum + session.compactCount, 0),
      shortFollowups: followups.filter((message) => message.content.trim().length <= 40).length,
      followupMessages: followups.length,
      shortFollowupRate: ratio(followups.filter((message) => message.content.trim().length <= 40).length, followups.length),
      sessionsOverFiveUserMessages: sessions.filter((session) => (humanCounts.get(session.id) ?? 0) > 5).length,
      maxUserMessagesPerSession: Math.max(0, ...sessions.map((session) => humanCounts.get(session.id) ?? 0)),
      activeDays: projectsByDay.size,
      medianProjectsPerActiveDay: median([...projectsByDay.values()].map((projects) => projects.size)),
      projectSwitchesWithinTwoHours,
      distinctOpeningMessages: openingClusterCounts.size,
      sessionsInRepeatedOpeningClusters: [...openingClusterCounts.values()]
        .filter((count) => count > 1).reduce((sum, count) => sum + count, 0),
    },
    promptSignals: {
      firstMessages: firstMessages.length,
      withPath: firstMessages.filter((message) => pathPattern.test(message.content)).length,
      withConstraint: firstMessages.filter((message) => constraintPattern.test(message.content)).length,
      withValidation: firstMessages.filter((message) => validationPattern.test(message.content)).length,
      withSkillReference: firstMessages.filter((message) => skillPattern.test(message.content)).length,
    },
    representativeEpisodes,
    runtimeUsage,
    leverage,
    contextDocuments,
    tokenEfficiency,
  };
}

export function behaviorReportUnavailableReason(dataset: BehaviorReportDataset): string | null {
  if (dataset.coverage.structurallyAnalyzedSessions < 10) return 'insufficient-structural-sessions';
  if (dataset.window.spanDays < 7) return 'insufficient-time-span';
  return null;
}

const stringArray = { type: 'array', items: { type: 'string' } } as const;

const RESEARCH_SCHEMA = {
  type: 'object',
  required: ['profileThesis', 'behavioralFindings', 'dimensions', 'contradictions', 'missingEvidence'],
  properties: {
    profileThesis: { type: 'string' },
    behavioralFindings: { type: 'array', items: { type: 'object', required: ['title', 'observation', 'mechanism', 'applicability', 'counterEvidence', 'evidenceRefs'], properties: {
      title: { type: 'string' }, observation: { type: 'string' }, mechanism: { type: 'string' },
      applicability: stringArray, counterEvidence: stringArray, evidenceRefs: stringArray,
    } } },
    dimensions: { type: 'array', items: { type: 'object', required: ['id', 'label', 'status', 'observation', 'mechanism', 'applicability', 'counterEvidence', 'benefitHypothesis', 'confidence', 'evidenceRefs'], properties: {
      id: { type: 'string' }, label: { type: 'string' }, status: { type: 'string', enum: ['established', 'candidate', 'qualitative'] },
      observation: { type: 'string' }, mechanism: { type: 'string' }, applicability: stringArray,
      counterEvidence: stringArray, benefitHypothesis: { type: 'string' },
      confidence: { type: 'string', enum: ['high', 'medium', 'low'] }, evidenceRefs: stringArray,
    } } },
    contradictions: stringArray,
    missingEvidence: stringArray,
  },
} as const;

const REPORT_SCHEMA = {
  type: 'object',
  required: ['identity', 'headline', 'summary', 'portrait', 'strengths', 'bottlenecks', 'dimensions', 'skillAssessments', 'runtimeAssessments', 'contextDocumentAssessments', 'tokenEfficiencyFindings', 'skillOpportunities', 'developmentPlan', 'uncertainty'],
  properties: {
    identity: { type: 'object', required: ['title', 'stage', 'rationale', 'evidenceRefs'], properties: {
      title: { type: 'string' }, stage: { type: 'string' }, rationale: { type: 'string' }, evidenceRefs: stringArray,
    } },
    headline: { type: 'string' }, summary: { type: 'string' },
    portrait: { type: 'array', items: { type: 'object', required: ['title', 'finding', 'evidenceRefs'], properties: {
      title: { type: 'string' }, finding: { type: 'string' }, evidenceRefs: stringArray,
    } } },
    strengths: { type: 'array', items: { type: 'object', required: ['title', 'explanation', 'mechanism', 'evidenceRefs'], properties: {
      title: { type: 'string' }, explanation: { type: 'string' }, mechanism: { type: 'string' }, evidenceRefs: stringArray,
    } } },
    bottlenecks: { type: 'array', items: { type: 'object', required: ['title', 'explanation', 'mechanism', 'counterEvidence', 'evidenceRefs'], properties: {
      title: { type: 'string' }, explanation: { type: 'string' }, mechanism: { type: 'string' },
      counterEvidence: stringArray, evidenceRefs: stringArray,
    } } },
    dimensions: { type: 'array', items: { type: 'object', required: ['id', 'label', 'status', 'observation', 'benefitHypothesis', 'applicability', 'limitations', 'confidence', 'evidenceRefs'], properties: {
      id: { type: 'string' }, label: { type: 'string' }, status: { type: 'string', enum: ['established', 'candidate', 'qualitative'] },
      observation: { type: 'string' }, benefitHypothesis: { type: 'string' }, applicability: stringArray,
      limitations: stringArray, confidence: { type: 'string', enum: ['high', 'medium', 'low'] }, evidenceRefs: stringArray,
    } } },
    skillAssessments: { type: 'array', items: { type: 'object', required: ['name', 'fit', 'observation', 'issue', 'recommendation', 'evidenceRefs'], properties: {
      name: { type: 'string' }, fit: { type: 'string', enum: ['appropriate', 'mixed', 'uncertain'] },
      observation: { type: 'string' }, issue: { type: ['string', 'null'] }, recommendation: { type: 'string' }, evidenceRefs: stringArray,
    } } },
    runtimeAssessments: { type: 'array', items: { type: 'object', required: ['category', 'target', 'fit', 'observation', 'issue', 'recommendation', 'applicability', 'evidenceRefs'], properties: {
      category: { type: 'string', enum: ['model', 'reasoning-effort'] }, target: { type: 'string' },
      fit: { type: 'string', enum: ['appropriate', 'mixed', 'uncertain'] },
      observation: { type: 'string' }, issue: { type: ['string', 'null'] },
      recommendation: { type: 'string' }, applicability: { type: 'string' }, evidenceRefs: stringArray,
    } } },
    contextDocumentAssessments: { type: 'array', items: { type: 'object', required: ['documentRef', 'name', 'assessment', 'observation', 'tokenCost', 'optimization', 'evidenceRefs'], properties: {
      documentRef: { type: 'string' }, name: { type: 'string' },
      assessment: { type: 'string', enum: ['helpful', 'mixed', 'costly', 'uncertain'] },
      observation: { type: 'string' }, tokenCost: { type: 'string' }, optimization: { type: ['string', 'null'] }, evidenceRefs: stringArray,
    } } },
    tokenEfficiencyFindings: { type: 'array', items: { type: 'object', required: ['title', 'observation', 'savingMechanism', 'applicability', 'evidenceRefs'], properties: {
      title: { type: 'string' }, observation: { type: 'string' }, savingMechanism: { type: 'string' },
      applicability: { type: 'string' }, evidenceRefs: stringArray,
    } } },
    skillOpportunities: { type: 'array', items: { type: 'object', required: ['type', 'name', 'necessity', 'trigger', 'evidence', 'expectedBenefit', 'evidenceRefs'], properties: {
      type: { type: 'string', enum: ['existing-skill', 'create-skill'] }, name: { type: 'string' },
      necessity: { type: 'string', enum: ['high', 'medium'] }, trigger: { type: 'string' },
      evidence: { type: 'string' }, expectedBenefit: { type: 'string' }, evidenceRefs: stringArray,
    } } },
    developmentPlan: { type: 'object', required: ['northStar', 'operatingRules', 'experiments', 'taskTemplate'], properties: {
      northStar: { type: 'string' }, operatingRules: stringArray, taskTemplate: { type: 'string' },
      experiments: { type: 'array', items: { type: 'object', required: ['title', 'hypothesis', 'eligibleCohort', 'observableOutcome', 'guardrail', 'reviewAfter', 'evidenceRefs'], properties: {
        title: { type: 'string' }, hypothesis: { type: 'string' }, eligibleCohort: { type: 'string' },
        observableOutcome: { type: 'string' }, guardrail: { type: 'string' }, reviewAfter: { type: 'string' }, evidenceRefs: stringArray,
      } } },
    } },
    uncertainty: { type: 'string' },
  },
} as const;

const INVESTIGATOR_PROMPT = `You are the investigator in a two-stage personal engineering behavior study. The deterministic aggregates cover the full structurally readable 30-day behavior corpus. Representative episodes are sampled from that full corpus; their findings arrays are optional session-level semantic enrichment, never an eligibility condition. Work from privacy-bounded engineering episodes and deterministic aggregate facts. Discover recurring behavior and mechanisms instead of filling a fixed capability rubric. Contrast task cohorts, identify counterexamples, and separate observations from benefit hypotheses. Evaluate context documents only from metadata, instruction density, coverage and cohort outcomes; never imply that correlation proves causation. Analyze token efficiency through concrete mechanisms such as repeated context loading, long-thread compaction, duplicated instructions, cache reuse and unnecessary steering, while preserving quality and safety. Evaluate model and reasoning-effort choices against the observable task type, complexity, duration, tool use, corrections and outcome evidence. A larger model or higher reasoning effort is not automatically better; a smaller or lower setting is not automatically cheaper in practice if it causes retries. Mark fit uncertain when the available record does not support a task-to-runtime comparison. Do not interpret missing semantic enrichment as missing behavior. A dimension is only established when repeated evidence and counterexample review support it; otherwise mark it candidate or qualitative. Verification can happen outside the Agent transcript. Absence of a captured validation command means unknown, not unverified; claim that validation did not happen only when explicit evidence says so. Some sessions can be created automatically by orchestration systems such as OMX workers rather than directly opened by the user. Use repeated opening-message clusters, task relationships, activity structure and semantic findings only as clues; let the evidence support the distinction, do not apply a fixed name or format filter, and do not count every session as an independent user-started task when origin is uncertain. Skill userInvocations are user-specified uses; automaticInvocations mean the Agent read and applied SKILL.md without the user naming that Skill. Analyze them separately and do not attribute automatic usage to user choice. Do not invent scores, target percentages, causal claims, or evidence references. Write in plain, idiomatic Simplified Chinese. Avoid invented management jargon, compressed slogans and untranslated analytical labels. Return only JSON matching the schema.`;

const COACH_PROMPT = `You are a senior engineering coach synthesizing an investigator's evidence review into a clear Agent-usage review. Produce a coherent narrative: current working style, recurring usage patterns, strengths, limiting factors, context-document effectiveness, token-saving opportunities, Skill and Agent usage, model and reasoning-effort fit, and bounded improvement suggestions. Prefer clear explanations over generic productivity advice. Preserve contradictions and applicability boundaries. Never turn a candidate dimension into a score or assume that more is better. For runtimeAssessments, only evaluate recorded model or reasoning-effort choices when the supplied episodes support a task-specific comparison. Explain where a setting fits, where it may be excessive or insufficient, and what bounded change to try; otherwise use uncertain. Do not recommend one global model or effort for every task. Verification can happen outside the Agent transcript: missing captured commands must remain unknown unless explicit evidence says validation was not performed. Distinguish user-started work from likely orchestration-created worker sessions when the investigator provides support, and keep the origin uncertain when evidence is insufficient. Distinguish userInvocations from automaticInvocations when discussing Skills; an Agent reading SKILL.md without the user naming that Skill is automatic usage, not user-initiated usage. Skill opportunities are not mandatory: return an empty skillOpportunities array unless repeated evidence shows that an existing Skill would materially reduce work or a stable repeated workflow merits a new Skill. Do not recommend a Skill merely because it exists. Token advice must name the saving mechanism and the task cohort where it applies; never trade away verification or necessary context just to reduce token count. Every substantive claim must cite only provided session or context-document references. Write in plain, idiomatic Simplified Chinese that a first-time user can understand. In user-visible fields, do not use “画像”, “高杠杆”, “北极星”, “steering”, “cohort”, “mechanism”, “profile”, or “portrait”; write “使用总结”, “中途纠偏”, “同类任务”, “原因” or another direct Chinese phrase instead. Avoid invented compounds, management jargon, compressed slogans, untranslated analytical labels, and the word “实验” when “改进做法” or “尝试” is clearer. Return only JSON matching the schema.`;

function reportInputSummary(
  dataset: BehaviorReportDataset,
  research?: BehaviorResearch,
  analysisControls?: Record<string, boolean>,
): Record<string, unknown> {
  const cohortCounts = new Map<string, number>();
  for (const episode of dataset.representativeEpisodes) {
    const key = `${episode.cohort.projectRef}:${episode.cohort.lengthBand}`;
    cohortCounts.set(key, (cohortCounts.get(key) ?? 0) + 1);
  }
  return {
    window: dataset.window,
    basis: dataset.basis,
    coverage: dataset.coverage,
    activity: dataset.activity,
    promptSignals: dataset.promptSignals,
    runtimeUsage: dataset.runtimeUsage,
    leverage: dataset.leverage,
    contextDocuments: dataset.contextDocuments,
    tokenEfficiency: dataset.tokenEfficiency,
    representativeSample: {
      count: dataset.representativeEpisodes.length,
      cohorts: [...cohortCounts.entries()].map(([cohort, count]) => ({ cohort, count })),
      sessionRefs: dataset.representativeEpisodes.map((episode) => episode.sessionRef),
    },
    ...(research ? { research } : {}),
    ...(analysisControls ? { analysisControls } : {}),
  };
}

function sumUsage(first: number | null | undefined, second: number | null | undefined): number | null {
  if (first == null && second == null) return null;
  return (first ?? 0) + (second ?? 0);
}

function runnerFailureReason(error: unknown): string {
  const message = error instanceof Error ? error.message.toLowerCase() : '';
  if (/rate.?limit|too many requests|\b429\b/.test(message)) return 'runner-rate-limited';
  if (/auth|unauthori[sz]ed|forbidden|\b401\b|\b403\b/.test(message)) {
    return 'runner-authentication-failed';
  }
  if (/timed? out|timeout/.test(message)) return 'runner-timeout';
  if (/model.*(?:not found|unavailable)|unsupported model/.test(message)) {
    return 'runner-model-unavailable';
  }
  if (/service unavailable|temporarily unavailable|fetch failed|econnrefused|connection refused|\b502\b|\b503\b|\b504\b/.test(message)) {
    return 'runner-service-unavailable';
  }
  return 'runner-failed';
}

export async function generateBehaviorReport(options: {
  db?: Database.Database;
  runner?: AnalysisRunner;
  now?: Date;
} = {}): Promise<{ status: 'completed'; report: BehaviorReport } | { status: 'unavailable'; reason: string }> {
  const db = options.db ?? getDb();
  const dataset = buildBehaviorReportDataset(db, options.now);
  const capabilities = loadConfig()?.dashboard?.capabilities;
  const analysisControls = {
    contextDocumentAnalysis: capabilities?.contextDocumentAnalysis !== false,
    tokenEfficiencyAnalysis: capabilities?.tokenEfficiencyAnalysis !== false,
    skillOpportunityAnalysis: capabilities?.skillOpportunityAnalysis !== false,
  };
  const unavailableReason = behaviorReportUnavailableReason(dataset);
  const summary = reportInputSummary(dataset, undefined, analysisControls);
  if (unavailableReason) {
    recordAnalysisRun({
      analysisType: 'behavior_report', status: 'unavailable', unavailableReason,
      promptVersion: BEHAVIOR_REPORT_PROMPT_VERSION,
      inputSummary: summary,
    }, db);
    return { status: 'unavailable', reason: unavailableReason };
  }
  const researchPrompt = `阶段一：检查最近 30 天的全量结构化使用记录，找出常见做法、原因、反例和值得继续观察的方面。\n\n确定性汇总覆盖全部可结构分析会话；代表性工程行为片段从全量窗口分层抽样，findings 只是可选的单会话语义增强。输入不含原始消息正文。Skill 数据中的 userInvocations 表示用户指定，automaticInvocations 表示 Agent 在用户未指定时读取并应用 Skill 指令，不要混为一类。runtimeUsage 和每个代表性片段的 runtime 记录实际模型与推理强度；只能结合任务特点和结果证据评价是否合适，不能把更强或更高自动当成更好。分析开关为 ${JSON.stringify(analysisControls)}；关闭的维度不得生成结论。\n\n${JSON.stringify(dataset, null, 2)}`;
  let runner: AnalysisRunner;
  try {
    runner = options.runner ?? createAnalysisRunnerFromPolicy().runner;
  } catch (error) {
    recordAnalysisRun({
      analysisType: 'behavior_report', status: 'failed', unavailableReason: 'runner-unavailable',
      promptVersion: BEHAVIOR_REPORT_PROMPT_VERSION, systemPrompt: `${INVESTIGATOR_PROMPT}\n\n${COACH_PROMPT}`,
      inputPrompt: researchPrompt,
      inputSummary: summary,
    }, db);
    throw error;
  }
  let researchResult: RunAnalysisResult;
  try {
    researchResult = await runner.runAnalysis({ systemPrompt: INVESTIGATOR_PROMPT, userPrompt: researchPrompt, jsonSchema: RESEARCH_SCHEMA });
  } catch (error) {
    recordAnalysisRun({
      analysisType: 'behavior_report', status: 'failed', unavailableReason: runnerFailureReason(error),
      promptVersion: BEHAVIOR_REPORT_PROMPT_VERSION, systemPrompt: INVESTIGATOR_PROMPT,
      inputPrompt: researchPrompt,
      inputSummary: summary,
    }, db);
    throw error;
  }
  let research: BehaviorResearch;
  try {
    research = JSON.parse(researchResult.rawJson) as BehaviorResearch;
    if (!research || typeof research.profileThesis !== 'string' || !Array.isArray(research.behavioralFindings)
      || !Array.isArray(research.dimensions) || !Array.isArray(research.contradictions)) {
      throw new Error('invalid behavior research shape');
    }
  } catch (error) {
    recordAnalysisRun({
      analysisType: 'behavior_report', status: 'failed', unavailableReason: 'invalid-model-output',
      provider: researchResult.provider, model: researchResult.model, promptVersion: BEHAVIOR_REPORT_PROMPT_VERSION,
      systemPrompt: INVESTIGATOR_PROMPT, inputPrompt: researchPrompt,
      inputSummary: summary,
      outputJson: researchResult.rawJson, inputTokens: researchResult.inputTokens, outputTokens: researchResult.outputTokens,
      durationMs: researchResult.durationMs,
    }, db);
    throw error;
  }
  const coachInput = {
    facts: {
      window: dataset.window, basis: dataset.basis, coverage: dataset.coverage,
      activity: dataset.activity, promptSignals: dataset.promptSignals, runtimeUsage: dataset.runtimeUsage,
      leverage: dataset.leverage,
      contextDocuments: dataset.contextDocuments, tokenEfficiency: dataset.tokenEfficiency,
    },
    representativeEpisodes: dataset.representativeEpisodes,
    investigatorResearch: research,
    analysisControls,
  };
  const coachUserPrompt = `阶段二：把调查结果整理为“Agent 使用分析与改进建议”。分析方面来自调查结果，不得替换成统一固定量表。\n\n${JSON.stringify(coachInput, null, 2)}`;
  let coachResult: RunAnalysisResult;
  try {
    coachResult = await runner.runAnalysis({ systemPrompt: COACH_PROMPT, userPrompt: coachUserPrompt, jsonSchema: REPORT_SCHEMA });
  } catch (error) {
    recordAnalysisRun({
      analysisType: 'behavior_report', status: 'failed', unavailableReason: runnerFailureReason(error),
      provider: researchResult.provider, model: researchResult.model, promptVersion: BEHAVIOR_REPORT_PROMPT_VERSION,
      systemPrompt: `${INVESTIGATOR_PROMPT}\n\n${COACH_PROMPT}`,
      inputPrompt: `${researchPrompt}\n\n${coachUserPrompt}`,
      inputSummary: reportInputSummary(dataset, research, analysisControls),
      outputJson: researchResult.rawJson, inputTokens: researchResult.inputTokens, outputTokens: researchResult.outputTokens,
      durationMs: researchResult.durationMs,
    }, db);
    throw error;
  }
  let report: BehaviorReport;
  try {
    report = JSON.parse(coachResult.rawJson) as BehaviorReport;
    if (!report || typeof report.headline !== 'string' || typeof report.identity?.title !== 'string'
      || !Array.isArray(report.portrait) || !Array.isArray(report.strengths)
      || !Array.isArray(report.bottlenecks) || !Array.isArray(report.dimensions)
      || !Array.isArray(report.developmentPlan?.experiments)) {
      throw new Error('invalid behavior report shape');
    }
    report.contextDocumentAssessments = Array.isArray(report.contextDocumentAssessments)
      ? report.contextDocumentAssessments : [];
    report.tokenEfficiencyFindings = Array.isArray(report.tokenEfficiencyFindings)
      ? report.tokenEfficiencyFindings : [];
    report.skillOpportunities = Array.isArray(report.skillOpportunities)
      ? report.skillOpportunities : [];
    report.runtimeAssessments = Array.isArray(report.runtimeAssessments)
      ? report.runtimeAssessments : [];
    if (!analysisControls.contextDocumentAnalysis) report.contextDocumentAssessments = [];
    if (!analysisControls.tokenEfficiencyAnalysis) report.tokenEfficiencyFindings = [];
    if (!analysisControls.skillOpportunityAnalysis) report.skillOpportunities = [];
  } catch (error) {
    recordAnalysisRun({
      analysisType: 'behavior_report', status: 'failed', unavailableReason: 'invalid-model-output',
      provider: coachResult.provider, model: coachResult.model, promptVersion: BEHAVIOR_REPORT_PROMPT_VERSION,
      systemPrompt: `${INVESTIGATOR_PROMPT}\n\n${COACH_PROMPT}`,
      inputPrompt: `${researchPrompt}\n\n${coachUserPrompt}`,
      inputSummary: reportInputSummary(dataset, research, analysisControls),
      outputJson: coachResult.rawJson,
      inputTokens: sumUsage(researchResult.inputTokens, coachResult.inputTokens),
      outputTokens: sumUsage(researchResult.outputTokens, coachResult.outputTokens),
      durationMs: researchResult.durationMs + coachResult.durationMs,
    }, db);
    throw error;
  }
  recordAnalysisRun({
    analysisType: 'behavior_report', status: 'completed', provider: coachResult.provider, model: coachResult.model,
    promptVersion: BEHAVIOR_REPORT_PROMPT_VERSION, systemPrompt: `${INVESTIGATOR_PROMPT}\n\n${COACH_PROMPT}`,
    inputPrompt: `${researchPrompt}\n\n${coachUserPrompt}`,
    inputSummary: reportInputSummary(dataset, research, analysisControls),
    outputJson: coachResult.rawJson,
    inputTokens: sumUsage(researchResult.inputTokens, coachResult.inputTokens),
    outputTokens: sumUsage(researchResult.outputTokens, coachResult.outputTokens),
    durationMs: researchResult.durationMs + coachResult.durationMs,
  }, db);
  return { status: 'completed', report };
}
