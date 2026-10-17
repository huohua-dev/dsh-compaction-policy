# Changelog

## 0.2.2 — 2026-10-17

Fix the recurring "incompatible after every DSH upgrade" failure for good. DSH 0.2.1-rc.2 changed no compaction code—its published `dsh-compaction*` tarballs differ from rc.1 only in `package.json` version strings, and all five Basic method fingerprints still match—yet the host rejected the plugin before importing it. Three stacked exact-version gates were the whole problem; all three are gone.

- **Manifest layer:** declare `engines.dsh: ^0.2.1-rc.1`. The host evaluates `engines.dsh` alone (prereleases included) when it exists, so the whole 0.2.x host line is admitted instead of one exact build. The `dsh-*` peers use the same range and Cordis uses `~4.0.4`; `scripts/check.mjs` now rejects an exact host build instead of demanding one.
- **Runtime layer:** `src/host-version.js` is the single source for range admission (dependency-free semver compare). Version numbers now only select the host generation; they no longer have to be re-pinned per rc.
- **Activation layer (unchanged strictness):** the five Basic method fingerprints remain the real contract, renamed to the version-neutral `VERIFIED_BASIC_METHOD_HASHES` because the identical implementation spans 0.2.0-rc.2 → 0.2.1-rc.2.
- **Fail-safe instead of fail-stop:** the default global entry no longer imports the root backend (shared schema moved to `src/policy-fields.js`), and converts any `UnsupportedHostError`—range, fingerprint, descriptor or foreign wrapper—into an inert disable: stock Basic stays untouched, a warning is logged, and `/compaction-policy-global status` reports `enabled: false` / `unsupported-host`. A future host that really moves a seam degrades to stock compaction instead of breaking startup. The opt-in root backend still throws loudly.
- Add `npm run compat:host`: a one-command post-upgrade report (admitted versions, seam shape, all five fingerprints) so the next bump can be classified—label-only vs. real seam change—before touching code.
- Verified on the installed DSH 0.2.1-rc.2 host: compat probe passes, real-host suite 34/34 (including a new fingerprint-drift-stays-inert regression), dependency-free tests 63/63.
- No policy behavioral change on a verified host: threshold arithmetic, selection, retry guard, dry run and status reporting are untouched.

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
