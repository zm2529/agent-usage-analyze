# Buildermark historical-helper gate

Buildermark is an optional, disabled-by-default historical association helper. Agent Usage Analyzer does not embed its UI or runtime and never treats `linesFromAgent` as a quality, ownership, or score signal.

Run a gate explicitly with a local repository and sanitized evidence file:

```sh
agent-usage-analyze buildermark-gate ./buildermark-evidence.json --repository /absolute/path/to/repository
```

The command does not start Buildermark, access the network, write a remote tracker, or modify Git history. It verifies that every referenced immutable commit exists in the repository, evaluates the evidence contract, stores a sanitized local report, and exits with status `2` when the gate fails.

## Evidence contract

The root `schemaVersion` is `agent-analytics.buildermark-evidence.v1`. The helper must be frozen to source commit `6c6374bd6b09eaf30595e3b81143baa4c92678ce`. Each commit contains zero or more experimental candidates with an opaque `task:sha256:<64 hex>` reference, a `candidate` or `abstained` state, diagnostic codes, and evidence records in one of four tiers:

- `exact`
- `formatting`
- `fallback`
- `deletion`

Each evidence record contains only `kind`, a positive `matchedLines` count, and confidence from 0 to 1. The boundary rejects raw prompt, content, diff, code, message, path, email, title, and subject fields. It also rejects Buildermark-native `linesFromAgent` percentage semantics.

The safety declaration must state whether the helper was offline, attempted remote writes, or mutated history. A synthetic gate passes only when commit import, all four evidence tiers, and ambiguity/error diagnostics are present. A real gate additionally requires reviewed candidates and zero obvious misattributions.

## Runtime decision

The WebUI exposes `disabled`, `testing`, `passed`, and `failed`. Experimental use is enabled only while both the latest synthetic and latest real gates pass. A later failure disables it immediately. Core canonical ingestion, structural trends, and the product-native Delivery/Evidence model remain available in every state.

The controlled real-history result for the frozen helper is stored in [buildermark-real-gate-2026-07-21.json](./buildermark-real-gate-2026-07-21.json). It imported all referenced commits but produced no explainable candidates, so the helper remains disabled and Agent Usage Analyzer uses its product-native delivery-evidence path.
