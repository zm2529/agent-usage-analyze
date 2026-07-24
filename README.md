# Agent Usage Analyzer

Agent Usage Analyzer is a local-first, single-user system for understanding how you use coding agents. It imports sessions from Codex, Claude Code, Cursor, GitHub Copilot CLI, and GitHub Copilot; V1 provides the deepest task, delivery-evidence, automatic-capture, and improvement-advice path for Codex.

Third-party licensing and source notices are documented in [UPSTREAM.md](UPSTREAM.md) and [LICENSE](LICENSE).

## Install and start

```sh
npx --yes agent-usage-analyze start
```

This one command initializes private local storage, syncs all supported agent histories, configures automatic Codex capture, and opens the loopback-only dashboard immediately. The first Codex history backfill continues in the background; the WebUI shows what it is doing, file progress, elapsed time, and an ETA. Codex may require one explicit trust confirmation for the local handler in `/hooks`. To keep the import in the terminal instead, add `--wait-for-import`.

## Behavior analysis and advice

The WebUI makes the planned product loop explicit: session insights feed cross-session behavior patterns, while evidence-linked Codex tasks can produce non-blocking improvement advice and comparable scorecards. Other agents participate in session, usage, insight, and behavior analysis; their task/evidence/advice depth will be expanded after V1.

The interface supports English and Simplified Chinese. Use the language switch in the header; the choice is stored locally.

## Development

```sh
pnpm install
pnpm test
pnpm build
```

The local server binds to loopback. Product telemetry is disabled by default, and optional semantic analysis is not required for deterministic ingestion and trends.

## Best-supported Codex path

After one Hook installation and one Codex trust confirmation, completed Codex turns are settled, imported, and analyzed automatically. A configured Provider remains preferred; otherwise `auto` only reuses a Codex login that is clearly identified as ChatGPT authentication.

See [Codex zero-config analysis](docs/codex-zero-config-analysis.md) for installation, configuration, privacy, billing semantics, usage, testing, and troubleshooting.
