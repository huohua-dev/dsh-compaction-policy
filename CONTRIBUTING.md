# Development and verification

Use Node.js 22.19+ or 24+. The normal test suite has no external dependencies and needs no install:

```sh
npm test
npm run check
npm run pack:check
```

## Test against a real DSH host

Set `DSH_HOST_ROOT` to the directory containing the **installed host's** package manifest and `node_modules`. Do not point it at a profile that contains only plugin dependencies. Only DSH **0.2.0-rc.2** is currently supported.

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

## Current acceptance record

2026-10-03, DSH 0.2.0-rc.2, Electron Node 24.18.1 and standalone Node 24.21.0:

- 54 dependency-free tests passed, including 150 generated tool-trace cases.
- 12 real-host component integration tests passed, including 12 post-stream cancellation timings.
- Core tests cover actual checkpoint framing, source provenance, strict shrink rejection, max-token finish, ABORTED finish, manual flush/correlation, overflow generation gating and retry bounds, parallel tools and an unfinished newest step, realm-facing service identity, and opt-in preset registration/disposal.
- No actual GUI plugin installation, real-model long-run acceptance, latency benchmark or summary-quality evaluation yet.

## Architecture

- `src/policy.js`: strict configuration and pure budget arithmetic.
- `src/selection.js`: useful, balanced prefix selection and actual replay-input fingerprints.
- `src/guard.js`: one bounded failure record per live session; exponential cooldown.
- `src/engine.js`: thin Basic subclass; official region/manual/overflow transactions are reused.
- `src/index.js`: host imports, exact compatibility gate and schema.
- `src/preset-definition.js`: pure transformation of the host's shipped standard.
- `src/preset.js`: read the exported host YAML with its own expression schema and register a new preset.

Do not patch request headers, capacities, token prices or global fetch to change the pressure formula. Do not add another summarizer or provider to this project. Preserve tool pairs and the newest unit. Do not place transcript text in diagnostics. Treat pressure and confirmed overflow as different policies.

## rc.2 cancellation seam

Upstream automatic region compaction does not repeat its signal check after its final async summary boundary. A summarizer-only signal check still leaves a microtask race before commit. The subclass scopes a signal to `compactRegion` and checks it through the region's existing **synchronous pre-commit measurement**. It forwards the original meter values unchanged. Manual compaction already has its own final check. Tests sweep multiple microtask timings to prevent regressing this detail.

This depends on rc.2 transaction ordering. Re-read and re-test the upstream implementation when updating peers; do not call these internal details a stable API.

## Release

1. Run all three normal checks and the explicit real-host suite.
2. Review `git diff`, package inventory, dependency pins, docs and security boundaries.
3. Commit only project sources/tests/docs, never `.cache`, personal profiles, logs or credentials.
4. Push the reviewed commit and matching version tag to GitHub.
5. npm publication, deployment to a user's profile and live inference testing are **separate explicit actions**, not release hooks.

No install/prepare scripts or automatic deployment scripts are included. Keep the package usable directly from a tagged GitHub source checkout.
