# Agent Usage Analyzer CLI

[English](https://github.com/zm2529/agent-usage-analyze#readme) ·
[简体中文](https://github.com/zm2529/agent-usage-analyze/blob/main/README.zh-CN.md)

The CLI syncs local coding-agent sessions and starts the loopback-only dashboard. Codex has the most complete V1 task, evidence, automatic-capture, and advice path.

```sh
npx --yes agent-usage-analyze start
```

The command initializes private local storage, syncs supported Agent history, installs or refreshes Codex capture, registers the loopback dashboard as a macOS login service, and opens it. The command exits after the service is healthy, so the terminal can be closed. The first Codex history backfill continues in the background; the WebUI shows progress and only adds an ETA after throughput stabilizes. Use `--wait-for-import` to keep that work in the terminal. Trust the handler once from Codex `/hooks` if prompted. Use `npx --yes agent-usage-analyze doctor` for diagnostics and see the repository [automatic analysis guide](../docs/codex-zero-config-analysis.md) for advanced controls.

Product telemetry and remote semantic analysis are disabled by default. See the repository [README](../README.md), [UPSTREAM](../UPSTREAM.md), and [LICENSE](../LICENSE).
