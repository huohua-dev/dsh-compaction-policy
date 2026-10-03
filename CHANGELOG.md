# Changelog

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
