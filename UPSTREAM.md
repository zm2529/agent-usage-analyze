# Upstream provenance

Agent Usage Analyzer began from selected source in Code Insights under the MIT License.

- Upstream project: `melagiri/code-insights`
- Frozen source commit: `4177d3c496a4a517ff72aa2f4a813dd69865371c`
- Upstream package version: `4.11.0`
- Upstream copyright: Copyright (c) 2026 Srikanth Rao M
- Local modifications: independent product naming and configuration, canonical event/evidence domain model, Codex-specific ingestion, versioned scorecards, local advisory behavior, and evidence-first UI/API behavior.

The original MIT notice is preserved in [LICENSE](LICENSE). No affiliation with or endorsement by the upstream project is implied.

## Managed Git AI sidecar

The optional prospective provenance sidecar vendors the complete Git AI source under its Apache-2.0 license.

- Upstream project: `git-ai-project/git-ai`
- Frozen source commit: `da79071f21f3b018aa7d4ee4e7d5fa8bf3555a88`
- Frozen source tree: `bdc44638c44dc0f7220f1d77f8d9c7da95da5944`
- Upstream source version: `1.6.16`
- Local patch stack: empty; conservative confidence and abstention live in the product adapter, not a provenance rewrite
- Integration boundary: CLI JSON and `refs/notes/ai` using `authorship/3.0.0`; no Rust FFI

The full upstream source, license, and per-file integrity manifest are preserved in `cli/vendor/`. Git AI is optional and is not used as a quality score.
