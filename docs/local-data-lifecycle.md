# Local data lifecycle

Agent Usage Analyzer keeps its database, sync cursor, migration reports, and recoverable backups under the local data directory shown in **Settings → Local runtime and data**. The HTTP server binds to `127.0.0.1` only.

## Export a sanitized summary

Use **Download sanitized export** in Settings. The versioned JSON contains aggregate counts, coverage and diagnostics, parser/database versions, and irreversible evidence locators. It excludes prompt text, code, thinking, tool payloads, repository paths, and credentials.

## Archive and rebuild local analysis

```sh
agent-usage-analyze reset
agent-usage-analyze import-codex
```

`reset` moves the product-owned database and sync state into a timestamped backup instead of permanently deleting them. It refuses an incomplete archive while another WAL reader is active. It does not modify imported history files or Git repositories. Restore the reported backup paths for recovery, or run `import-codex` to rebuild canonical projections from the original local sources.

## Permanently uninstall local data

```sh
agent-usage-analyze uninstall
```

This stops the local service and removes Agent Usage Analyzer hooks, product-owned local data, and the global npm command. Source Codex/Claude sessions and Git repositories are preserved.
