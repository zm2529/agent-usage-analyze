# Agent Analytics

Agent Analytics is a local-first, single-user system for understanding Codex work tasks, delivery evidence, recurring efficiency patterns, and non-blocking improvement advice.

This repository is an independent derivative product. It is not an official extension of Code Insights. The current implementation is derived in part from the MIT-licensed Code Insights project; see [UPSTREAM.md](UPSTREAM.md) and [LICENSE](LICENSE).

## Development

```sh
pnpm install
pnpm test
pnpm build
```

The local server binds to loopback. Product telemetry is disabled by default, and optional semantic analysis is not required for deterministic ingestion and trends.

## Codex zero-config analysis

After one Hook installation and one Codex trust confirmation, completed Codex turns are settled, imported, and analyzed automatically. A configured Provider remains preferred; otherwise `auto` only reuses a Codex login that is clearly identified as ChatGPT authentication.

See [Codex zero-config analysis](docs/codex-zero-config-analysis.md) for installation, configuration, privacy, billing semantics, usage, testing, and troubleshooting.
