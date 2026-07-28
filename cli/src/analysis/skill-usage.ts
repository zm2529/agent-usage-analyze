export interface ObservedSkillUsage {
  name: string;
  userInvocations: number;
  agentInvocations: number;
  automaticInvocations: number;
}

export function skillNameFromPath(value: string): string | null {
  const match = value.match(/(?:^|[/\\])([^/\\\s"'`]+)[/\\]SKILL\.md(?:\?[^/\\\s"'`]*)?/i);
  const name = match?.[1]?.toLowerCase();
  return name && /^[a-z0-9][a-z0-9:-]*$/.test(name) ? name : null;
}

/** Skills directly named by the user with `$name` or a SKILL.md link. */
export function userInvokedSkillNames(content: string): string[] {
  const names = new Set<string>();
  for (const match of content.matchAll(/\[\$?([a-z][a-z0-9:-]*)\]\([^)]*[/\\]SKILL\.md(?:\?[^)]*)?\)/gi)) {
    names.add(match[1]!.toLowerCase());
  }
  for (const match of content.matchAll(/(?:^|\s)\$([a-z][a-z0-9:-]*)\b/gi)) {
    names.add(match[1]!.toLowerCase());
  }
  return [...names];
}

function stringValues(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(stringValues);
  if (!value || typeof value !== 'object') return [];
  return Object.values(value as Record<string, unknown>).flatMap(stringValues);
}

/**
 * Skills the Agent demonstrably opened through a tool call. This is an
 * observation of Skill instructions being read, not a claim about why they
 * were selected.
 */
export function agentAppliedSkillNames(rawToolCalls: string | null | undefined): string[] {
  if (!rawToolCalls) return [];
  let calls: unknown;
  try {
    calls = JSON.parse(rawToolCalls) as unknown;
  } catch {
    return [];
  }
  if (!Array.isArray(calls)) return [];
  const names = new Set<string>();
  for (const rawCall of calls) {
    if (!rawCall || typeof rawCall !== 'object') continue;
    const call = rawCall as { name?: unknown; input?: unknown };
    const toolName = typeof call.name === 'string' ? call.name.toLowerCase() : '';
    if (!/(?:exec|shell|read|skill)/.test(toolName)) continue;
    for (const value of stringValues(call.input)) {
      const name = skillNameFromPath(value);
      if (name) names.add(name);
    }
  }
  return [...names];
}

export function summarizeObservedSkills(messages: Array<{
  type: string;
  content: string;
  toolCalls?: string | null;
}>): ObservedSkillUsage[] {
  const userSkills = new Map<string, number>();
  const agentSkills = new Map<string, number>();
  for (const message of messages) {
    if (message.type === 'user') {
      for (const name of userInvokedSkillNames(message.content)) {
        userSkills.set(name, (userSkills.get(name) ?? 0) + 1);
      }
    }
    if (message.type === 'assistant') {
      for (const name of agentAppliedSkillNames(message.toolCalls)) {
        agentSkills.set(name, (agentSkills.get(name) ?? 0) + 1);
      }
    }
  }
  const names = new Set([...userSkills.keys(), ...agentSkills.keys()]);
  return [...names].map((name) => {
    const userInvocations = userSkills.get(name) ?? 0;
    const agentInvocations = agentSkills.get(name) ?? 0;
    return {
      name,
      userInvocations,
      agentInvocations,
      automaticInvocations: userInvocations === 0 ? agentInvocations : 0,
    };
  }).sort((left, right) =>
    right.userInvocations - left.userInvocations
    || right.automaticInvocations - left.automaticInvocations
    || left.name.localeCompare(right.name));
}
