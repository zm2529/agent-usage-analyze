# Contributing to Agent Analytics

Agent Analytics is a local-first, single-user Codex analysis product. Read `CONTEXT.md`, the active local ticket, and the V1 specification before changing domain behavior.

## Development

Requirements: Node.js 18 or later and pnpm 9 or later.

```sh
pnpm install
pnpm test
pnpm build
```

Tests exercise public seams. Canonical ingestion tests enter through `SourceAdapter -> CanonicalBatch`; server tests use the Hono request interface; UI tests assert user-visible states. Use isolated data directories and disposable Git repositories. Tests and committed fixtures must not read or contain real prompts, code, thinking, tool payloads, credentials, or user history.

## Change discipline

- Work one local ticket at a time and keep later changes small and reversible.
- The initial frozen MIT source import is the only expected wide bootstrap; subsequent changes should be narrow vertical slices.
- Keep source adapters factual. Scoring, causal claims, and semantic judgments belong downstream and must cite evidence.
- Preserve loopback-only serving, telemetry-off defaults, explicit external-provider consent, and fail-open advisory behavior.
- Preserve the upstream license, copyright, frozen source reference, and modification notice.
- Do not modify the `work/` candidate checkouts from the product repository.

## Commit messages

Use `feat`, `fix`, `docs`, `chore`, `refactor`, or `test` with a concise description. Commit only after targeted tests, relevant build/type checks, and the ticket review pass.

## License

Contributions are licensed under the repository MIT License.
