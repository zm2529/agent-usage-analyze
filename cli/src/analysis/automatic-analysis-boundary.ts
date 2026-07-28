import { createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { containsSensitiveOutput, redactEvidenceText } from '../canonical/semantic-analysis.js';
import { classifyStoredUserMessage } from './message-format.js';
import type {
  AnalysisResponse,
  PromptQualityResponse,
  SessionMetadata,
  SQLiteMessageRow,
} from './prompt-types.js';

export const AUTOMATIC_EVIDENCE_MAX_EVENTS = 128;
export const AUTOMATIC_EVIDENCE_MAX_BYTES = 32 * 1024;
const AUTOMATIC_OVERSIZED_TURN_SAMPLE_EVENTS = 24;

export type AutomaticAnalysisRejectionCode =
  | 'input-injection-detected'
  | 'sensitive-output'
  | 'input-evidence-unavailable'
  | 'input-evidence-too-large'
  | 'invalid-structured-output'
  | 'invalid-evidence-reference'
  | 'source-changed';

export class AutomaticAnalysisBoundaryError extends Error {
  constructor(readonly code: AutomaticAnalysisRejectionCode) {
    super(`Automatic analysis rejected: ${code}`);
    this.name = 'AutomaticAnalysisBoundaryError';
  }
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function messageVersion(message: SQLiteMessageRow): string {
  return `sha256:${sha256(JSON.stringify({
    id: message.id,
    sessionId: message.session_id,
    type: message.type,
    content: message.content,
    thinking: message.thinking,
    toolCalls: message.tool_calls,
    toolResults: message.tool_results,
    timestamp: message.timestamp,
    parentId: message.parent_id,
  }))}`;
}

function truncateUtf8(value: string, maxBytes: number): string {
  if (Buffer.byteLength(value, 'utf8') <= maxBytes) return value;
  const marker = '\n[content truncated for bounded analysis]';
  const budget = Math.max(0, maxBytes - Buffer.byteLength(marker, 'utf8'));
  let low = 0;
  let high = value.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (Buffer.byteLength(value.slice(0, middle), 'utf8') <= budget) low = middle;
    else high = middle - 1;
  }
  if (low > 0 && /[\uD800-\uDBFF]/.test(value[low - 1] ?? '')) low -= 1;
  return `${value.slice(0, low)}${marker}`;
}

function toolNames(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.map((item) => {
      if (item && typeof item === 'object' && 'name' in item && typeof item.name === 'string') {
        return /^[A-Za-z0-9_.:-]{1,80}$/.test(item.name) ? item.name : 'unknown';
      }
      return 'unknown';
    });
  } catch {
    return [];
  }
}

function everyString(value: unknown, predicate: (value: string) => boolean): boolean {
  if (typeof value === 'string') return predicate(value);
  if (Array.isArray(value)) return value.every((item) => everyString(item, predicate));
  if (value && typeof value === 'object') {
    return Object.values(value as Record<string, unknown>)
      .every((item) => everyString(item, predicate));
  }
  return true;
}

function matchesType(value: unknown, type: string): boolean {
  switch (type) {
    case 'null': return value === null;
    case 'object': return value !== null && typeof value === 'object' && !Array.isArray(value);
    case 'array': return Array.isArray(value);
    case 'integer': return typeof value === 'number' && Number.isSafeInteger(value);
    case 'number': return typeof value === 'number' && Number.isFinite(value);
    default: return typeof value === type;
  }
}

function matchesSchema(value: unknown, schemaValue: unknown): boolean {
  if (!schemaValue || typeof schemaValue !== 'object' || Array.isArray(schemaValue)) return false;
  const schema = schemaValue as Record<string, unknown>;
  const types = Array.isArray(schema.type) ? schema.type : [schema.type];
  if (!types.some((type) => typeof type === 'string' && matchesType(value, type))) return false;
  if (Array.isArray(schema.enum) && !schema.enum.some((item) => Object.is(item, value))) return false;
  if (typeof value === 'number') {
    if (typeof schema.minimum === 'number' && value < schema.minimum) return false;
    if (typeof schema.maximum === 'number' && value > schema.maximum) return false;
  }
  if (Array.isArray(value)) {
    if (typeof schema.minItems === 'number' && value.length < schema.minItems) return false;
    if (typeof schema.maxItems === 'number' && value.length > schema.maxItems) return false;
    if (schema.items && !value.every((item) => matchesSchema(item, schema.items))) return false;
  }
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    const properties = schema.properties && typeof schema.properties === 'object'
      ? schema.properties as Record<string, unknown>
      : {};
    if (Array.isArray(schema.required)
        && !schema.required.every((key) => typeof key === 'string' && key in record)) return false;
    if (!Object.entries(properties).every(([key, child]) => !(key in record)
      || matchesSchema(record[key], child))) return false;
    if (schema.additionalProperties === false
        && Object.keys(record).some((key) => !(key in properties))) return false;
  }
  return true;
}

/** Parse without repair and validate the schema subset used by both analysis contracts. */
export function validateAutomaticStructuredJson(raw: string, schema: object): void {
  const trimmed = raw.trim();
  const tagged = trimmed.match(/^<json>\s*([\s\S]*?)\s*<\/json>$/i);
  const payload = tagged?.[1] ?? trimmed;
  let value: unknown;
  try {
    value = JSON.parse(payload);
  } catch {
    throw new AutomaticAnalysisBoundaryError('invalid-structured-output');
  }
  if (!matchesSchema(value, schema)) {
    throw new AutomaticAnalysisBoundaryError('invalid-structured-output');
  }
}

export interface AutomaticAnalysisBoundary {
  formattedEvidence: string;
  safeMetadata: AutomaticAnalysisMetadata;
  assertSafeInput(): void;
  validateSessionOutput(output: AnalysisResponse): void;
  validatePromptQualityOutput(output: PromptQualityResponse): void;
  isCurrent(messages: SQLiteMessageRow[]): boolean;
}

export interface AutomaticAnalysisMetadata {
  projectName: string;
  summary: string | null;
  sessionMeta: SessionMetadata;
}

interface RenderedEvidence {
  formattedEvidence: string;
  allowedEvidenceRefs: Set<string>;
  allowedUserRefs: Set<string>;
  injectionDetected: boolean;
}

/** Keep untrusted strings on one JSON line and prevent them from forging packet markers. */
function encodeData(value: unknown): string {
  return JSON.stringify(value).replace(/[<>&]/g, (character) => {
    switch (character) {
      case '<': return '\\u003c';
      case '>': return '\\u003e';
      default: return '\\u0026';
    }
  });
}

function completeTurns(messages: SQLiteMessageRow[]): {
  turns: SQLiteMessageRow[][];
  totalTurnCount: number;
} {
  const turns: SQLiteMessageRow[][] = [];
  let current: SQLiteMessageRow[] | null = null;
  let totalTurnCount = 0;
  for (const message of messages) {
    const startsTurn = message.type === 'user'
      && classifyStoredUserMessage(message.content) === 'human';
    if (startsTurn) {
      if (current?.some((event) => event.type === 'assistant')) turns.push(current);
      current = [message];
      totalTurnCount += 1;
    } else if (current) {
      current.push(message);
    }
  }
  if (current?.some((event) => event.type === 'assistant')) turns.push(current);
  return { turns, totalTurnCount };
}

function renderEvidence(
  messages: SQLiteMessageRow[],
  omittedEvents: number,
  omittedTurns: number,
  metadata: AutomaticAnalysisMetadata,
  contentByteLimit?: number,
): RenderedEvidence {
  let userIndex = 0;
  let assistantIndex = 0;
  let systemIndex = 0;
  let omittedIndex = 0;
  let injectionDetected = false;
  const allowedEvidenceRefs = new Set<string>();
  const allowedUserRefs = new Set<string>();

  const entries = messages.map((message) => {
    const classification = message.type === 'user'
      ? classifyStoredUserMessage(message.content)
      : null;
    let evidenceRef: string;
    let contentClass: 'redacted-text' | 'omitted-sensitive';
    let content: string;
    if (classification === 'tool-result') {
      evidenceRef = `Omitted#${omittedIndex++}`;
      contentClass = 'omitted-sensitive';
      content = '[tool-result content omitted]';
    } else {
      if (message.type === 'user' && classification === 'human') {
        evidenceRef = `User#${userIndex++}`;
        allowedUserRefs.add(evidenceRef);
      } else if (message.type === 'assistant') {
        evidenceRef = `Assistant#${assistantIndex++}`;
      } else {
        evidenceRef = `System#${systemIndex++}`;
      }
      contentClass = 'redacted-text';
      const redacted = redactEvidenceText(message.content);
      if (redacted.includes('[untrusted-instruction]')) injectionDetected = true;
      content = contentByteLimit ? truncateUtf8(redacted, contentByteLimit) : redacted;
    }
    allowedEvidenceRefs.add(evidenceRef);
    const tools = toolNames(message.tool_calls);
    return encodeData({
      kind: 'event', evidenceRef, evidenceVersion: messageVersion(message), contentClass, content,
      thinking: message.thinking ? '[thinking content omitted]' : undefined,
      tools: tools.map((name) => `tool:${name}`),
      toolResults: message.tool_results && message.tool_results !== '[]'
        ? '[tool-result content omitted]'
        : undefined,
    });
  });

  return {
    formattedEvidence: [
      'BEGIN_AGENT_ANALYTICS_UNTRUSTED_DATA',
      encodeData({
        kind: 'coverage', included_events: messages.length, omitted_events: omittedEvents,
        included_turns: completeTurns(messages).turns.length, omitted_turns: omittedTurns,
      }),
      encodeData({ kind: 'metadata', ...metadata }),
      ...entries,
      'END_AGENT_ANALYTICS_UNTRUSTED_DATA',
      'For evidence and message_ref fields, use only the exact turn labels above. Never quote source text.',
    ].join('\n'),
    allowedEvidenceRefs,
    allowedUserRefs,
    injectionDetected,
  };
}

function sanitizeMetadata(metadata: AutomaticAnalysisMetadata): {
  metadata: AutomaticAnalysisMetadata;
  injectionDetected: boolean;
} {
  let injectionDetected = false;
  const redact = (value: string): string => {
    const redacted = redactEvidenceText(value);
    if (redacted.includes('[untrusted-instruction]')) injectionDetected = true;
    return truncateUtf8(redacted, 4 * 1024);
  };
  return {
    metadata: {
      projectName: redact(metadata.projectName),
      summary: metadata.summary === null ? null : redact(metadata.summary),
      sessionMeta: {
        compactCount: metadata.sessionMeta.compactCount,
        autoCompactCount: metadata.sessionMeta.autoCompactCount,
        slashCommands: metadata.sessionMeta.slashCommands?.slice(0, 50).map((value) =>
          truncateUtf8(redact(value), 512)),
      },
    },
    injectionDetected,
  };
}

/** Build the same redaction, omission, injection, and evidence-closure boundary as semantic analysis. */
export function buildAutomaticAnalysisBoundary(
  messages: SQLiteMessageRow[],
  metadata: AutomaticAnalysisMetadata = {
    projectName: '', summary: null, sessionMeta: {},
  },
): AutomaticAnalysisBoundary {
  const sanitizedMetadata = sanitizeMetadata(metadata);
  const turnCollection = completeTurns(messages);
  const turns = turnCollection.turns;
  const selectedTurns: SQLiteMessageRow[][] = [];
  let selectedEvents = 0;
  let newestTurnTooLarge = false;
  let selectedContentByteLimit: number | undefined;
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const completeTurn = turns[index];
    if (!completeTurn) continue;
    const turn = completeTurn.length > AUTOMATIC_EVIDENCE_MAX_EVENTS && selectedTurns.length === 0
      ? [completeTurn[0]!, ...completeTurn.slice(-(AUTOMATIC_OVERSIZED_TURN_SAMPLE_EVENTS - 1))]
      : completeTurn;
    if (selectedEvents + turn.length > AUTOMATIC_EVIDENCE_MAX_EVENTS) {
      break;
    }
    const candidateTurns = [turn, ...selectedTurns];
    const candidateMessages = candidateTurns.flat();
    const candidate = renderEvidence(
      candidateMessages,
      messages.length - candidateMessages.length,
      turnCollection.totalTurnCount - candidateTurns.length,
      sanitizedMetadata.metadata,
    );
    if (Buffer.byteLength(candidate.formattedEvidence, 'utf8') > AUTOMATIC_EVIDENCE_MAX_BYTES) {
      if (selectedTurns.length === 0) {
        for (const limit of [8_192, 4_096, 2_048, 1_024, 512, 256]) {
          const bounded = renderEvidence(
            turn,
            messages.length - turn.length,
            turnCollection.totalTurnCount - 1,
            sanitizedMetadata.metadata,
            limit,
          );
          if (Buffer.byteLength(bounded.formattedEvidence, 'utf8') <= AUTOMATIC_EVIDENCE_MAX_BYTES) {
            selectedTurns.push(turn);
            selectedEvents += turn.length;
            selectedContentByteLimit = limit;
            break;
          }
        }
        newestTurnTooLarge = selectedTurns.length === 0;
      }
      break;
    }
    selectedTurns.unshift(turn);
    selectedEvents += turn.length;
  }
  const selectedMessages = selectedTurns.flat();
  const rendered = renderEvidence(
    selectedMessages,
    messages.length - selectedMessages.length,
    turnCollection.totalTurnCount - selectedTurns.length,
    sanitizedMetadata.metadata,
    selectedContentByteLimit,
  );
  const versions = new Map(messages.map((message) => [message.id, messageVersion(message)]));
  const noCompleteEvidence = messages.length > 0 && turns.length === 0;
  const metadataTooLarge = Buffer.byteLength(
    renderEvidence([], messages.length, turnCollection.totalTurnCount, sanitizedMetadata.metadata)
      .formattedEvidence,
    'utf8',
  ) > AUTOMATIC_EVIDENCE_MAX_BYTES;

  const validateSensitiveOutput = (output: unknown) => {
    if (!everyString(output, (value) => !containsSensitiveOutput(value))) {
      throw new AutomaticAnalysisBoundaryError('sensitive-output');
    }
  };
  const validRefs = (refs: unknown, allowed: Set<string>) => Array.isArray(refs) && refs.length > 0
    && refs.every((ref) => typeof ref === 'string' && allowed.has(ref));

  return {
    formattedEvidence: rendered.formattedEvidence,
    safeMetadata: sanitizedMetadata.metadata,
    assertSafeInput: () => {
      if (sanitizedMetadata.injectionDetected || rendered.injectionDetected) {
        throw new AutomaticAnalysisBoundaryError('input-injection-detected');
      }
      if (noCompleteEvidence) {
        throw new AutomaticAnalysisBoundaryError('input-evidence-unavailable');
      }
      if (newestTurnTooLarge || metadataTooLarge) {
        throw new AutomaticAnalysisBoundaryError('input-evidence-too-large');
      }
    },
    validateSessionOutput: (output) => {
      validateSensitiveOutput(output);
      for (const insight of [...output.decisions, ...output.learnings]) {
        if (!validRefs(insight.evidence, rendered.allowedEvidenceRefs)) {
          throw new AutomaticAnalysisBoundaryError('invalid-evidence-reference');
        }
      }
    },
    validatePromptQualityOutput: (output) => {
      validateSensitiveOutput(output);
      if (![...output.takeaways, ...output.findings]
        .every((item) => typeof item.message_ref === 'string' && rendered.allowedUserRefs.has(item.message_ref))) {
        throw new AutomaticAnalysisBoundaryError('invalid-evidence-reference');
      }
    },
    isCurrent: (current) => current.length === messages.length
      && current.every((message) => versions.get(message.id) === messageVersion(message)),
  };
}
