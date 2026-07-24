# Agent Usage Analyzer CLI

The CLI syncs local coding-agent sessions and starts the loopback-only dashboard. Codex has the most complete V1 task, evidence, automatic-capture, and advice path.

```sh
npx --yes agent-usage-analyze start
```

The command initializes private local storage, syncs Codex, Claude Code, Cursor, GitHub Copilot CLI, and GitHub Copilot history, installs or refreshes Codex capture, and opens the dashboard immediately. The first Codex history backfill runs in the background while the WebUI shows progress and an ETA. Use `--wait-for-import` to keep that work in the terminal. Trust the handler once from Codex `/hooks` if prompted. Use `npx --yes agent-usage-analyze doctor` for diagnostics and see the repository [automatic analysis guide](../docs/codex-zero-config-analysis.md) for advanced controls.

Product telemetry and remote semantic analysis are disabled by default. See the repository [README](../README.md), [UPSTREAM](../UPSTREAM.md), and [LICENSE](../LICENSE).
