import { Hono } from 'hono';
import { getDb } from 'agent-usage-analyze/db/client';
import { summarizeObservedSkills } from 'agent-usage-analyze/analysis/skill-usage';
import { parseIntParam } from '../utils.js';

/** Escape SQLite LIKE wildcard characters so user input is treated as literal text. */
function escapeLike(s: string): string {
  return s.replace(/[%_\\]/g, '\\$&');
}

/** ISO 8601 date/datetime — accepts YYYY-MM-DD and YYYY-MM-DDTHH:MM:SSZ-style strings. */
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}(T[\d:.Z+\-]+)?$/;

const app = new Hono();

app.get('/', (c) => {
  const db = getDb();
  const { projectId, sourceTool, limit, offset, q, from, to, analysisStatus } = c.req.query();

  // Validate from/to are ISO 8601 date strings before passing to SQLite comparisons.
  // Invalid date strings in SQLite produce silent wrong results rather than errors.
  if (from && !ISO_DATE_RE.test(from)) {
    return c.json({ error: 'Invalid from: must be an ISO 8601 date (YYYY-MM-DD or YYYY-MM-DDTHH:MM:SSZ)' }, 400);
  }
  if (to && !ISO_DATE_RE.test(to)) {
    return c.json({ error: 'Invalid to: must be an ISO 8601 date (YYYY-MM-DD or YYYY-MM-DDTHH:MM:SSZ)' }, 400);
  }

  const conditions: string[] = [];
  const params: (string | number)[] = [];

  if (projectId) {
    conditions.push('project_id = ?');
    params.push(projectId);
  }
  if (sourceTool) {
    conditions.push('source_tool = ?');
    params.push(sourceTool);
  }
  if (q) {
    const likeParam = `%${escapeLike(q)}%`;
    conditions.push("(custom_title LIKE ? ESCAPE '\\' OR generated_title LIKE ? ESCAPE '\\' OR summary LIKE ? ESCAPE '\\' OR project_name LIKE ? ESCAPE '\\')");
    params.push(likeParam, likeParam, likeParam, likeParam);
  }
  if (from) {
    conditions.push('started_at >= ?');
    params.push(from);
  }
  if (to) {
    conditions.push('started_at <= ?');
    params.push(to);
  }
  if (analysisStatus === 'analyzed') {
    conditions.push('EXISTS (SELECT 1 FROM insights insight WHERE insight.session_id = sessions.id)');
  } else if (analysisStatus === 'unanalyzed') {
    conditions.push('NOT EXISTS (SELECT 1 FROM insights insight WHERE insight.session_id = sessions.id)');
  }
  conditions.push('deleted_at IS NULL');
  const where = `WHERE ${conditions.join(' AND ')}`;
  const pageLimit = Math.min(parseIntParam(limit, 50), 500);
  const rows = db.prepare(`
    WITH candidates AS MATERIALIZED (
      SELECT id, project_id, project_name, project_path, git_remote_url,
           summary, custom_title, generated_title, title_source, session_character,
           started_at, ended_at, message_count, user_message_count,
           assistant_message_count, tool_call_count, git_branch,
           claude_version, source_tool, device_id, device_hostname,
           device_platform, synced_at, total_input_tokens, total_output_tokens,
           cache_creation_tokens, cache_read_tokens, estimated_cost_usd,
           models_used, primary_model, usage_source,
           compact_count, auto_compact_count, slash_commands
      FROM sessions
      ${where}
      ORDER BY ended_at DESC, started_at DESC
      LIMIT ? OFFSET ?
    )
    SELECT candidates.*,
      (SELECT COUNT(*) FROM insights insight
        WHERE insight.session_id = candidates.id) AS insight_count
    FROM candidates
    WHERE EXISTS (SELECT 1 FROM messages message
      WHERE message.session_id = candidates.id AND message.type = 'user')
      AND EXISTS (SELECT 1 FROM messages message
        WHERE message.session_id = candidates.id AND message.type = 'assistant')
    ORDER BY ended_at DESC, started_at DESC
  `).all(...params, pageLimit + 10, parseIntParam(offset, 0));
  const hasMore = rows.length > pageLimit;
  return c.json({ sessions: hasMore ? rows.slice(0, pageLimit) : rows, hasMore });
});

// GET /api/sessions/deleted/count — count of soft-deleted sessions for a project
// IMPORTANT: registered before /:id so "deleted" isn't matched as a session ID
app.get('/deleted/count', (c) => {
  const db = getDb();
  const { projectId } = c.req.query();
  let row: { count: number };
  if (projectId) {
    row = db.prepare(
      `SELECT COUNT(*) AS count FROM sessions WHERE deleted_at IS NOT NULL AND project_id = ?`
    ).get(projectId) as { count: number };
  } else {
    row = db.prepare(
      `SELECT COUNT(*) AS count FROM sessions WHERE deleted_at IS NOT NULL`
    ).get() as { count: number };
  }
  return c.json({ count: row.count });
});

app.get('/:id', (c) => {
  const db = getDb();
  const session = db.prepare(`
    SELECT id, project_id, project_name, project_path, git_remote_url,
           summary, custom_title, generated_title, title_source, session_character,
           started_at, ended_at, message_count, user_message_count,
           assistant_message_count, tool_call_count, git_branch,
           claude_version, source_tool, device_id, device_hostname,
           device_platform, synced_at, total_input_tokens, total_output_tokens,
           cache_creation_tokens, cache_read_tokens, estimated_cost_usd,
           models_used, primary_model, usage_source,
           compact_count, auto_compact_count, slash_commands
    FROM sessions WHERE id = ? AND deleted_at IS NULL
      AND EXISTS (SELECT 1 FROM messages message
        WHERE message.session_id = sessions.id AND message.type = 'user')
      AND EXISTS (SELECT 1 FROM messages message
        WHERE message.session_id = sessions.id AND message.type = 'assistant')
  `).get(c.req.param('id'));
  if (!session) return c.json({ error: 'Not found' }, 404);
  const messages = db.prepare(`SELECT type, content, tool_calls AS toolCalls
    FROM messages WHERE session_id = ? AND type IN ('user', 'assistant')
    ORDER BY timestamp, id`).all(c.req.param('id')) as Array<{
      type: string; content: string; toolCalls: string | null;
    }>;
  return c.json({
    session: {
      ...(session as Record<string, unknown>),
      observed_skill_usage: summarizeObservedSkills(messages),
    },
  });
});

app.patch('/:id', async (c) => {
  const db = getDb();
  const body = await c.req.json<{ customTitle?: string }>();
  const { customTitle } = body;
  if (customTitle === undefined) {
    return c.json({ error: 'customTitle is required' }, 400);
  }
  const result = db.prepare(
    'UPDATE sessions SET custom_title = ? WHERE id = ? AND deleted_at IS NULL'
  ).run(customTitle || null, c.req.param('id'));
  if (result.changes === 0) return c.json({ error: 'Not found' }, 404);
  return c.json({ ok: true });
});

app.delete('/:id', (c) => {
  const db = getDb();
  const result = db.prepare(
    `UPDATE sessions SET deleted_at = datetime('now') WHERE id = ? AND deleted_at IS NULL`
  ).run(c.req.param('id'));
  if (result.changes === 0) return c.json({ error: 'Not found' }, 404);
  return c.json({ ok: true });
});

export default app;
