# Agent Analytics CLI

The CLI imports local Codex work into the canonical event store and starts the loopback-only dashboard.

```sh
agent-analytics ingest-fixture ./canonical-batch.json
agent-analytics dashboard --no-open
```

Product telemetry and remote semantic analysis are disabled by default. See the repository [README](../README.md), [UPSTREAM](../UPSTREAM.md), and [LICENSE](../LICENSE).

