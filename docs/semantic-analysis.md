# Privacy-controlled semantic analysis

Semantic analysis is an optional second layer over the deterministic Codex task model. It is disabled by default. Ingestion, task reconstruction, trends, deterministic claims, and the rest of the dashboard continue to work when no LLM is configured.

## Explicit opt-in

Configure a provider and model in Settings, review whether the provider is local or remote, then enable Semantic analysis. Local `ollama` and `llamacpp` providers do not require an API key. Remote providers require an explicitly stored API key before the feature can be enabled. Disabling the setting stops future analysis without changing deterministic data.

Before a run, the task page shows:

- provider, model, and local/remote locality;
- the first and last included turn, turn count, and event count;
- evidence coverage and estimated input tokens;
- estimated cost when pricing is available, or an explicit unavailable state.

Remote cost estimates include the estimated packet input plus a 1,024-token output allowance. Unknown or custom model pricing remains unavailable rather than being reported as free.

The API exposes `POST /api/semantic/preview`, `POST /api/semantic/analyze`, and `GET /api/semantic/claims?taskId=...`. Preview and analysis bodies contain exactly one `taskId` field. A disabled preview returns a normal `disabled` result rather than an error.

## Evidence boundary

Packets contain only canonical events belonging to the selected root task. Cropping happens on complete turn boundaries, newest first, with hard event and serialized-byte limits. Event classes remain explicit: user, assistant, system, tool call, tool result, thinking, and compaction. Tool calls expose metadata only; tool results and thinking are represented as omitted-sensitive markers.

User, assistant, system, and compaction text passes through redaction before packet serialization. Redaction covers instruction-injection phrases, common credentials and secret assignments, email addresses, absolute local paths, private keys, and fenced source code. The provider receives the system policy separately from the evidence packet, whose boundary marks all content as untrusted data and never as instructions.

Raw resolved payload text, provider request text, and provider response text are not persisted, logged, placed in tracker files, or added to export paths. Provider failures are stored only as a stable rejection code.

Each submitted event also carries a non-sensitive SHA-256 version fingerprint over its canonical identity, lane, parser version, metadata, and opaque payload locator. The accepted-write transaction and later read path both recompute this fingerprint, so an event ID whose underlying locator or metadata changed is rejected or hidden rather than rebound to different evidence.

## Validation and storage

Provider output must match `agent-analytics.semantic-output.v1` exactly. A run is rejected if JSON or fields are invalid, a number is non-finite or out of range, confidence is below `0.7`, an evidence ID is not in the submitted packet, sensitive content is echoed, or the result uses disallowed subjective judgments.

Accepted records store only:

- provider, model, and local/remote locality;
- rubric and analysis versions;
- input coverage, estimated and actual token counts, and cost;
- validated claim fields and opaque evidence references.

Semantic claims are labeled `LLM-semantic`; deterministic claims remain separate. Read paths fail closed unless the run and claim use the current versions, the confidence threshold still holds, every semantic evidence record is present, and every referenced canonical event belongs to the requested root task.

Tests use injected fake providers and do not require network access.
