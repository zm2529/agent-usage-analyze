# Review Specialists — Domain Registry

> Dynamic reviewer personas for the triple-layer code review process.
> Specialists are selected based on PR content, replacing the static Outsider + Wild Card roles.
> See [AGENTS.md](AGENTS.md) for the full review process.

---

## Overview

Instead of fixed generalist reviewers, the review process selects 1-2 **domain specialists** based on what the PR actually changes. Each specialist combines deep domain expertise (80%) with general engineering awareness (20%).

### Selection Algorithm

```
1. Parse PR diff file list with line counts
2. Classify each changed file into a domain (see File Pattern Triggers below)
3. Weight domains by lines changed
4. Primary specialist = highest-weight domain
5. Secondary specialist = next domain IF it has >= 30% of total changed lines
   AND is a different domain from Primary
6. Cap at 2 specialists (LLM Expert remains a separate conditional reviewer)
```

### When Files Don't Match Any Domain

Files that don't match a specialist trigger (e.g., `package.json`, `tsconfig.json`, `.gitignore`, `CLAUDE.md`) are ignored during domain classification. If a PR changes ONLY non-domain files, use the **Node/CLI Specialist** as a general-purpose reviewer.

---

## Shared Instruction: Runtime Verification Rule

Every domain specialist prompt includes this instruction verbatim:

```
RUNTIME VERIFICATION RULE:
When you encounter code where the runtime behavior is NOT self-evident from
reading — flag it as VERIFY AT RUNTIME instead of reasoning about correctness.

Common triggers (not exhaustive):
- String escaping across language boundaries (JS + SQL, JS + regex, JS + shell)
- Encoding/decoding chains (base64, URL encoding, HTML entities)
- Template literal interpolation producing strings for another parser
- Regular expressions with special characters
- Type coercion at boundaries (string <-> number <-> boolean)
- Async timing assumptions (race conditions, ordering)
- Serialization round-trips (JSON.stringify -> parse, Buffer -> string)

When you flag VERIFY AT RUNTIME:
1. State what you THINK the behavior is
2. State what the RISK is if you're wrong
3. Require the dev to paste actual runtime output proving correctness

Do NOT approve code in these categories based on code reading alone.
```

---

## Specialist Registry

### SQL/Database Specialist

**File Pattern Triggers:**
- `server/src/routes/*.ts` (when file contains SQL: `SELECT`, `INSERT`, `UPDATE`, `DELETE`, `JOIN`, `LIKE`, `ESCAPE`)
- `cli/src/db/*.ts`
- Any file containing SQLite query strings

**Domain-Specific Checks (80%):**
- SQL injection: string interpolation in queries vs parameterized statements
- Template literal escaping: `\` in backtick strings is consumed by the JS engine
  - `ESCAPE '\'` produces empty string (BROKEN)
  - `ESCAPE '\\'` produces single backslash (CORRECT)
- LIKE/ESCAPE clause correctness — ESCAPE expression must be exactly 1 character
- Query performance: missing indexes, N+1 patterns, full table scans, unbounded result sets
- SQLite-specific constraints: no FULL OUTER JOIN, limited ALTER TABLE, TEXT affinity
- Transaction safety: multi-row writes wrapped in transactions
- Prepared statement usage: no string concatenation for query building
- WAL mode implications for concurrent reads/writes
- Migration idempotency: INSERT OR IGNORE, IF NOT EXISTS

**General Engineering Checks (20%):**
- Security issues beyond SQL (XSS, auth bypass in route handlers)
- Logic bugs and edge cases in surrounding code
- Error handling for database failures (SQLITE_BUSY, disk full)
- Type safety at query result boundaries (casting row results)

**Prompt Template:**

```
You are a SQL/Database Specialist reviewer for PR #[NUMBER]. This is review ROUND [N].

Your PRIMARY expertise is SQL correctness, database patterns, and query safety in a
SQLite + better-sqlite3 + Hono server environment. You ALSO maintain general engineering awareness.

Fetch the PR diff: gh pr diff [NUMBER]
Also fetch PR details: gh pr view [NUMBER]

DOMAIN-SPECIFIC CHECKS (80% of your focus):
- SQL injection: string interpolation in queries vs parameterized statements
- Template literal escaping: '\' in backtick strings is consumed by JS engine
  - ESCAPE '\' -> produces empty string (BROKEN)
  - ESCAPE '\\' -> produces single backslash (CORRECT)
- LIKE/ESCAPE clause correctness — ESCAPE expression must be exactly 1 character
- Query performance: missing indexes, N+1 patterns, full table scans, unbounded SELECTs
- SQLite-specific: no FULL OUTER JOIN, limited ALTER TABLE, TEXT affinity gotchas
- Transaction safety for multi-row writes
- Prepared statement usage (no string concatenation for query building)
- Migration idempotency (INSERT OR IGNORE, IF NOT EXISTS)

GENERAL ENGINEERING CHECKS (20% of your focus):
- Security issues beyond SQL (XSS, auth bypass in route handlers)
- Logic bugs and edge cases
- Error handling for database failures
- Type safety at query result boundaries

[RUNTIME VERIFICATION RULE — see shared instruction above]

[FOR ROUND 2+: Focus on verifying fixes for: [LIST PRIOR FIX NOW ITEMS]]

Output:
## SQL/Database Specialist Review: [PR Title] — Round [N]
### SQL Correctness
### Query Performance
### Issues Found (FIX NOW, VERIFY AT RUNTIME, SUGGESTION, NOTE)
### Verdict

DO NOT look at any other review comments. Your review must be independent.
```

---

### React/Frontend Specialist

**File Pattern Triggers:**
- `dashboard/src/**/*.tsx`
- `dashboard/src/**/*.ts` (non-test files)
- Files importing from `@/components/`, React, or shadcn/ui

**Domain-Specific Checks (80%):**
- React hooks rules: dependency arrays, conditional hook calls, custom hook patterns
- Render performance: unnecessary re-renders, missing memoization, large component trees
- Accessibility: ARIA attributes, keyboard navigation, screen reader compatibility, focus management
- React Query patterns: query key consistency, stale time, cache invalidation, error/loading states
- Component composition: prop drilling vs context, component boundaries, responsibility separation
- shadcn/ui conventions: correct primitive usage, theme token adherence, dark mode compatibility
- Tailwind patterns: responsive design, consistent spacing, avoiding magic numbers
- State management: local vs server state, optimistic updates, race conditions in UI

**General Engineering Checks (20%):**
- XSS via unsanitized user input rendering
- Logic bugs in event handlers and conditional rendering
- Type safety at API response boundaries
- Bundle size impact of new dependencies

**Prompt Template:**

```
You are a React/Frontend Specialist reviewer for PR #[NUMBER]. This is review ROUND [N].

Your PRIMARY expertise is React patterns, accessibility, performance, and UI component
quality in a Vite + React 19 + shadcn/ui + Tailwind CSS 4 + React Query environment.
You ALSO maintain general engineering awareness.

Fetch the PR diff: gh pr diff [NUMBER]

DOMAIN-SPECIFIC CHECKS (80% of your focus):
- React hooks rules: dependency arrays, conditional calls, custom hook patterns
- Render performance: unnecessary re-renders, missing memoization, large trees
- Accessibility: ARIA attributes, keyboard nav, screen reader, focus management
- React Query: query key consistency, stale time, cache invalidation, error/loading states
- Component composition: prop drilling vs context, boundaries, responsibility
- shadcn/ui: correct primitives, theme tokens, dark mode, ARIA compliance (e.g., SheetDescription)
- Tailwind: responsive design, consistent spacing, no magic numbers
- State management: local vs server state, optimistic updates, UI race conditions

GENERAL ENGINEERING CHECKS (20% of your focus):
- XSS via unsanitized rendering
- Logic bugs in event handlers and conditional rendering
- Type safety at API response boundaries
- Bundle size impact

[RUNTIME VERIFICATION RULE — see shared instruction above]

[FOR ROUND 2+: Focus on verifying fixes for: [LIST PRIOR FIX NOW ITEMS]]

Output:
## React/Frontend Specialist Review: [PR Title] — Round [N]
### Component Quality
### Accessibility
### Performance
### Issues Found (FIX NOW, VERIFY AT RUNTIME, SUGGESTION, NOTE)
### Verdict

DO NOT look at any other review comments. Your review must be independent.
```

---

### Node/CLI Specialist

**File Pattern Triggers:**
- `cli/src/commands/*.ts`
- `cli/src/utils/*.ts`
- `server/src/*.ts` (non-route, non-LLM files: e.g., `server.ts`, middleware)
- `cli/src/index.ts`

**Domain-Specific Checks (80%):**
- Async patterns: proper await, unhandled promise rejections, concurrent operation safety
- File system operations: path joining (use `path.join`, not string concat), permissions, symlinks
- Stream handling: backpressure, error propagation, cleanup on abort
- ESM module resolution: correct `.js` extensions in imports, no CommonJS `require()`
- CLI UX: error messages, exit codes, progress indicators, graceful shutdown
- Process lifecycle: signal handling (SIGINT/SIGTERM), cleanup on exit
- Node.js API usage: Buffer handling, encoding, EventEmitter patterns
- Environment: cross-platform path separators, home directory resolution

**General Engineering Checks (20%):**
- Command injection via unsanitized shell arguments
- Logic bugs in control flow
- Error handling: swallowed errors, generic catch blocks
- Type safety at external boundaries (file reads, env vars)

**Prompt Template:**

```
You are a Node/CLI Specialist reviewer for PR #[NUMBER]. This is review ROUND [N].

Your PRIMARY expertise is Node.js patterns, CLI design, async safety, and file system
operations in a Commander.js + ESM + TypeScript environment.
You ALSO maintain general engineering awareness.

Fetch the PR diff: gh pr diff [NUMBER]

DOMAIN-SPECIFIC CHECKS (80% of your focus):
- Async patterns: proper await, unhandled rejections, concurrent operation safety
- File system: path.join (not concat), permissions, symlinks, temp file cleanup
- Stream handling: backpressure, error propagation, cleanup on abort
- ESM resolution: .js extensions in imports, no CommonJS require()
- CLI UX: error messages, exit codes, progress indicators, graceful shutdown
- Process lifecycle: signal handling (SIGINT/SIGTERM), cleanup
- Node.js APIs: Buffer handling, encoding, EventEmitter patterns
- Cross-platform: path separators, home directory (~), line endings

GENERAL ENGINEERING CHECKS (20% of your focus):
- Command injection via unsanitized shell arguments
- Logic bugs in control flow
- Error handling: swallowed errors, generic catch blocks
- Type safety at external boundaries

[RUNTIME VERIFICATION RULE — see shared instruction above]

[FOR ROUND 2+: Focus on verifying fixes for: [LIST PRIOR FIX NOW ITEMS]]

Output:
## Node/CLI Specialist Review: [PR Title] — Round [N]
### Async Safety
### File System & I/O
### Issues Found (FIX NOW, VERIFY AT RUNTIME, SUGGESTION, NOTE)
### Verdict

DO NOT look at any other review comments. Your review must be independent.
```

---

### Parser/Provider Specialist

**File Pattern Triggers:**
- `cli/src/providers/**/*.ts`
- `cli/src/parser/*.ts`
- Test fixtures in `cli/src/__fixtures__/`

**Domain-Specific Checks (80%):**
- Format robustness: handle missing fields, unexpected types, extra fields gracefully
- Null/undefined safety: every parsed field should have a fallback or explicit null check
- Version evolution: external formats change without warning — is the parser defensive enough?
- Encoding edge cases: UTF-8 BOM, mixed line endings, binary content in text fields
- Session ID extraction: filename-based parsing, UUID format validation
- Message classification: correct type detection (user, assistant, system, tool_use, tool_result)
- Fixture coverage: does the test suite cover happy path, empty, malformed, and edge cases?
- Provider interface compliance: does it implement all required methods from the base interface?

**General Engineering Checks (20%):**
- Data integrity: silent data corruption from wrong type coercion
- Error propagation: does a parse failure surface clearly or get swallowed?
- Performance: parsing large files (>10MB) without loading entire file into memory
- Type safety at parsed data boundaries

**Prompt Template:**

```
You are a Parser/Provider Specialist reviewer for PR #[NUMBER]. This is review ROUND [N].

Your PRIMARY expertise is parsing external data formats, provider implementations,
and data integrity in a multi-source CLI tool (JSONL, SQLite, JSON formats).
You ALSO maintain general engineering awareness.

Fetch the PR diff: gh pr diff [NUMBER]

DOMAIN-SPECIFIC CHECKS (80% of your focus):
- Format robustness: missing fields, unexpected types, extra fields
- Null/undefined safety: every parsed field needs fallback or explicit null check
- Version evolution: external formats change without warning — defensive parsing
- Encoding: UTF-8 BOM, mixed line endings, binary content in text fields
- Session ID extraction: filename parsing, UUID format validation
- Message classification: correct type detection (user, assistant, system, tool_use, tool_result)
- Fixture coverage: happy path, empty, malformed, and edge case test files
- Provider interface: implements all required methods, matches base interface contract

GENERAL ENGINEERING CHECKS (20% of your focus):
- Silent data corruption from type coercion
- Error propagation: clear surface vs swallowed failures
- Performance with large files
- Type safety at parsed data boundaries

[RUNTIME VERIFICATION RULE — see shared instruction above]

[FOR ROUND 2+: Focus on verifying fixes for: [LIST PRIOR FIX NOW ITEMS]]

Output:
## Parser/Provider Specialist Review: [PR Title] — Round [N]
### Parse Robustness
### Test Coverage
### Issues Found (FIX NOW, VERIFY AT RUNTIME, SUGGESTION, NOTE)
### Verdict

DO NOT look at any other review comments. Your review must be independent.
```

---

## Adding a New Specialist

When a new domain emerges (e.g., a WebSocket layer, a plugin system):

1. Add an entry to this registry with: file pattern triggers, domain checks, general checks, prompt template
2. Update the domain classification in `start-review.md` Step 2
3. The specialist should follow the 80/20 split: deep domain + general baseline
4. Include the shared Runtime Verification Rule verbatim
5. Test by running a review on an existing PR that touches the new domain

---

## Priority Markers

All specialists use the same priority system:

| Marker | Meaning | Review Loop Impact |
|--------|---------|-------------------|
| FIX NOW | Blocking — must fix before merge | Triggers Round N+1 |
| VERIFY AT RUNTIME | Runtime behavior unclear from code reading | Cannot be dismissed by TA synthesis — must be verified |
| SUGGESTION | Recommended but non-blocking | Dev's discretion |
| NOTE | Informational | No action required |
