# Development and verification

Use Node.js 22.19+ or 24+. The normal test suite has no external dependencies and needs no install:

```sh
npm test
npm run check
npm run pack:check
```

## Test against a real DSH host

Set `DSH_HOST_ROOT` to the directory containing the **installed host's** package manifest and `node_modules`. Do not point it at a profile that contains only plugin dependencies. The admitted host range is DSH **`^0.2.1-rc.1`** (the 0.2.x line) with Cordis **4.0.x**; feature activation additionally requires the five verified Basic fingerprints.

For an ordinary filesystem installation:

```sh
DSH_HOST_ROOT=/absolute/path/to/installed/dsh node scripts/test-host.mjs
```

For the macOS desktop ASAR installation, ordinary Node cannot read the archive. Use Electron's **Node mode**, never the app launcher or its main module:

```sh
DSH_HOST_ROOT='/Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh' \
ELECTRON_RUN_AS_NODE=1 \
'/Applications/DeepSeek Harness.app/Contents/MacOS/DeepSeek Harness' \
  scripts/test-host.mjs
```

The test-only resolver maps bare host imports to that explicit installation. Production code relies on the real DSH plugin loader and never uses this resolver. The tests instantiate core services and synthetic Session objects in memory, use a scripted LLM, and stub persistence/registry storage. They do **not** boot a full app, start a server, inspect saved conversations or credentials, or call any remote model. This is core-contract verification, not a live GUI or inference acceptance test.

If a host is missing, the command fails with guidance; it does not download one or silently skip the suite. CI runs the dependency-free tests and package checks. Host integration must also pass locally before a supported-version change or release.

## After a DSH upgrade: triage before touching code

Do not start by editing a version number. First ask whether the upgrade changed anything this plugin actually depends on:

```sh
DSH_HOST_ROOT='/Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh' \
ELECTRON_RUN_AS_NODE=1 \
'/Applications/DeepSeek Harness.app/Contents/MacOS/DeepSeek Harness' \
  scripts/check-host.mjs
# equivalently: npm run compat:host (same Electron/env requirements for ASAR)
```

- **All checks pass** → the bump changed only version labels (diff the published `@deepseek-ai/dsh-compaction*` tarballs to confirm). No source change is needed; run the full `test:host` suite and record the acceptance below.
- **A fingerprint fails** → an upstream seam really moved. The shipped plugin will stay loaded but inert on that host, so there is no fire to put out. Re-read the changed upstream implementation and re-run the behavioral suite *before* refreshing any fingerprint; never re-record a hash just to make the gate green.
- **A version falls outside the range** → that is a new host generation. Review it as such; widening `DSH_RANGE` in [host-version.js](<src/host-version.js>) and the matching `package.json` fields is the last step, after the fingerprints and suite pass.

`package.json` declares `engines.dsh` because the host evaluates that field alone (with prereleases included) before importing plugin code; exact peer pins were the original cause of upgrade-time incompatibility errors. Keep `engines.dsh`, the three `dsh-*` peers and `DSH_RANGE` identical—`npm run check` enforces it.

## Current acceptance record

2026-10-17, DSH 0.2.1-rc.2 (Cordis 4.0.5, schemastery 3.18.5), Electron Node mode against the installed ASAR host:

- The published `dsh-compaction-basic`, `dsh-compaction` and `dsh-agent-preset-registry` tarballs differ between 0.2.1-rc.1 and 0.2.1-rc.2 **only in `package.json` version strings**; every shipped code file is byte-identical, and the installed host's `lib/index.js` hashes match the rc.2 tarballs.
- `npm run compat:host` passes: admitted ranges, seam shape and all five Basic fingerprints match. No fingerprint changed.
- Real-host suite: 34/34 pass, including the new regression that fingerprint drift leaves the plugin loaded but inert. Dependency-free tests: 63/63 pass.
- This was the second consecutive pure version-label bump (0.2.0-rc.2 → 0.2.1-rc.1 → 0.2.1-rc.2) rejected only by exact version gates, which is why admission is now range-based and activation is fingerprint-based.

2026-10-17, DSH 0.2.1-rc.1 (Cordis 4.0.5), standalone Node 24.21.0:

- `dsh-compaction-basic@0.2.1-rc.1` ships a byte-identical `lib/index.js` to `0.2.0-rc.2`; `cordis@4.0.5` ships a byte-identical `lib/index.js` to `4.0.4`. Both were diffed against the installed host and the published npm tarballs.
- All five pinned Basic method fingerprints re-verified against the installed host build: all match. `src/global-adapter.js` fingerprints are unchanged.
- Dependency-free tests (58) and package checks pass unchanged.

2026-10-03, DSH 0.2.0-rc.2, Electron Node 24.18.1 and standalone Node 24.21.0:

- Dependency-free tests cover budgets, generated tool traces, retry guards and single-component packaging.
- Real-host component tests cover checkpoint framing, source provenance, strict shrink rejection, max-token/ABORTED finish, manual/overflow recovery, 12 late-cancellation timings, actual Cordis global-plugin lifecycle, independent roots, method conflicts and draining disposal.
- Bundle tests require exactly one exported default global entrypoint and reject removed preset/compatibility code and dependencies. See test output for current counts.
- A Desktop user confirmed v0.2.0 started after a full application restart. This does not establish live-model summary quality, long-run acceptance or GUI rendering of a real compaction.

## Architecture

- [policy.js](<src/policy.js>): strict configuration and pure budget arithmetic.
- [selection.js](<src/selection.js>): useful, balanced prefix selection and actual replay-input fingerprints.
- [guard.js](<src/guard.js>): one bounded failure record per live session; exponential cooldown.
- [engine.js](<src/engine.js>): thin Basic subclass; official region/manual/overflow transactions are reused.
- [host-version.js](<src/host-version.js>): the single source for host admission ranges (`^0.2.1-rc.1`, Cordis 4.0.x) shared by the manifest check, root gate and global gate.
- [policy-fields.js](<src/policy-fields.js>): config schema fields shared without making the global entry import the root backend.
- [index.js](<src/index.js>): opt-in root backend; range + fingerprint gate fails loudly because selecting it is explicit.
- [global-adapter.js](<src/global-adapter.js>) / [global.js](<src/global.js>): fingerprint-verified original-method bridge, per-runtime ownership and the sole default plugin lifecycle. The global entry converts `UnsupportedHostError` into an inert disable so host drift degrades to stock compaction instead of a startup failure.

Global integration uses a fingerprint-verified method adapter, not a public stable replacement API. Do not broaden host ranges or refresh method fingerprints without reading and exercising the corresponding implementations, and never reintroduce an exact host build in `engines.dsh`, the peers or a runtime gate. Never overwrite an unrelated method wrapper on disposal. Keep logs, debugging snapshots and intermediate design documents out of commits; use ignored `.cache/` for local experiments.

Do not patch request headers, capacities, token prices or global fetch to change the pressure formula. Do not add another summarizer or provider to this project. Preserve tool pairs and the newest unit. Do not place transcript text in diagnostics. Treat pressure and confirmed overflow as different policies.

## Cancellation seam

Upstream automatic region compaction does not repeat its signal check after its final async summary boundary. A summarizer-only signal check still leaves a microtask race before commit. The subclass scopes a signal to `compactRegion` and checks it through the region's existing **synchronous pre-commit measurement**. It forwards the original meter values unchanged. Manual compaction already has its own final check. Tests sweep multiple microtask timings to prevent regressing this detail.

This depends on the verified upstream transaction ordering (unchanged since 0.2.0-rc.2). Re-read and re-test the upstream implementation when a fingerprint changes; do not call these internal details a stable API.

## Release

1. Run all three normal checks, `npm run compat:host` and the explicit real-host suite.
2. Review `git diff`, package inventory, host ranges, docs and security boundaries.
3. Commit only project sources/tests/docs, never `.cache`, personal profiles, logs or credentials.
4. Push the reviewed commit and matching version tag to GitHub.
5. npm publication, deployment to a user's profile and live inference testing are **separate explicit actions**, not release hooks.

No install/prepare scripts or automatic deployment scripts are included. Keep the package usable directly from a tagged GitHub source checkout.
