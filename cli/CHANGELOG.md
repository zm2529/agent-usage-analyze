# Changelog

## 0.1.4

- Added a natural-week Agent report with per-agent activity, Token usage, analysis coverage, and same-period week-over-week comparisons.
- Moved background history-import progress to the top of Overview and exposed task-analysis queue counts in the global status bar.
- Made stale npx runtime detection explicit in update settings and provided the exact command for switching to an update-capable global npm installation.
- Tightened Token-efficiency reporting with input-only cache-share semantics, explicit evidence layers, bounded attribution, and confidence labels.

## 0.1.3

- Made first-run onboarding follow the local product installation instead of stale browser state, with clearer Codex Hook setup guidance.
- Moved history synchronization and follow-up analysis fully into background workers so the WebUI remains usable during large imports.
- Added bounded SQLite lock coordination and deferred public-practice research while local ingestion or analysis is writing.
- Added npm release checks, manual updates, and opt-in automatic updates with safe source, npx, and global-install boundaries.
- Improved runtime, activity, ingestion, and analysis status messages for slow, queued, and recoverable work.

## 0.1.2

- Added the simplified Chinese product experience, first-run guidance, local background service, and complete uninstall flow.
- Consolidated automatic session analysis, cross-task reporting, improvement tracking, and public-practice research.
- Published the first Trusted Publishing release with deterministic package, provenance, and install smoke gates.

## 0.1.1

- Reworked the dashboard around analysis evidence, improvement tracking, and a searchable public-practice library.
- Added local LLM analysis traces, dynamic practice research, and automatic improvement observation.
- Improved settled-session scheduling, transient SQLite lock recovery, runtime status accuracy, and short-session analysis.
- Removed legacy advice surfaces and stale local compatibility paths.

## 0.1.0

- Established the independent Agent Usage Analyzer product from the frozen Code Insights MIT source.
- Added the canonical ingestion contract, observation eras, coverage diagnostics, local API, and dashboard health view.

The frozen upstream source and license are documented in the repository `UPSTREAM.md` and `LICENSE` files.
