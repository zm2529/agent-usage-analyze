# Codex rollout structural oracles

Ticket 02 uses three independent, sanitized fixtures under
`cli/src/__fixtures__/codex-oracles/`. They preserve only the event shapes needed
for differential parsing; all message bodies use `PRIVATE_SENTINEL` and tests prove
that value never reaches the canonical database or task API.

| Frozen candidate | Source evidence | Canonical expectations |
| --- | --- | --- |
| Code Insights `4177d3c` | envelope/payload JSONL with session meta, user/assistant messages, task completion | stable task identity and typed message/lifecycle events |
| Buildermark `6c6374b` | legacy top-level `input` and `item.completed`, plus active/archive roots | synthesized structural session meta and typed messages |
| Entire `e009b75` | line-wise `session_meta.payload.id` and `compacted.replacement_history` | stable identity and a sensitive compaction reference, never copied history |

## Sanitized live-structure reconciliation (2026-07-21)

The local check inspected only envelope names and object keys from three rollout
files; it did not print, store, or commit prompt, code, tool argument, reasoning,
or output values.

- Envelopes observed: `session_meta`, `turn_context`, `response_item`,
  `event_msg`, and `compacted`.
- Response item types observed: message, reasoning, function/custom tool
  call/output, tool search, and ghost snapshot.
- Event message types observed: user/agent message, agent reasoning, token count,
  task lifecycle, context compacted, patch/MCP completion, turn aborted, and
  thread rollback.
- Token total fields observed: input, cached input, output, reasoning output,
  and total. Cache creation and compaction were absent in the sample, so V1
  reports the affected delta segment as unknown instead of substituting zero.
- Subagent identity was present through `parent_thread_id` and
  `source.subagent.thread_spawn.parent_thread_id`; repository or timestamp
  proximity is never used as a merge key.

The committed differential test runs every candidate fixture through the same
`SourceAdapter -> CanonicalBatch -> WorkTaskDetail` oracle and compares event
identity, type, order, and privacy behavior.
