import { Hono } from 'hono';
import { getDb } from 'agent-usage-analyze/db/client';
import {
  skillNameFromPath,
  userInvokedSkillNames,
} from 'agent-usage-analyze/analysis/skill-usage';

const app = new Hono();

const VALID_RANGES = ['today', '7d', '30d', '90d', 'all'] as const;
type Range = typeof VALID_RANGES[number];

interface SessionAnalyticsRow {
  id: string;
  startedAt: string;
  endedAt: string;
  messages: number;
  toolCalls: number;
  projectId: string;
}

interface TurnContextRow {
  threadId: string | null;
  payloadJson: string;
}

interface TimelinePoint {
  key: string;
  label: string;
  sessions: number;
  messages: number;
  toolCalls: number;
  durationMinutes: number;
  uncachedInputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  outputTokens: number;
  totalProcessedTokens: number;
  subagents: number;
  skillInvocations: number;
  skillBreakdown: Record<string, number>;
  promptScore: number | null;
}

interface WeeklyAgentRow {
  sourceTool: string;
  sessions: number;
  projects: number;
  messages: number;
  toolCalls: number;
  durationMinutes: number;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  analyzedSessions: number;
}

function startOfLocalWeek(now: Date): Date {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const day = start.getDay();
  start.setDate(start.getDate() - (day === 0 ? 6 : day - 1));
  return start;
}

function percentChange(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null;
  return Math.round(((current - previous) / previous) * 100);
}

function sourceToolLabel(sourceTool: string): string {
  if (sourceTool === 'codex-cli') return 'Codex';
  if (sourceTool === 'claude-code') return 'Claude Code';
  if (sourceTool === 'cursor') return 'Cursor';
  return sourceTool;
}

function processedTokens(row: Pick<WeeklyAgentRow, 'inputTokens' | 'outputTokens' | 'cacheCreationTokens' | 'cacheReadTokens'>): number {
  return row.inputTokens + row.outputTokens + row.cacheCreationTokens + row.cacheReadTokens;
}

function weeklyAgentRows(start: Date, end: Date): WeeklyAgentRow[] {
  return getDb().prepare(`
    SELECT COALESCE(NULLIF(s.source_tool, ''), 'unknown') AS sourceTool,
      COUNT(*) AS sessions,
      COUNT(DISTINCT s.project_id) AS projects,
      COALESCE(SUM(s.message_count), 0) AS messages,
      COALESCE(SUM(s.tool_call_count), 0) AS toolCalls,
      CAST(COALESCE(SUM(CASE WHEN s.ended_at IS NOT NULL THEN
        MAX(0, (julianday(s.ended_at) - julianday(s.started_at)) * 1440) ELSE 0 END), 0) AS INTEGER) AS durationMinutes,
      COALESCE(SUM(s.total_input_tokens), 0) AS inputTokens,
      COALESCE(SUM(s.total_output_tokens), 0) AS outputTokens,
      COALESCE(SUM(s.cache_creation_tokens), 0) AS cacheCreationTokens,
      COALESCE(SUM(s.cache_read_tokens), 0) AS cacheReadTokens,
      COUNT(sf.session_id) AS analyzedSessions
    FROM sessions s
    LEFT JOIN session_facets sf ON sf.session_id = s.id
    WHERE s.deleted_at IS NULL AND s.started_at >= ? AND s.started_at < ?
    GROUP BY COALESCE(NULLIF(s.source_tool, ''), 'unknown')
    ORDER BY sessions DESC,
      COALESCE(SUM(s.total_input_tokens), 0) + COALESCE(SUM(s.total_output_tokens), 0)
        + COALESCE(SUM(s.cache_creation_tokens), 0) + COALESCE(SUM(s.cache_read_tokens), 0) DESC,
      sourceTool
  `).all(start.toISOString(), end.toISOString()) as WeeklyAgentRow[];
}

function rangeStart(range: Range, now: Date): Date | null {
  if (range === 'all') return null;
  if (range === 'today') return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const days = range === '7d' ? 7 : range === '30d' ? 30 : 90;
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() - (days - 1));
}

function localDay(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function bucketKey(value: string, range: Range): string {
  const date = new Date(value);
  if (range === 'today') return `${localDay(date)}T${String(date.getHours()).padStart(2, '0')}`;
  return localDay(date);
}

function emptyTimeline(range: Range, now: Date, start: Date | null): TimelinePoint[] {
  if (range === 'all') return [];
  if (range === 'today') {
    return Array.from({ length: 24 }, (_, hour) => ({
      key: `${localDay(now)}T${String(hour).padStart(2, '0')}`,
      label: `${String(hour).padStart(2, '0')}:00`,
      sessions: 0, messages: 0, toolCalls: 0, durationMinutes: 0,
      uncachedInputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0,
      outputTokens: 0, totalProcessedTokens: 0, subagents: 0,
      skillInvocations: 0, promptScore: null,
      skillBreakdown: {},
    }));
  }
  const days = range === '7d' ? 7 : range === '30d' ? 30 : 90;
  const first = start ?? new Date(now.getTime() - days * 86_400_000);
  return Array.from({ length: days }, (_, index) => {
    const date = new Date(first.getTime() + index * 86_400_000);
    return {
      key: localDay(date),
      label: date.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' }),
      sessions: 0, messages: 0, toolCalls: 0, durationMinutes: 0,
      uncachedInputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0,
      outputTokens: 0, totalProcessedTokens: 0, subagents: 0,
      skillInvocations: 0, promptScore: null,
      skillBreakdown: {},
    };
  });
}

function toolFamily(name: string): string {
  const normalized = name.toLowerCase();
  if (['exec', 'exec_command', 'write_stdin', 'bash', 'shell'].includes(normalized)) return '终端与命令';
  if (normalized.includes('agent') || ['send_input', 'send_message', 'followup_task'].includes(normalized)) return 'Agent 编排';
  if (normalized === 'apply_patch' || normalized.includes('edit') || normalized.includes('write_file')) return '代码编辑';
  if (normalized.includes('browser') || normalized.includes('playwright') || normalized === 'view_image') return '界面与浏览器';
  if (normalized.includes('plan') || normalized.includes('goal')) return '计划与目标';
  if (normalized.startsWith('mcp') || normalized.includes('mcp_')) return 'MCP 与外部工具';
  if (normalized.includes('read') || normalized.includes('search') || normalized.includes('find')) return '搜索与读取';
  return '其他';
}

// Dashboard overview stats for a given time range.
app.get('/dashboard', (c) => {
  const db = getDb();
  const requested = c.req.query('range') ?? '7d';
  if (!VALID_RANGES.includes(requested as Range)) {
    return c.json({ error: `Invalid range. Must be one of: ${VALID_RANGES.join(', ')}` }, 400);
  }
  const range = requested as Range;
  const start = rangeStart(range, new Date());
  const where = start ? 'WHERE started_at >= ? AND deleted_at IS NULL' : 'WHERE deleted_at IS NULL';
  const params = start ? [start.toISOString()] : [];
  const stats = db.prepare(`
    SELECT COUNT(*) AS session_count, COUNT(DISTINCT project_id) AS active_projects,
      COALESCE(SUM(message_count), 0) AS total_messages,
      COALESCE(SUM(tool_call_count), 0) AS total_tool_calls,
      CAST(COALESCE(SUM(CASE WHEN ended_at IS NOT NULL THEN
        (julianday(ended_at) - julianday(started_at)) * 1440 ELSE 0 END), 0) AS INTEGER) AS total_duration_min,
      COALESCE(SUM(total_input_tokens), 0) AS total_input_tokens,
      COALESCE(SUM(total_output_tokens), 0) AS total_output_tokens,
      COALESCE(SUM(cache_creation_tokens), 0) AS cache_creation_tokens,
      COALESCE(SUM(cache_read_tokens), 0) AS cache_read_tokens,
      COALESCE(SUM(estimated_cost_usd), 0) AS estimated_cost_usd
    FROM sessions ${where}
  `).get(...params);
  return c.json({ range, stats });
});

// Data-dense overview used by the redesigned product dashboard.
app.get('/overview', (c) => {
  const db = getDb();
  const requested = c.req.query('range') ?? '7d';
  if (!VALID_RANGES.includes(requested as Range) || requested === 'all') {
    return c.json({ error: 'Invalid range. Must be one of: today, 7d, 30d, 90d' }, 400);
  }
  const range = requested as Exclude<Range, 'all'>;
  const now = new Date();
  const start = rangeStart(range, now)!;
  const sessions = db.prepare(`SELECT id, started_at AS startedAt, ended_at AS endedAt,
      message_count AS messages, tool_call_count AS toolCalls,
      project_id AS projectId
    FROM sessions WHERE deleted_at IS NULL AND started_at >= ? ORDER BY started_at`).all(start.toISOString()) as SessionAnalyticsRow[];
  const sessionIds = new Set(sessions.map((row) => row.id));
  const nativeSessionIds = new Set(sessions.flatMap((row) => {
    const nativeId = row.id.startsWith('codex:') ? row.id.slice('codex:'.length) : row.id;
    return [row.id, nativeId];
  }));
  const timeline = emptyTimeline(range, now, start);
  const byKey = new Map(timeline.map((point) => [point.key, point]));
  for (const session of sessions) {
    const point = byKey.get(bucketKey(session.startedAt, range));
    if (!point) continue;
    point.sessions += 1;
    point.messages += session.messages;
    point.toolCalls += session.toolCalls;
    point.durationMinutes += Math.max(0, Math.round((Date.parse(session.endedAt) - Date.parse(session.startedAt)) / 60_000));
  }

  const tokenPeriods = db.prepare(`
    SELECT hour, input_tokens AS inputTokens, output_tokens AS outputTokens,
      cache_creation_tokens AS cacheCreationTokens, cache_read_tokens AS cacheReadTokens
    FROM token_usage_hourly
    WHERE hour >= strftime('%Y-%m-%dT%H:00:00', ?, 'localtime')
    ORDER BY hour
  `).all(start.toISOString()) as Array<{
    hour: string; inputTokens: number; outputTokens: number;
    cacheCreationTokens: number; cacheReadTokens: number;
  }>;
  for (const usage of tokenPeriods) {
    const point = byKey.get(bucketKey(usage.hour, range));
    if (!point) continue;
    const uncachedInputTokens = Math.max(
      0,
      usage.inputTokens - usage.cacheCreationTokens - usage.cacheReadTokens,
    );
    point.uncachedInputTokens += uncachedInputTokens;
    point.cacheCreationTokens += usage.cacheCreationTokens;
    point.cacheReadTokens += usage.cacheReadTokens;
    point.outputTokens += usage.outputTokens;
    point.totalProcessedTokens += uncachedInputTokens
      + usage.cacheCreationTokens
      + usage.cacheReadTokens
      + usage.outputTokens;
  }

  const taskRows = db.prepare(`SELECT parent_task_id AS parentTaskId, started_at AS startedAt
    FROM work_tasks WHERE started_at >= ?`).all(start.toISOString()) as Array<{ parentTaskId: string | null; startedAt: string }>;
  for (const task of taskRows) {
    if (!task.parentTaskId) continue;
    const point = byKey.get(bucketKey(task.startedAt, range));
    if (point) point.subagents += 1;
  }

  // User prompts can contain very large context snapshots. Only read prompts
  // that can contain an explicit Skill marker; tool rows are read separately.
  const userSkillMessages = db.prepare(`SELECT session_id AS sessionId,
      substr(content, 1, 32768) AS content, timestamp
    FROM messages
    WHERE timestamp >= ? AND type = 'user'
      AND (
        instr(substr(content, 1, 32768), 'SKILL.md') > 0
        OR substr(content, 1, 32768) GLOB '*[$][a-z]*'
      )`).all(start.toISOString()) as Array<{
      sessionId: string; content: string; timestamp: string;
    }>;
  const agentSkillValues = db.prepare(`SELECT session_id AS sessionId,
      substr(skill_input.value, 1, 32768) AS inputValue, timestamp
    FROM messages, json_tree(messages.tool_calls) AS skill_input
    WHERE timestamp >= ? AND tool_calls IS NOT NULL AND json_valid(tool_calls)
      AND skill_input.type = 'text' AND instr(skill_input.value, 'SKILL.md') > 0`).all(start.toISOString()) as Array<{
      sessionId: string; inputValue: string; timestamp: string;
    }>;
  const toolNameRows = db.prepare(`SELECT json_extract(tool.value, '$.name') AS name,
      COUNT(*) AS calls
    FROM messages, json_each(messages.tool_calls) AS tool
    WHERE timestamp >= ? AND tool_calls IS NOT NULL AND json_valid(tool_calls)
    GROUP BY name`).all(start.toISOString()) as Array<{ name: string | null; calls: number }>;
  const skillCounts = new Map<string, number>();
  const skillSessions = new Map<string, Set<string>>();
  const toolCounts = new Map<string, number>();
  const userSkillsBySession = new Map<string, Set<string>>();
  for (const message of userSkillMessages) {
    if (!sessionIds.has(message.sessionId)) continue;
    const names = userSkillsBySession.get(message.sessionId) ?? new Set<string>();
    const skills = userInvokedSkillNames(message.content);
    for (const skill of skills) {
      names.add(skill);
      const point = byKey.get(bucketKey(message.timestamp, range));
      if (point) {
        point.skillInvocations += 1;
        point.skillBreakdown[skill] = (point.skillBreakdown[skill] ?? 0) + 1;
      }
      skillCounts.set(skill, (skillCounts.get(skill) ?? 0) + 1);
      const covered = skillSessions.get(skill) ?? new Set<string>();
      covered.add(message.sessionId);
      skillSessions.set(skill, covered);
    }
    userSkillsBySession.set(message.sessionId, names);
  }
  for (const message of agentSkillValues) {
    if (!sessionIds.has(message.sessionId)) continue;
    const observed = skillNameFromPath(message.inputValue);
    const skills = observed
      && !(userSkillsBySession.get(message.sessionId)?.has(observed) ?? false)
      ? [observed]
      : [];
    if (skills.length > 0) {
      const point = byKey.get(bucketKey(message.timestamp, range));
      if (point) point.skillInvocations += skills.length;
      for (const skill of skills) {
        if (point) point.skillBreakdown[skill] = (point.skillBreakdown[skill] ?? 0) + 1;
        skillCounts.set(skill, (skillCounts.get(skill) ?? 0) + 1);
        const covered = skillSessions.get(skill) ?? new Set<string>();
        covered.add(message.sessionId);
        skillSessions.set(skill, covered);
      }
    }
  }
  for (const tool of toolNameRows) {
    if (!tool.name) continue;
    const family = toolFamily(tool.name);
    toolCounts.set(family, (toolCounts.get(family) ?? 0) + tool.calls);
  }

  const promptRows = db.prepare(`SELECT session_id AS sessionId, timestamp, metadata
    FROM insights WHERE type = 'prompt_quality' AND timestamp >= ? ORDER BY timestamp`).all(start.toISOString()) as Array<{
      sessionId: string; timestamp: string; metadata: string | null;
    }>;
  const scoresByKey = new Map<string, number[]>();
  const allPromptScores: number[] = [];
  for (const row of promptRows) {
    if (!sessionIds.has(row.sessionId)) continue;
    try {
      const score = Number((JSON.parse(row.metadata ?? '{}') as { efficiency_score?: unknown }).efficiency_score);
      if (!Number.isFinite(score)) continue;
      allPromptScores.push(score);
      const key = bucketKey(row.timestamp, range);
      const values = scoresByKey.get(key) ?? [];
      values.push(score);
      scoresByKey.set(key, values);
    } catch { /* malformed historical metadata is ignored */ }
  }
  for (const point of timeline) {
    const scores = scoresByKey.get(point.key) ?? [];
    point.promptScore = scores.length ? Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length) : null;
  }

  const turnContexts = db.prepare(`SELECT thread_id AS threadId, payload_json AS payloadJson
    FROM canonical_events
    WHERE kind = 'turn-context' AND occurred_at >= ?
    ORDER BY occurred_at, sequence`).all(start.toISOString()) as TurnContextRow[];
  const modelStats = new Map<string, { turns: number; sessions: Set<string> }>();
  const effortStats = new Map<string, { turns: number; sessions: Set<string> }>();
  for (const context of turnContexts) {
    if (!context.threadId || !nativeSessionIds.has(context.threadId)) continue;
    let payload: Record<string, unknown>;
    try {
      const parsed = JSON.parse(context.payloadJson) as unknown;
      payload = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? parsed as Record<string, unknown> : {};
    } catch { continue; }
    const model = typeof payload.model === 'string' ? payload.model.trim() : '';
    const effort = typeof payload.effort === 'string' ? payload.effort.trim().toLowerCase() : '';
    if (model) {
      const stat = modelStats.get(model) ?? { turns: 0, sessions: new Set<string>() };
      stat.turns += 1;
      stat.sessions.add(context.threadId);
      modelStats.set(model, stat);
    }
    if (effort) {
      const stat = effortStats.get(effort) ?? { turns: 0, sessions: new Set<string>() };
      stat.turns += 1;
      stat.sessions.add(context.threadId);
      effortStats.set(effort, stat);
    }
  }

  const durationValues = sessions.map((session) => Math.max(0, (Date.parse(session.endedAt) - Date.parse(session.startedAt)) / 60_000));
  const durationBands = [
    { label: '< 5 分钟', count: durationValues.filter((value) => value < 5).length },
    { label: '5–20 分钟', count: durationValues.filter((value) => value >= 5 && value < 20).length },
    { label: '20–60 分钟', count: durationValues.filter((value) => value >= 20 && value < 60).length },
    { label: '> 60 分钟', count: durationValues.filter((value) => value >= 60).length },
  ];
  const rawInputTokens = tokenPeriods.reduce((sum, row) => sum + row.inputTokens, 0);
  const cacheCreationTokens = tokenPeriods.reduce((sum, row) => sum + row.cacheCreationTokens, 0);
  const cacheReadTokens = tokenPeriods.reduce((sum, row) => sum + row.cacheReadTokens, 0);
  const uncachedInputTokens = Math.max(0, rawInputTokens - cacheCreationTokens - cacheReadTokens);
  const outputTokens = tokenPeriods.reduce((sum, row) => sum + row.outputTokens, 0);
  const promptScoreSessions = new Set(promptRows
    .filter((row) => sessionIds.has(row.sessionId))
    .map((row) => row.sessionId)).size;
  const totals = {
    sessions: sessions.length,
    projects: new Set(sessions.map((session) => session.projectId)).size,
    rootTasks: taskRows.filter((task) => !task.parentTaskId).length,
    subagents: taskRows.filter((task) => Boolean(task.parentTaskId)).length,
    messages: sessions.reduce((sum, session) => sum + session.messages, 0),
    toolCalls: sessions.reduce((sum, session) => sum + session.toolCalls, 0),
    skillInvocations: [...skillCounts.values()].reduce((sum, count) => sum + count, 0),
    durationMinutes: Math.round(durationValues.reduce((sum, value) => sum + value, 0)),
    uncachedInputTokens,
    cacheCreationTokens,
    cacheReadTokens,
    outputTokens,
    totalProcessedTokens: uncachedInputTokens + cacheCreationTokens + cacheReadTokens + outputTokens,
    rawInputTokens,
    promptScore: allPromptScores.length
      ? Math.round(allPromptScores.reduce((sum, score) => sum + score, 0) / allPromptScores.length)
      : null,
    promptScoreAnalyzedSessions: promptScoreSessions,
    promptScoreEligibleSessions: sessions.length,
  };
  const sortedSkills = [...skillCounts.entries()].sort((left, right) => right[1] - left[1]);
  const primarySkillNames = sortedSkills.slice(0, 7).map(([name]) => name);
  const secondarySkillNames = new Set(sortedSkills.slice(7).map(([name]) => name));
  const skillSeries = primarySkillNames.map((name) => ({
    name,
    invocations: skillCounts.get(name) ?? 0,
  }));
  const otherInvocations = [...secondarySkillNames]
    .reduce((sum, name) => sum + (skillCounts.get(name) ?? 0), 0);
  if (otherInvocations > 0) skillSeries.push({ name: '其他', invocations: otherInvocations });
  const skillTimeline = timeline.map((point) => {
    const counts = Object.fromEntries(primarySkillNames.map((name) => [name, point.skillBreakdown[name] ?? 0]));
    if (otherInvocations > 0) {
      counts['其他'] = [...secondarySkillNames]
        .reduce((sum, name) => sum + (point.skillBreakdown[name] ?? 0), 0);
    }
    return { key: point.key, label: point.label, total: point.skillInvocations, counts };
  });
  const publicTimeline = timeline.map(({ skillBreakdown: _skillBreakdown, ...point }) => point);
  return c.json({
    range, generatedAt: now.toISOString(), startsAt: start.toISOString(), totals, timeline: publicTimeline,
    skills: sortedSkills.map(([name, invocations]) => ({
      name, invocations, sessions: skillSessions.get(name)?.size ?? 0,
    })).slice(0, 12),
    skillSeries,
    skillTimeline,
    modelUsage: [...modelStats.entries()]
      .map(([name, stat]) => ({ name, turns: stat.turns, sessions: stat.sessions.size }))
      .sort((left, right) => right.turns - left.turns || left.name.localeCompare(right.name)),
    reasoningEffortUsage: [...effortStats.entries()]
      .map(([name, stat]) => ({ name, turns: stat.turns, sessions: stat.sessions.size }))
      .sort((left, right) => right.turns - left.turns || left.name.localeCompare(right.name)),
    toolFamilies: [...toolCounts.entries()].map(([family, calls]) => ({ family, calls }))
      .sort((a, b) => b.calls - a.calls),
    durationBands,
  });
});

// Natural-week report grouped by coding agent. The comparison window is the
// same elapsed portion of the previous week so an in-progress week is not
// compared with seven complete days.
app.get('/weekly-report', (c) => {
  const now = new Date();
  const weekStart = startOfLocalWeek(now);
  const previousStart = new Date(weekStart);
  previousStart.setDate(previousStart.getDate() - 7);
  const previousEnd = new Date(now);
  previousEnd.setDate(previousEnd.getDate() - 7);
  const currentRows = weeklyAgentRows(weekStart, now);
  const previousRows = weeklyAgentRows(previousStart, previousEnd);
  const previousBySource = new Map(previousRows.map((row) => [row.sourceTool, row]));
  const totalSessions = currentRows.reduce((sum, row) => sum + row.sessions, 0);
  const agents = currentRows.map((row) => {
    const previous = previousBySource.get(row.sourceTool);
    const totalTokens = processedTokens(row);
    const previousTokens = previous ? processedTokens(previous) : 0;
    return {
      ...row,
      totalTokens,
      analysisCoverage: row.sessions ? Math.round((row.analyzedSessions / row.sessions) * 100) : 0,
      sharePercent: totalSessions ? Math.round((row.sessions / totalSessions) * 100) : 0,
      previousSessions: previous?.sessions ?? 0,
      previousTokens,
      sessionDeltaPercent: percentChange(row.sessions, previous?.sessions ?? 0),
      tokenDeltaPercent: percentChange(totalTokens, previousTokens),
    };
  });
  const totals = {
    sessions: totalSessions,
    projects: 0,
    messages: currentRows.reduce((sum, row) => sum + row.messages, 0),
    toolCalls: currentRows.reduce((sum, row) => sum + row.toolCalls, 0),
    durationMinutes: currentRows.reduce((sum, row) => sum + row.durationMinutes, 0),
    totalTokens: currentRows.reduce((sum, row) => sum + processedTokens(row), 0),
    analyzedSessions: currentRows.reduce((sum, row) => sum + row.analyzedSessions, 0),
  };
  const projectRow = getDb().prepare(`SELECT COUNT(DISTINCT project_id) AS projects
    FROM sessions WHERE deleted_at IS NULL AND started_at >= ? AND started_at < ?`)
    .get(weekStart.toISOString(), now.toISOString()) as { projects: number };
  totals.projects = projectRow.projects;
  const previousTotals = {
    sessions: previousRows.reduce((sum, row) => sum + row.sessions, 0),
    totalTokens: previousRows.reduce((sum, row) => sum + processedTokens(row), 0),
  };
  const highlights: Array<{
    kind: 'primary' | 'positive' | 'attention'; title: string; detail: string; titleEn: string; detailEn: string;
  }> = [];
  if (agents.length === 0) {
    highlights.push({
      kind: 'attention', title: '本周暂无可用记录', detail: '完成导入后，周报会自动按 Agent 汇总。',
      titleEn: 'No records yet this week', detailEn: 'The report will group usage by agent after import completes.',
    });
  } else {
    const top = agents[0];
    const topLabel = sourceToolLabel(top.sourceTool);
    highlights.push({
      kind: 'primary',
      title: `${topLabel} 是本周主力 Agent`,
      detail: `${top.sessions} 个会话，占本周记录的 ${top.sharePercent}%。`,
      titleEn: `${topLabel} is the primary agent this week`,
      detailEn: `${top.sessions} sessions, ${top.sharePercent}% of this week's records.`,
    });
    const sessionDelta = percentChange(totals.sessions, previousTotals.sessions);
    if (sessionDelta !== null && sessionDelta !== 0) {
      highlights.push({
        kind: sessionDelta > 0 ? 'positive' : 'attention',
        title: `使用频次较上周同期${sessionDelta > 0 ? '增加' : '减少'} ${Math.abs(sessionDelta)}%`,
        detail: `本周 ${totals.sessions} 个会话，上周同期 ${previousTotals.sessions} 个。`,
        titleEn: `Usage frequency ${sessionDelta > 0 ? 'increased' : 'decreased'} ${Math.abs(sessionDelta)}% week over week`,
        detailEn: `${totals.sessions} sessions this week versus ${previousTotals.sessions} in the same period last week.`,
      });
    }
    const coverage = totals.sessions ? Math.round((totals.analyzedSessions / totals.sessions) * 100) : 0;
    highlights.push({
      kind: coverage >= 80 ? 'positive' : 'attention',
      title: `分析覆盖率 ${coverage}%`,
      detail: coverage >= 80 ? '本周大部分会话已有结构化分析。' : '仍有会话尚未分析，结论可能不完整。',
      titleEn: `Analysis coverage is ${coverage}%`,
      detailEn: coverage >= 80 ? 'Most sessions this week have structured analysis.' : 'Some sessions remain unanalyzed, so conclusions may be incomplete.',
    });
  }
  return c.json({
    generatedAt: now.toISOString(),
    week: { startsAt: weekStart.toISOString(), endsAt: now.toISOString() },
    previousWeek: { startsAt: previousStart.toISOString(), endsAt: previousEnd.toISOString() },
    totals: {
      ...totals,
      analysisCoverage: totals.sessions ? Math.round((totals.analyzedSessions / totals.sessions) * 100) : 0,
      previousSessions: previousTotals.sessions,
      previousTokens: previousTotals.totalTokens,
      sessionDeltaPercent: percentChange(totals.sessions, previousTotals.sessions),
      tokenDeltaPercent: percentChange(totals.totalTokens, previousTotals.totalTokens),
    },
    agents,
    highlights,
  });
});

app.get('/usage', (c) => {
  const stats = getDb().prepare(`SELECT total_input_tokens, total_output_tokens, cache_creation_tokens,
      cache_read_tokens, estimated_cost_usd, sessions_with_usage, last_updated_at FROM usage_stats WHERE id = 1`).get();
  return c.json({ stats: stats ?? null });
});

export default app;
