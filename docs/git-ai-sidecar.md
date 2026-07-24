# Managed Git AI prospective sidecar

Agent Usage Analyzer vendors Git AI `1.6.16` at source commit `da79071f21f3b018aa7d4ee4e7d5fa8bf3555a88` as an optional prospective provenance sidecar. The product integrates only through read-only CLI JSON inspection and local `refs/notes/ai` records using `authorship/3.0.0`; it does not use Rust FFI and does not reimplement provenance in TypeScript.

## Source and build contract

- `cli/vendor/git-ai/` contains the complete 869-file frozen source archive and the upstream Apache-2.0 license.
- `cli/vendor/git-ai-files.sha256` covers every vendored file's Git mode, symlink target or bytes; `git-ai-manifest.json` fixes the upstream commit, Git-compatible tree, version, schema and file-manifest digest.
- The local patch stack is intentionally empty. Dirty-state protection and abstention are product evidence policy outside the Rust source.
- `agent-usage-analyze git-ai-sidecar verify` checks every file and rejects missing, changed, duplicate or unmanifested source.
- `agent-usage-analyze git-ai-sidecar build` runs `cargo build --locked --offline --release` with Cargo offline mode forced. It cannot fetch dependencies.
- If the locked crates are not already cached, `agent-usage-analyze git-ai-sidecar build --allow-network` is the explicit dependency-fetch opt-in. It still uses the frozen source and lockfile; runtime inspection, gates and Notes consumption never use the network.

## Explicit configuration

```sh
agent-usage-analyze git-ai-sidecar verify
agent-usage-analyze git-ai-sidecar build
agent-usage-analyze git-ai-sidecar configure \
  --binary /absolute/path/to/cli/vendor/git-ai/target/release/git-ai \
  --notes-export local-only
agent-usage-analyze git-ai-sidecar inspect --repository /absolute/path/to/an-explicit-repository
```

Configuration is stored with user-only permissions and binds the executable's SHA-256 and reported `1.6.16` version. Every sidecar invocation receives an isolated product-managed HOME containing Git AI's native `telemetry_oss: off`, local-only prompt storage, disabled version/update checks, and disabled daemon-upload/transcript-streaming feature flags. Health inspection reads Git AI's own `config` JSON and verifies those effective values. It never relies on or edits the user's normal `~/.git-ai` state. Product configuration never installs Git/Codex hooks and never pushes Notes. `manual-external` records that any Notes export is a separate user-controlled action; Agent Usage Analyzer still performs no push.

Passing `--enable` only requests evidence consumption. Consumption remains disabled until the latest prospective gate passes with the frozen source tree, binary hash/version and JSON health check intact. A failed or corrupt report, unreadable/corrupt configuration, binary drift or health-check failure immediately hides Git AI candidates while preserving the historical evidence record.

## Prospective gate

The local gate reads a strict, sanitized `agent-analytics.git-ai-prospective-evidence.v1` matrix and validates referenced commits and Git AI Notes directly in a disposable repository:

```sh
agent-usage-analyze git-ai-gate /absolute/path/to/sanitized-matrix.json \
  --repository /absolute/path/to/disposable-repository
```

The required matrix is:

| Scenario | Product support | Required result |
| --- | --- | --- |
| clean | supported | candidate with matching v3 Note and high confidence |
| pre-existing dirty | abstained | `pre-existing-dirty` |
| missing baseline | abstained | `missing-baseline` |
| partial stage | limited | candidate limited to committed changes |
| amend | limited | candidate with rewrite limitation |
| rebase | limited | candidate with rewrite limitation; the pinned upstream rebase regression does not preserve attribution reliably |
| linked worktree | supported | candidate only when the task worktree shares the repository common dir but is isolated |
| same-worktree concurrency | abstained | `same-worktree-concurrent` |
| unsupported Git client | abstained | `unsupported-client` |

Candidate Notes must come from the pinned sidecar and match the canonical task's deterministic Codex session identity. Their base must be the target commit's direct parent and every attested range must belong to a changed path and line in that commit. Primary tasks must resolve to the exact worktree; linked tasks must resolve to a distinct worktree with the same real Git common directory. Raw prompts, messages, code, diffs, paths, line percentages and legacy prompt statistics are rejected at the product boundary. Only opaque Note hashes and versioned evidence facts are persisted.

The gate never installs hooks, pushes Notes, mutates a user repository or enables a quality score. Git AI provenance remains a task-delivery candidate with explicit confidence and limits; AI line percentages are not product score features.

The sanitized fixed-version validation record is committed at `docs/git-ai-prospective-gate-2026-07-21.json`. It distinguishes product-policy coverage from upstream regression behavior and records the local Git fixture limitation without repository paths, prompts, code, diffs or user identity.
