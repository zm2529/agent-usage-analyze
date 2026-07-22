# Codex zero-config automatic analysis

Agent Analytics can import and analyze a Codex task after its completed turns settle. The Codex `Stop` Hook only records a small frontier and starts a detached worker; it does not import, call a model, or delay the Codex turn. Repeated Stop events move one per-session deadline, so a burst becomes one analysis job for the latest stable generation.

## Install

Requirements: Node.js 18+, pnpm 8+ for a source build, and Codex CLI for Codex-native analysis.

From a published package:

```sh
npm install --global @agent-analytics/cli
```

From this checkout:

```sh
pnpm install --frozen-lockfile
pnpm build
npm install --global ./cli
```

Install only the Codex Hook:

```sh
agent-analytics install-hook --source codex
```

The installer preserves unrelated Hook handlers, creates a private backup before changing an existing Codex Hook file, and is idempotent. If you use both supported agents, use `--source all`; Claude keeps its existing `SessionEnd` path.

## Trust and first use

1. In Codex, open `/hooks` and trust the Agent Analytics `Stop` handler. Installation cannot grant trust on your behalf.
2. Confirm Codex authentication with `codex login status`. Automatic subscription reuse requires the result to identify a ChatGPT login.
3. Run `agent-analytics doctor`. Its Hooks and AI Analysis sections report installation and provide the exact `/hooks` trust-review instruction; `config analysis --show` reports authentication, effective runner, and downgrade reason.
4. Finish a Codex turn. The default stable-frontier delay is 90 seconds.
5. Inspect progress with `agent-analytics queue status`, or open `agent-analytics dashboard`. The status includes the recent automatic lifecycle state, effective runner, authentication type, downgrade reason, and next action.

Queue lifecycle:

```text
settling -> import -> awaiting-capability -> processing -> completed
                 \-> settling (bounded retry)
                 \-> failed (bounded attempts)
```

`awaiting-capability` is terminal until the capability changes or you explicitly run `agent-analytics queue retry --all`; it is not a retry loop.

## Execution policy and existing configuration

Show the saved and effective policy:

```sh
agent-analytics config analysis --show
```

Select a mode explicitly:

```sh
agent-analytics config analysis --mode auto
agent-analytics config analysis --mode codex-native
agent-analytics config analysis --mode claude-native
agent-analytics config analysis --mode provider
agent-analytics config analysis --mode local-only
agent-analytics config analysis --mode off
```

`auto` preserves the existing configuration contract:

- A configured Provider is selected first.
- Without a Provider, a clearly classified ChatGPT Codex login selects `codex-native`.
- API-key or access-token Codex authentication is never selected automatically.
- Unknown, missing, or logged-out Codex authentication downgrades safely to local-only analysis.
- `provider`, `claude-native`, and `codex-native` remain available as explicit choices. Explicit API-key Codex use is metered normally.

Manual workflows remain available:

```sh
agent-analytics import-codex
agent-analytics insights <session-id>
agent-analytics queue process
agent-analytics queue retry <session-id> --source codex-cli
```

## Privacy and billing semantics

Automatic remote analysis sends only the latest complete user/assistant turns that fit both hard limits: 128 events and 32 KiB for the entire packet, including project name, summary, slash-command metadata, coverage, and omission counts. Secrets, email addresses, Unix paths, Windows drive paths, and UNC paths are redacted. Thinking and tool-result bodies are omitted. Untrusted strings are JSON encoded inside an explicit data-only boundary; injection signals, invalid schemas, sensitive output, and evidence references outside the submitted packet fail closed.

The Codex-native runner uses an isolated disposable working directory, a named minimal filesystem permission profile, ignored project/user rules, disabled Hooks and optional tools, a strict output schema, an environment allowlist, and a recursion guard. It reuses normal Codex authentication but does not copy API keys or access tokens into its child environment.

A ChatGPT-authenticated Codex run uses the signed-in Codex subscription instead of a separately configured Provider API key. This does **not** mean unlimited or free usage: plan limits and Codex product terms still apply. Agent Analytics records input, cached input, output, reasoning tokens, and elapsed time as `codex-native` Observer Overhead. It does not invent a dollar cost. Provider/API-key modes retain their normal billing semantics.

All imported data, analysis results, queue state, and overhead records remain in the local Agent Analytics data directory. The dashboard listens on loopback only. Product telemetry stays disabled by default.

## Troubleshooting

- `codex-not-logged-in`: run `codex login`, verify `codex login status`, then `agent-analytics queue retry --all`.
- `codex-cli-missing`: install Codex CLI, sign in, and retry the queue.
- `codex-auth-unknown`: inspect `codex login status`; use an explicit mode if classification remains unknown.
- `source-not-found`: run `agent-analytics import-codex`, then retry with both session ID and `--source codex-cli`.
- `awaiting-capability`: read the downgrade reason in `queue status` or Dashboard; it will not retry until requested.
- `settled-analysis-failed`: inspect the private `settled-analysis.log` under the Agent Analytics config directory, fix the stated capability, then retry.
- Hook does not run: rerun `agent-analytics doctor --verbose`, open Codex `/hooks`, and confirm the exact managed handler is trusted.
- Disable without uninstalling: `agent-analytics config analysis --mode off`.
- Remove only Agent Analytics handlers: `agent-analytics uninstall-hook --source codex` (or `--source all`). Unrelated Hook handlers are preserved.

## Test and release verification

No real model is required for the automated suite; Codex-native tests use a fake CLI/runner.

```sh
pnpm test
pnpm build
pnpm audit:v1
git diff --check
```

The release audit verifies package contents and scans actual package inputs for secrets. Maintainers should also run the disposable temporary-HOME Hook smoke and loopback dashboard smoke described by the release checklist before publishing.
