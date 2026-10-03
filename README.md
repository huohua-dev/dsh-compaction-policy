# dsh-compaction-policy

[中文](<README.zh-CN.md>) · [Development & host tests](<CONTRIBUTING.md>) · [Security](<SECURITY.md>)

**An experimental global compaction policy for DeepSeek Harness.** Keep the official Basic summarizer, checkpoint records, tool pairing, token meter, UI event protocol, native `/compact`, and overflow recovery. Change proactive budgeting, range selection, and no-progress retries—without selecting a special preset.

**Experimental v0.2.0.** Compatibility is pinned to DSH Basic/compaction **`0.2.0-rc.2`** and Cordis **`4.0.4`**, including hash checks of five Basic methods. Actual-host tests with synthetic sessions and scripted model responses have passed. **This is not proof of live GUI behavior or summary quality on a native Windows/real-model session.** No lossless-summary or larger-context-window claim is made.

## What installation changes

The default bundle installs two **root plugins**:

```yaml
- id: compaction-policy-global
  name: dsh-compaction-policy/global
  config: {}
- id: compaction-policy-legacy
  name: dsh-compaction-policy/legacy
  config: {}
```

- **Global policy:** covers eligible existing and future official Basic instances in the **same Cordis runtime**, including ordinary presets. It adds no compaction engine or automatic compaction listener and does not switch presets.
- **Legacy compatibility:** keeps the historical `compaction-policy` preset identity resolvable for v0.1 sessions, with stock Basic. Normally it is hidden from the selection list; the new default bundle adds **no visible selectable special preset**.
- Your **current default provider and preset stay unchanged**. Main-request output limits, reasoning effort, provider/model selection, and token accounting are not rewritten.

Only the exact pinned official Basic implementation is targeted. Custom backends, subclasses, and instances with method overrides are skipped. Presets with no compaction, including minimal compositions without it, are unaffected. “Global” does not mean every DSH process or profile on the machine.

## Default policy: 90%, with no double deduction

Stock Basic can trigger early when a model permits a large output:

```text
stock threshold = floor(min(W × 0.8, W − requestMaxTokens − 65536))

reservedOutput  = min(requestMaxTokens, outputReserveCap)
policy threshold = floor(min(W × thresholdRatio,
                             W − reservedOutput − headroomTokens))
retentionTarget = floor((W − reservedOutput) × retainRatio)
```

Defaults are **`thresholdRatio: 0.9`, `outputReserveCap: 0`, `headroomTokens: 0`**, so the proactive threshold is exactly **`floor(W × 0.9)`**. The remaining 10% is the margin; it is **not deducted a second time**. For a 262,144-token window with a 131,072-token output cap, the threshold changes from 65,536 to **235,929 tokens**. This is arithmetic, not a performance benchmark.

**`pruneToolResults: false` applies only to the new proactive-pressure path.** That path does not pre-prune tool results; old content is summarized through Basic. It does not disable the native pruner service or change stock-mode, manual, or confirmed-overflow behavior.

> **An output cap is not guaranteed available space.** A 90%-full prompt and a full 128K completion cannot coexist in a 256K window. The adapter/server must enforce remaining capacity; providers that validate `input + max_tokens` may reject earlier. Native overflow recovery still applies. This plugin is not an HTTP output-budget clamp.

### Selection and failure guard

- Retain recent history with a **soft target of 16%**. Whole messages and tool-call/result units stay atomic; the newest unit remains verbatim even when larger than the target.
- Allow an older large message into the summary rather than repeatedly summarizing only a tiny preceding checkpoint. System nodes are protected; a later system node is a selection barrier.
- Require at least **2,048 non-checkpoint tokens** in the selected range before proactive summarization.
- Make at most **one summary transaction per pressure step**; do not immediately summarize the fresh checkpoint again.
- Back off failures for **60s, 120s, 240s… up to 10 minutes**. Expiry allows one probe on the next pressure check, not a background model call. Material candidate changes may permit earlier retry; unrelated tail appends do not.
- Preserve native manual and confirmed-overflow paths, retry limits, transaction completion, and durable-progress checks. They bypass the proactive guard.

## Install

Distribution is via GitHub, not npm. Install the **v0.2.0 release tag**:

```text
github:huohua-dev/dsh-compaction-policy#v0.2.0
```

### Desktop-managed profile

**Use the Desktop plugin-manager UI** to add the GitHub source, then reload/restart the existing Desktop host as requested. Desktop-managed plugin changes via CLI are rejected; do not use a `--profile desktop` CLI workaround.

After loading, use your existing normal preset. No special preset selection is required. Run `/compaction-policy-global status` in the session to inspect coverage and the effective policy. Installation does not choose a new default provider or preset.

### Non-Electron-managed web profile only

For a web profile **not managed by Electron/Desktop**:

```sh
dsh plugin --profile web add github:huohua-dev/dsh-compaction-policy#v0.2.0
```

Reload/restart that existing host. This CLI example is not an alternative installation path for Desktop.

## Configure the global entry

Apply a user profile override to **`compaction-policy-global`**, with policy fields under **`config.policy`**. Row configuration is replaced as a whole, not deep-merged; restate any custom values you need to retain. Reload the profile after changing it.

For example, use stock behavior except on one exact route:

```yaml
- id: compaction-policy-global
  config:
    policy:
      mode: stock
      modelPolicies:
        - provider: your-local-provider
          model: your-model-id
          mode: policy
          thresholdRatio: 0.9
          outputReserveCap: 0
          headroomTokens: 0
          pruneToolResults: false
```

Provider/model matching is exact and case-sensitive. Without this opt-in route example, the default policy applies to all eligible Basic instances.

| Policy field | Default | Meaning |
|---|---:|---|
| `mode` | `policy` | `policy` uses the new proactive strategy; `stock` delegates to Basic. |
| `thresholdRatio` | `0.9` | Proactive window fraction, subject to the remaining-capacity branch. |
| `outputReserveCap` | `0` | Proactive output reservation cap, **not** the API output cap. |
| `headroomTokens` | `0` | Extra proactive deduction; the default 10% margin is already in the ratio. |
| `pruneToolResults` | `false` | Whether the new proactive path invokes the native tool-result pruner first. |
| `retainRatio` | `0.16` | Soft recent-tail fraction of `W − reservedOutput`. |
| `retainTokens` | unset | Absolute soft target instead of `retainRatio`; mutually exclusive. |
| `minFreshTokens` | `2048` | Minimum selected non-checkpoint token weight. |
| `retryAfterTokens` | `4096` | Candidate change needed for a retry before cooldown expiry. |
| `retryCooldownMs` | `60000` | Initial failed-summary cooldown. |
| `maxRetryCooldownMs` | `600000` | Maximum exponential cooldown; at least the initial value. |
| `modelPolicies` | `[]` | Exact `{ provider, model, ...policyFields }` overrides. |
| `dryRun` | `false` | Observe the new proactive path without pruning/summarizing; stock, manual and overflow paths still operate. |

Policy fields except `modelPolicies` and `dryRun` can be overridden per route. Unknown keys and invalid values are rejected. Invalid pressure budgets produce diagnostics, not an invented larger window.

### Main output and summary configuration remain separate

The global entry has **no `basic` field**, including under `config.policy`. Each engine keeps its **original Basic configuration**: summary provider/model, summary output budget, reasoning behavior, automatic enablement, and stock/manual/overflow settings. Configure those at the engine's existing Basic row, not in the global plugin.

Where upstream defaults are used, the **65,536-token summary cap stays intact**. Policy headroom `0` does not set the summary cap to zero. The main request's output cap and thinking settings also remain unchanged. Basic's `auto: false` retains its native semantics: automatic pressure and overflow listeners are off, while manual `/compact` remains available.

## Status and recovery

```text
/compaction-policy-global [status|reset]
/compact
```

`status` reports coverage and proactive diagnostics without transcript content. `reset` clears the current session's proactive retry guard; it does not compact, rewrite history, or change the model. Native `/compact` remains the manual compaction command. A reduction that remains over threshold is reported as `compacted-still-above-threshold`, not as “back under budget”. Failure state is in memory per live session, not persisted across restarts.

On disposal, the global policy becomes **inactive first**, then drains in-flight work before safe restoration. Foreign wrappers are not overwritten: if another plugin has wrapped a patched method, this plugin's wrapper stays **inert until safe restoration or restart**. Disabling does not forcibly rebind running agents.

## Upgrade from v0.1 and legacy sessions

1. Remove the obsolete **user-authored override with id `compaction-policy-preset`**; review custom routes and compositions that still reference the old entry. Package installation does **not** silently edit your profile.
2. Load the new default bundle through the appropriate plugin manager. Choose an **existing normal preset** for new chats; if you previously made the legacy preset your default, change that default explicitly.
3. Keep `compaction-policy-legacy` enabled while you need to resume old v0.1 logs.

The compatibility plugin registers the **exact historical `compaction-policy` id**, built from the host's shipped standard preset with **stock Basic**, not the advanced policy backend. A pinned, scoped, reversible selection-list filter hides this compatibility row without deleting the registered preset. If the selected default is the legacy id, or the legacy declaration itself is broken, that row stays visible—**the current default and activation diagnostics are not silently hidden**. An old session header may still display its historical `compaction-policy` id; that is not a new picker option.

Session identities, logs, and children are preserved; nothing is rewritten or automatically migrated. Already-live v0.1 policy instances get the legacy stock-Basic composition only on **natural restoration or restart**, not by rebinding running agents.

The old independent **`dsh-compaction-policy/preset` export and root `dsh-compaction-policy` backend remain advanced legacy options**, not default installation instructions. Owned custom compositions must still use only one backend inside their isolated compaction group. The global plugin is not a replacement backend. Headless use of the **global** entry requires the host's **`commands` and `agentPresets` services**; a rosterless composition without them cannot load it unchanged.

## Disable or uninstall

- To stop the new global policy while retaining old-session compatibility, **disable only `compaction-policy-global`**, leaving `compaction-policy-legacy` enabled; alternatively set `config.policy.mode: stock` and remove any route overrides that still enable policy mode.
- For full removal, finish/stop affected work, choose an existing normal preset for new chats, and explicitly fix any default still pointing to the legacy id. Remove your own plugin overrides and custom-preset references.
- **Desktop:** remove the bundle through the Desktop plugin-manager UI, then reload/restart the existing host.
- **Non-Electron-managed web only:** `dsh plugin --profile web remove dsh-compaction-policy`, then reload/restart that host.

Committed native checkpoints remain readable without the package. **Old v0.1 logs still require the legacy compatibility plugin to resume** under their original preset identity. There is no automatic log migration, identity rewrite, or restoration of all pre-compaction history into active context.

## Limits and verification

Summary quality and provider capacity remain model/upstream concerns. Meter values are host estimates; the plugin does not falsify token counts, lower main-request reasoning, add a compression service, wrap global `fetch`, patch ASAR, or ship another DSH kernel. Host plugins run with host privileges; model tool approvals do **not** sandbox them.

Version and five-method hash pins are deliberate safety gates, not a promise of forward compatibility. Host upgrades require review and testing, not merely widening a version range. Actual-host synthetic tests do not establish live UI or native Windows summary quality.

```sh
npm test
npm run check
npm run pack:check
```

See [development and host-test instructions](<CONTRIBUTING.md>) for the synthetic real-host suite. These checks do not constitute a live-model acceptance test.

## License and inspiration

MIT © 2026 huohua-dev. See [NOTICE](<NOTICE.md>) for upstream contracts and related work. No third-party plugin implementation or DSH kernel is vendored.
