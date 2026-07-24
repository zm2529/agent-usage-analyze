import { getSessionTitle, formatDurationMinutes } from '@/lib/utils';
import type { Insight, Message, Session } from '@/lib/types';

/**
 * Trigger a markdown file download for a session.
 * Toast notification is the caller's responsibility (UI concern).
 */
export function buildSessionMarkdown(
  session: Session,
  insights: Insight[],
  summaryText: string | null | undefined,
  messages: Message[],
  format: 'plain' | 'obsidian' | 'notion'
): { content: string; filename: string } {
  const title = getSessionTitle(session);
  const startedAt = new Date(session.started_at);
  const endedAt = new Date(session.ended_at);
  const durationMinutes = Math.round((endedAt.getTime() - startedAt.getTime()) / 60000);
  const dateStr = startedAt.toISOString().slice(0, 10);
  const lines: string[] = [];

  if (format === 'obsidian') {
    lines.push(`# ${title}`, '', `> [!info]`);
    lines.push(
      `> Date: ${dateStr}  `,
      `> Duration: ${formatDurationMinutes(durationMinutes)}  `,
      `> Project: ${session.project_name}`
    );
  } else {
    lines.push(
      `# ${title}`,
      '',
      `**Date:** ${dateStr}  `,
      `**Duration:** ${formatDurationMinutes(durationMinutes)}  `,
      `**Project:** ${session.project_name}`
    );
  }

  if (summaryText) {
    lines.push('', '## Summary', '', summaryText);
  }
  if (insights.length > 0) {
    lines.push('', '## Insights');
    for (const insight of insights.filter((i) => i.type !== 'summary')) {
      lines.push('', `### ${insight.title} (${insight.type})`, '', insight.content);
    }
  }

  const visibleMessages = messages.filter((message) =>
    Boolean(message.content?.trim() || message.thinking?.trim())
  );
  if (visibleMessages.length > 0) {
    lines.push('', '## Conversation');
    for (const message of visibleMessages) {
      const role = message.type === 'user'
        ? 'You'
        : message.type === 'assistant'
          ? 'Assistant'
          : 'System';
      const timestamp = new Date(message.timestamp).toLocaleTimeString(undefined, {
        hour: 'numeric', minute: '2-digit',
      });
      lines.push('', `### ${role} · ${timestamp}`);
      if (message.thinking?.trim()) {
        lines.push('', '<details>', '<summary>Thinking summary</summary>', '', message.thinking.trim(), '', '</details>');
      }
      if (message.content?.trim()) lines.push('', message.content.trim());
    }
  }

  const content = lines.join('\n');
  const projectSlug = session.project_name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const filename = `session-${projectSlug}-${dateStr}.md`;
  return { content, filename };
}

export function exportSession(
  session: Session,
  insights: Insight[],
  summaryText: string | null | undefined,
  messages: Message[],
  format: 'plain' | 'obsidian' | 'notion'
): void {
  const { content, filename } = buildSessionMarkdown(session, insights, summaryText, messages, format);
  const blob = new Blob([content], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
