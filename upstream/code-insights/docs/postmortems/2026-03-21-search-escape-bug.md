# Postmortem: Search ESCAPE Clause Bug (PR #216)

**Date discovered:** 2026-03-21
**Date introduced:** 2026-03-20 (PR #216, commit `b7db7d5`)
**Severity:** P0 — Cmd+K search completely broken (500 on every query)
**Time to detect:** ~1 day (discovered by founder during manual use)

---

## Summary

The Cmd+K global search feature shipped with a bug that caused every search query to return a 500 Internal Server Error. The root cause was a JavaScript template literal escaping issue in SQLite `ESCAPE` clauses — `ESCAPE '\'` inside a template literal produces `ESCAPE ''` (empty string), which SQLite rejects with "ESCAPE expression must be a single character."

The bug was **introduced by the fix for a review finding**. The original code had no `ESCAPE` clause and worked (though it didn't escape LIKE wildcards). The TA review correctly identified the missing wildcard escaping and prescribed the fix. The dev implemented it with `ESCAPE '\'` in template literals. The TA's Round 2 verification approved it by reading the code, noting the escape syntax difference but incorrectly concluding "both are correct."

---

## Timeline

1. **Dev implements search** — `GET /api/search` with `%${searchTerm}%` LIKE queries. No `ESCAPE` clause. Works correctly.
2. **TA Round 1 review** — Correctly identifies that `%` and `_` in user input are LIKE wildcards. Prescribes `escapeLike()` + `ESCAPE '\\'` fix. The suggested code uses double-backslash in a regular string context.
3. **Dev implements fix** (commit `b7db7d5`) — Adds `escapeLike()` (correct) and `ESCAPE '\'` in template literals (broken). The backslash in `\'` is consumed by the JS template literal engine, producing `ESCAPE ''`.
4. **TA Round 2 verification** — Reads the diff, notes "the escape syntax differs between files (single `\` in template literals vs `\\` in double-quoted strings) — both are correct and produce identical SQL." **This statement is wrong.** No runtime verification performed.
5. **PR merged** — All reviewers pass. Build passes. Tests pass (no test covers search).
6. **Bug discovered** (~1 day later) — Founder searches for "policy enforcement" in Cmd+K, gets "No results." Server logs show 500 error on every `/api/search` call.

---

## Root Causes

### 1. No runtime verification after Round 1 fixes

The PR body included functional verification evidence:
```
GET /api/search?q=test&limit=5    → sessions: 5, insights: 5
```
But this was run **before** the `ESCAPE` clause was added. After the fix commit, nobody re-ran the search endpoint. Round 2 was a code-read review only.

**Gap:** The review process has no explicit step requiring re-verification of functional behavior after fix commits.

### 2. Incorrect reasoning about JS template literal escaping

The TA wrote: *"The escape syntax differs between files (single `\` in template literals vs `\\` in double-quoted strings) — both are correct and produce identical SQL sent to SQLite."*

This is factually wrong. In JavaScript template literals:
- `\'` is an escape sequence that produces `'` (backslash consumed)
- `\\` produces `\` (literal backslash)
- Therefore `ESCAPE '\'` → `ESCAPE ''` (empty string)
- But `ESCAPE '\\'` → `ESCAPE '\'` (single backslash character) — correct

This is a subtle runtime behavior that static code reading gets wrong. The TA recognized the difference but drew the wrong conclusion.

**Gap:** No tooling to catch SQL-in-template-literal escaping issues. Static review is unreliable for this class of bug.

### 3. No test coverage for search route

The TA noted: *"This is a SKIP domain (server route wiring), but the `buildSnippet()` utility function inside it is a pure function that WOULD benefit from tests. Marking N/A per QA policy."*

The search route was explicitly excluded from test requirements under the "server route wiring" exemption. However, this route contains non-trivial SQL with `ESCAPE` clauses, `CASE` expressions, and multi-table joins — exactly the kind of logic that benefits from a smoke test.

**Gap:** QA policy exempts all server routes from testing, even those with complex SQL logic.

---

## Fix

**Commit:** Change `ESCAPE '\'` to `ESCAPE '\\'` in all template literal SQL queries in `server/src/routes/search.ts` (8 occurrences for sessions query, 3 for insights query).

In the template literal, `'\\'` produces a string containing a single backslash `\`, which is the correct SQLite ESCAPE character.

---

## Proposed Process Improvements

### 1. Post-fix functional re-verification (review process)

After Round 1 fixes are applied, the dev or TA must re-run the same functional verification from the PR body. Add as a required step in the review addressal template:

> **Post-fix verification:** Re-run all functional verification commands from the PR body after fix commits. Paste updated output.

### 2. Server route smoke tests for non-trivial SQL (QA policy)

Revise the "server route wiring" exemption. Routes with non-trivial SQL (LIKE, ESCAPE, JOINs, CASE, subqueries, CTEs) should have at least a smoke test that runs the prepared statement against an in-memory SQLite database. This would have caught the `ESCAPE ''` error immediately at test time.

**Proposed threshold:** If a route's SQL query uses any of `ESCAPE`, `CASE`, `JOIN` (beyond simple FK), `GROUP BY` with `HAVING`, subqueries, or CTEs — it requires a smoke test.

### 3. Hookify rule for template literal SQL escaping (tooling)

A hookify rule that flags `ESCAPE '\'` (single backslash) inside template literals. The correct pattern is always `ESCAPE '\\'` (double backslash). This is a deterministic, zero-false-positive check.

### 4. Template literal SQL awareness in review checklist (review process)

Add to the TA review checklist: *"If SQL queries are inside template literals, verify all backslash escaping uses `\\` (double backslash). Single `\` in template literals is consumed by the JS engine."*

---

## Action Items

| # | Action | Status |
|---|--------|--------|
| 1 | Fix `ESCAPE` clauses in `search.ts` | Done |
| 2 | Release patch version | Pending |
| 3 | Add post-fix verification to review template | Done (PR #227) |
| 4 | Revise QA policy for server routes with complex SQL | Done (PR #227) |
| 5 | ~~Create hookify rule for template literal ESCAPE detection~~ | Superseded — replaced by dynamic domain specialists with Runtime Verification Rule (PR #227) |
| 6 | ~~Add template literal SQL check to TA review checklist~~ | Superseded — SQL/Database Specialist covers this domain (PR #227) |
| 7 | Replace static Outsider/Wild Card with dynamic domain specialists | Done (PR #227) |
| 8 | Add Runtime Verification Rule to all specialist prompts | Done (PR #227) |
| 9 | Update TA synthesis to enforce VERIFY AT RUNTIME items | Done (PR #227) |

Items 5-6 were superseded by a systemic approach: dynamic domain specialists with a shared Runtime Verification Rule that catches the general class of "static reasoning about runtime behavior" bugs, rather than specific pattern checks.
