# Agent Analytics CLI

The CLI imports local Codex work into the canonical event store and starts the loopback-only dashboard.

```sh
agent-analytics ingest-fixture ./canonical-batch.json
agent-analytics migrate-product
agent-analytics import-codex
agent-analytics dashboard --no-open
agent-analytics reset
```

For automatic Codex analysis, run `agent-analytics install-hook --source codex`, trust the handler from Codex `/hooks`, then inspect it with `agent-analytics doctor` and `agent-analytics queue status`. See the repository [Codex zero-config guide](../docs/codex-zero-config-analysis.md).

Product telemetry and remote semantic analysis are disabled by default. See the repository [README](../README.md), [UPSTREAM](../UPSTREAM.md), and [LICENSE](../LICENSE).
