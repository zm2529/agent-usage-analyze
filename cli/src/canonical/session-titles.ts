import type Database from 'better-sqlite3';
import { classifyStoredUserMessage } from '../analysis/message-format.js';
import { cleanTitle, extractExplicitUserRequest } from '../parser/titles.js';

const INJECTED_TITLE_PREDICATE = `(
  generated_title IS NULL OR trim(generated_title) = ''
  OR lower(trim(generated_title)) LIKE '<recommended_plugins>%'
  OR lower(trim(generated_title)) LIKE '<recommendedplugins>%'
  OR lower(trim(generated_title)) LIKE '<codex_internal_context%'
  OR lower(trim(generated_title)) LIKE '<codexinternalcontext%'
  OR lower(trim(generated_title)) LIKE '<codex_delegation%'
  OR lower(trim(generated_title)) LIKE '<codexdelegation%'
  OR lower(trim(generated_title)) LIKE '<skill>%'
  OR lower(trim(generated_title)) LIKE 'files mentioned by the user:%'
  OR lower(trim(generated_title)) IN
    ('no coding activity captured', 'no coding-session activity captured')
)`;

function isMeaningfulRequest(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed || /^(yes|no|ok|okay|continue|done|同意|继续|可以)$/i.test(trimmed)) return false;
  const cjkCount = (trimmed.match(/[\u3400-\u9fff]/g) ?? []).length;
  return trimmed.split(/\s+/).length >= 3 || cjkCount >= 4;
}

/** Repair only known injected/placeholder generated titles; custom and valid LLM titles remain untouched. */
export function repairInjectedSessionTitles(db: Database.Database): number {
  const sessions = db.prepare(`SELECT id FROM sessions
    WHERE source_tool = 'codex-cli' AND ${INJECTED_TITLE_PREDICATE}`).all() as Array<{ id: string }>;
  const messages = db.prepare(`SELECT content FROM messages
    WHERE session_id = ? AND type = 'user' ORDER BY timestamp, id`);
  const update = db.prepare(`UPDATE sessions SET generated_title = ?, title_source = 'user_message'
    WHERE id = ? AND ${INJECTED_TITLE_PREDICATE}`);
  let repaired = 0;
  for (const session of sessions) {
    const rows = messages.all(session.id) as Array<{ content: string }>;
    for (const row of rows) {
      const request = extractExplicitUserRequest(row.content);
      if (classifyStoredUserMessage(row.content) !== 'human' && request === row.content.trim()) continue;
      if (!isMeaningfulRequest(request)) continue;
      repaired += update.run(cleanTitle(request), session.id).changes;
      break;
    }
  }
  return repaired;
}
