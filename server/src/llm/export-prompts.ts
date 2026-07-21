// LLM prompts for cross-session export synthesis.
// Each format has two scope variants (project vs. all).
// The LLM returns raw markdown — no JSON parsing needed.

export type ExportFormat = 'agent-rules' | 'knowledge-brief' | 'obsidian' | 'notion';
export type ExportScope = 'project' | 'all';
export type ExportDepth = 'essential' | 'standard' | 'comprehensive';

export const DEPTH_CAPS: Record<ExportDepth, number> = {
  essential: 25,
  standard: 80,
  comprehensive: 200,
};

// Rough token estimate per insight (title + content + metadata summary).
// Used to enforce the hard 60k input token ceiling within the depth cap.
const AVG_TOKENS_PER_INSIGHT = 300;
const MAX_EXPORT_INPUT_TOKENS = 60000;

export interface ExportInsightRow {
  id: string;
  type: string;
  title: string;
  content: string;
  summary: string;
  confidence: number;
  project_name: string;
  timestamp: string;
}

export interface ExportContext {
  scope: ExportScope;
  format: ExportFormat;
  depth: ExportDepth;
  projectName?: string;    // set when scope === 'project'
  sessionCount: number;
  projectCount: number;
  dateRange: { from: string; to: string };
  exportDate: string;      // ISO 8601 date for Obsidian frontmatter
}

/**
 * Apply depth cap and token budget guard, returning the insights to send to the LLM.
 * Also returns totalInsights (before cap) for metadata.
 */
export function applyDepthCap(
  insights: ExportInsightRow[],
  depth: ExportDepth
): { capped: ExportInsightRow[]; totalInsights: number } {
  const totalInsights = insights.length;
  const depthCap = DEPTH_CAPS[depth];

  // Apply depth cap first
  let capped = insights.slice(0, depthCap);

  // Token budget guard within the depth cap — safety net for unusually large insights
  let tokenEstimate = 0;
  const tokenBudgeted: ExportInsightRow[] = [];
  for (const insight of capped) {
    tokenEstimate += AVG_TOKENS_PER_INSIGHT;
    if (tokenEstimate > MAX_EXPORT_INPUT_TOKENS) break;
    tokenBudgeted.push(insight);
  }
  capped = tokenBudgeted;

  return { capped, totalInsights };
}

/**
 * Format insights for LLM input, grouped by type.
 * Includes project_name on each insight for scope-awareness.
 */
export function buildInsightContext(insights: ExportInsightRow[]): string {
  const grouped: Record<string, ExportInsightRow[]> = {};
  for (const insight of insights) {
    const key = insight.type;
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(insight);
  }

  const sections: string[] = [];

  const typeOrder = ['decision', 'learning', 'technique', 'prompt_quality', 'summary'];
  const typeLabels: Record<string, string> = {
    decision: 'DECISIONS',
    learning: 'LEARNINGS',
    technique: 'TECHNIQUES',
    prompt_quality: 'PROMPT QUALITY',
    summary: 'SESSION SUMMARIES',
  };

  for (const type of typeOrder) {
    const items = grouped[type];
    if (!items || items.length === 0) continue;

    const label = typeLabels[type] ?? type.toUpperCase();
    sections.push(`## ${label}\n`);

    for (const item of items) {
      const projectTag = item.project_name ? ` [${item.project_name}]` : '';
      const confidence = Math.round(item.confidence * 100);
      sections.push(
        `### ${item.title}${projectTag} (confidence: ${confidence}%)\n${item.content || item.summary}\n`
      );
    }
  }

  return sections.join('\n');
}

// ─── System prompts ──────────────────────────────────────────────────────────

export const AGENT_RULES_PROJECT_SYSTEM_PROMPT = (projectName: string) => `\
You are a technical writer converting AI coding session insights into agent \
instruction rules for the project "${projectName}". Produce imperative \
instructions suitable for a CLAUDE.md or .cursorrules file.

Rules:
- Deduplicate overlapping insights — merge into single rules
- Use imperative mood: "USE X", "DO NOT Y", "WHEN Z, do W"
- Group by topic (not by session)
- Include REVISIT conditions where relevant
- Prioritize by confidence and frequency
- If decisions evolved over time, note the current decision and why it changed
- Include a "Prompt Hygiene" section aggregating anti-patterns from prompt quality insights (if any exist)
- Output clean markdown only — no preamble, no meta-commentary`;

export const AGENT_RULES_ALL_SYSTEM_PROMPT = `\
You are a technical writer converting AI coding session insights from multiple \
projects into agent instruction rules. Produce imperative instructions suitable \
for a CLAUDE.md or .cursorrules file.

For each rule you produce, classify its scope:

- PROJECT-SPECIFIC: The rule references a specific project, framework version, \
  library, or codebase structure that only applies to that project. \
  Prefix with "[project-name]" e.g. "[agent-analytics] USE WAL mode for SQLite"

- UNIVERSAL: The rule is a general engineering practice, debugging technique, \
  or prompting pattern that applies across any project. \
  No prefix needed.

When in doubt, label as PROJECT-SPECIFIC.

Structure the output as:
## Universal Rules
(rules that apply to any project)

## Project-Specific Rules
### {project-name}
(rules specific to this project)

Additional rules:
- Deduplicate overlapping insights — merge into single rules
- Use imperative mood: "USE X", "DO NOT Y", "WHEN Z, do W"
- Group by topic within each section
- Prioritize by confidence and frequency
- Include a "Prompt Hygiene" section with universal anti-patterns (if any exist)
- Output clean markdown only — no preamble, no meta-commentary`;

export const KNOWLEDGE_BRIEF_PROJECT_SYSTEM_PROMPT = (projectName: string) => `\
You are a technical writer creating a project knowledge handoff document for "${projectName}". \
Produce a readable markdown document summarizing decisions, learnings, and techniques from AI coding sessions.

Structure:
- Executive summary (3-5 sentences covering the project's trajectory and key architectural bets)
- Key decisions (with reasoning and trade-offs noted)
- Learnings (grouped by topic)
- Techniques worth reusing

Output clean markdown only — no preamble, no meta-commentary.`;

export const KNOWLEDGE_BRIEF_ALL_SYSTEM_PROMPT = `\
You are a technical writer creating a knowledge handoff document from AI coding sessions across multiple projects. \
Produce a readable markdown document summarizing decisions, learnings, and techniques.

Structure:
- Cross-cutting themes section at the top (patterns that appear across projects)
- Then organize by project, each with:
  - Key decisions (with reasoning and trade-offs noted)
  - Learnings (grouped by topic)
  - Techniques worth reusing

Output clean markdown only — no preamble, no meta-commentary.`;

export const OBSIDIAN_PROJECT_SYSTEM_PROMPT = (projectName: string, exportDate: string) => `\
Produce markdown with YAML frontmatter suitable for Obsidian for the project "${projectName}". \
Start with exactly this frontmatter block:

---
date: ${exportDate}
project: ${projectName}
tags: [agent-analytics, decisions, learnings, techniques]
type: knowledge-export
---

Use [[wikilinks]] for cross-references between concepts where appropriate. \
Group content by topic, not by session. \
Output clean markdown only — no preamble, no meta-commentary.`;

export const OBSIDIAN_ALL_SYSTEM_PROMPT = (exportDate: string) => `\
Produce markdown with YAML frontmatter suitable for Obsidian covering multiple projects. \
Start with exactly this frontmatter block:

---
date: ${exportDate}
project: multiple
tags: [agent-analytics, decisions, learnings, techniques]
type: knowledge-export
---

Use [[wikilinks]] for cross-references between concepts where appropriate. \
Organize content by project with a cross-cutting themes section first. \
Output clean markdown only — no preamble, no meta-commentary.`;

export const NOTION_PROJECT_SYSTEM_PROMPT = (projectName: string) => `\
Produce Notion-compatible markdown for the project "${projectName}". Use:
- Toggle blocks (▶ **Section Name**) for collapsible sections
- Callout blocks (> [!note] content) for key decisions
- Tables for structured comparisons where appropriate
- No wikilinks — use standard markdown links only

Group content by topic, not by session. \
Output clean markdown only — no preamble, no meta-commentary.`;

export const NOTION_ALL_SYSTEM_PROMPT = `\
Produce Notion-compatible markdown covering multiple projects. Use:
- Toggle blocks (▶ **Section Name**) for collapsible sections
- Callout blocks (> [!note] content) for key decisions
- Tables for structured comparisons where appropriate
- No wikilinks — use standard markdown links only

Organize content by project with a cross-cutting themes section first. \
Output clean markdown only — no preamble, no meta-commentary.`;

/**
 * Select the appropriate system prompt for the given format and scope.
 */
export function getExportSystemPrompt(ctx: ExportContext): string {
  const { format, scope, projectName = 'unknown', exportDate } = ctx;

  switch (format) {
    case 'agent-rules':
      return scope === 'project'
        ? AGENT_RULES_PROJECT_SYSTEM_PROMPT(projectName)
        : AGENT_RULES_ALL_SYSTEM_PROMPT;

    case 'knowledge-brief':
      return scope === 'project'
        ? KNOWLEDGE_BRIEF_PROJECT_SYSTEM_PROMPT(projectName)
        : KNOWLEDGE_BRIEF_ALL_SYSTEM_PROMPT;

    case 'obsidian':
      return scope === 'project'
        ? OBSIDIAN_PROJECT_SYSTEM_PROMPT(projectName, exportDate)
        : OBSIDIAN_ALL_SYSTEM_PROMPT(exportDate);

    case 'notion':
      return scope === 'project'
        ? NOTION_PROJECT_SYSTEM_PROMPT(projectName)
        : NOTION_ALL_SYSTEM_PROMPT;

    default:
      return AGENT_RULES_PROJECT_SYSTEM_PROMPT(projectName);
  }
}

/**
 * Build the user prompt that combines the export context header with the insight data.
 */
export function buildExportUserPrompt(ctx: ExportContext, insightContext: string): string {
  const scopeDescription = ctx.scope === 'project'
    ? `Project: ${ctx.projectName}`
    : `All projects (${ctx.projectCount} project${ctx.projectCount !== 1 ? 's' : ''})`;

  const header = [
    `Source: ${scopeDescription}`,
    `Sessions analyzed: ${ctx.sessionCount}`,
    `Date range: ${ctx.dateRange.from} to ${ctx.dateRange.to}`,
  ].join('\n');

  return `${header}\n\n${insightContext}`;
}
