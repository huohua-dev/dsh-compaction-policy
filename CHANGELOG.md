# Changelog

## 0.2.1 — 2026-10-03

- Keep exactly one default component: `dsh-compaction-policy/global`.
- Remove the legacy compatibility component, preset-list filtering, old preset registration code and `/legacy` / `/preset` exports, together with their dedicated dependencies and tests.
- Do not preserve restoration support for the earlier experimental `compaction-policy` preset identity. Existing logs are not deleted or rewritten; use an existing normal preset for new sessions.
- Retain the 90% summary-first policy, original native transactions, output/reasoning settings and reversible global integration unchanged.
- Add a single-component packaging regression check. Desktop upgrades require a full application restart to avoid stale module-export caches.

## 0.2.0 — 2026-10-03

- Make the default bundle load the exported global adapter; installation no longer requires selecting a separate preset.
- Trigger proactive compaction at 90% of the resolved context window by default, without double-subtracting the main output cap or lowering reasoning/output settings.
- Use native summary transactions rather than first pruning tool-result middles on the new proactive path; keep native manual and confirmed-overflow recovery.
- Pin host versions and captured-method fingerprints; preserve original engine/listener identity, isolate runtime roots, drain in-flight work and restore methods safely on disposal.
- Preserve the historical `compaction-policy` identity with a shipped-standard/official-Basic compatibility declaration hidden from normal selection. A legacy default or broken declaration stays visible for diagnosis. No session logs or identities are rewritten.
- Retain advanced v0.1 backend/preset exports, but remove their selectable preset from the default bundle. Existing live v0.1 generations require natural restoration or restart; obsolete profile overrides must be removed explicitly.
- Add release-assembly checks and actual registry/Loader tests for cold replay, mounted scopes, child identity, hidden rosters, default safety and restoration.

Experimental: real-host tests use synthetic sessions and a scripted LLM; they do not establish live GUI rendering or real-model summary quality. Desktop installations are managed through Desktop, not the standalone CLI.

## 0.1.0 — 2026-10-03

Initial experimental release, pinned to DSH 0.2.0-rc.2.

- Separate proactive output reservation from the actual main-request output cap.
- Use useful, whole-message prefix selection with a soft retained-tail target and a minimum non-checkpoint content weight.
- Limit the new pressure path to one summary transaction per step.
- Back off repeated failed candidates with bounded exponential cooldown and material-change detection.
- Preserve official summary budgets, routing, transactions, manual `/compact`, pruner integration and generation-gated overflow recovery.
- Add content-free status/reset diagnostics.
- Add a separate preset assembled from the host's shipped standard without changing the default.
- Protect the final automatic transaction boundary against cancellation; recognize the host's ABORTED error code.
- Include dependency-free tests, real-host in-memory contract tests and bilingual documentation.

Not yet validated by a real-model long-run or a live GUI plugin installation. No npm publication or automatic deployment is part of this release.
