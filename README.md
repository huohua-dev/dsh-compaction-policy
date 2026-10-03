# dsh-compaction-policy

[中文](<README.zh-CN.md>) · [Development & host tests](<CONTRIBUTING.md>) · [Security](<SECURITY.md>)

**An experimental global compaction policy for DeepSeek Harness.** Keep the official Basic summarizer, checkpoint records, tool pairing, token meter, UI event protocol, native `/compact`, and overflow recovery. Change proactive budgeting, range selection, and no-progress retries—without selecting a special preset.

**Experimental v0.2.1.** Compatibility is pinned to DSH Basic/compaction **`0.2.0-rc.2`** and Cordis **`4.0.4`**, including hash checks of five Basic methods. Actual-host tests with synthetic sessions and scripted model responses have passed. **This is not proof of live GUI behavior or summary quality on a native Windows/real-model session.** No lossless-summary or larger-context-window claim is made.

## What installation changes

The default bundle installs exactly **one root plugin**:

```yaml
- id: compaction-policy-global
  name: dsh-compaction-policy/global
  config: {}
```

- **Global policy:** covers eligible existing and future official Basic instances in the **same Cordis runtime**, including ordinary presets. It uses Basic's native pressure mechanism, adds no compaction engine or automatic compaction listener, and does not switch presets.
- **No special preset:** the package registers no preset and does not filter the preset registry. Continue using your normal presets.
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

Distribution is via GitHub, not npm. Install the **v0.2.1 release tag**:

```text
github:huohua-dev/dsh-compaction-policy#v0.2.1
```

### Desktop-managed profile

**Use the Desktop plugin-manager UI** to add or update the GitHub source, then **fully quit and restart Desktop** so the existing host process is replaced. A page refresh or profile reload is not a substitute after an upgrade: an old-process import failure was observed and cleared by a full restart. Desktop-managed plugin changes via CLI are rejected; do not use a `--profile desktop` CLI workaround.

After loading, use your existing normal preset. No special preset selection is required. Run `/compaction-policy-global status` in the session to inspect coverage and the effective policy. Installation does not choose a new default provider or preset.

### Non-Electron-managed web profile only

For a web profile **not managed by Electron/Desktop**:

```sh
dsh plugin --profile web add github:huohua-dev/dsh-compaction-policy#v0.2.1
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

## Upgrade to v0.2.1

The old test preset `compaction-policy` is no longer registered. There is **no old-session restoration compatibility**; previous test sessions are not a supported upgrade target. The package does not delete or rewrite session logs.

1. Remove obsolete user profile overrides for **`compaction-policy-legacy` and `compaction-policy-preset`**, plus custom references to those removed entries. Package installation does not silently edit your profile.
2. If your default still points to the test preset, explicitly restore an **existing normal preset** as the default.
3. Update through the Desktop plugin-manager UI, then **fully quit and restart Desktop**. For a non-Electron-managed web profile, update through its plugin manager and restart that host. Check a new chat with a normal preset and `/compaction-policy-global status`.

### Custom compositions

The root **`dsh-compaction-policy` backend** and **`dsh-compaction-policy/global` entry** remain available; the `/preset` and `/legacy` exports are removed. The default bundle loads only the global entry. Custom compositions must use only one backend inside their isolated compaction group; the global plugin is not a replacement backend. Headless use of the global entry requires the host's **`commands` and `agentPresets` services**; a composition without them cannot load it unchanged.

## Disable or uninstall

- To stop the global policy, **disable `compaction-policy-global`**; alternatively set `config.policy.mode: stock` and remove any route overrides that still enable policy mode.
- For full removal, finish/stop affected work, remove your own plugin overrides and custom-composition references, and ensure the default is an existing normal preset.
- **Desktop:** remove the bundle through the Desktop plugin-manager UI, then fully quit and restart Desktop.
- **Non-Electron-managed web only:** `dsh plugin --profile web remove dsh-compaction-policy`, then restart that host.
- After removal, open a **new chat with a normal preset** and verify that it loads and uses the host's normal compaction behavior.

Uninstalling does not delete or rewrite session logs, migrate test-preset identities, or restore all pre-compaction history into active context.

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
