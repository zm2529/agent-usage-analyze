# Local data lifecycle

Agent Analytics keeps its database, sync cursor, migration reports, and recoverable backups under the local data directory shown in **Settings → Local runtime and data**. The HTTP server binds to `127.0.0.1` only.

## Migrate a frozen Code Insights database

```sh
agent-analytics migrate-product
```

For the frozen V9 schema, this command creates a SQLite backup before applying canonical migrations. It backfills only structural metadata into canonical events, reconciles session/message counts, makes legacy tables read-only, and writes a redacted migration report. Automatic startup migration refuses to mutate a frozen legacy database until this backup-first command has run.

## Export a sanitized summary

Use **Download sanitized export** in Settings. The versioned JSON contains aggregate counts, coverage and diagnostics, parser/database versions, and irreversible evidence locators. It excludes prompt text, code, thinking, tool payloads, repository paths, and credentials.

## Archive and rebuild local analysis

```sh
agent-analytics reset
agent-analytics import-codex
```

`reset` moves the product-owned database and sync state into a timestamped backup instead of permanently deleting them. It refuses an incomplete archive while another WAL reader is active. It does not modify imported history files or Git repositories. Restore the reported backup paths for recovery, or run `import-codex` to rebuild canonical projections from the original local sources.
