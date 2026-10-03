# dsh-compaction-policy

[中文](README.zh-CN.md) · [Development & host tests](CONTRIBUTING.md) · [Security](SECURITY.md)

**A thin, opt-in compaction policy for DeepSeek Harness.** Keep the official LLM summarizer, checkpoint transaction, tool pairing, token meter, `/compact`, and context-overflow recovery. Change only proactive budgeting, range selection, and retries that make no progress.

**Experimental v0.1.0. Supported host: DSH `0.2.0-rc.2` exactly.** Tested against real host libraries with synthetic in-memory sessions and a scripted LLM. **Not yet validated in a live GUI session or a long real-model run.** No plugin can promise lossless summaries or enlarge a model's context window.

## Why

In stock Basic, proactive pressure is capped by the entire request output budget plus extra headroom:

```text
stock threshold = floor(min(window × 0.8, window − requestMaxTokens − 65536))
```

For a 262,144-token window and a 131,072-token output cap, that is **65,536 tokens: 25% of the window**. A large early reasoning message can also leave only a tiny old checkpoint outside the retained tail. Summarizing that checkpoint repeatedly does not help.

This plugin separates an **output capability ceiling** from the **reservation used to decide when to compact**:

```text
reservedOutput = min(requestMaxTokens, outputReserveCap)
threshold      = floor(min(window × thresholdRatio,
                           window − reservedOutput − headroomTokens))
retentionTarget = floor((window − reservedOutput) × retainRatio)
```

With the defaults, that same route triggers at **222,822 tokens (85%)**, rather than 65,536. This is arithmetic, not a real-model benchmark. It **does not rewrite** the main request's `maxTokens`, reasoning effort, provider, model, or reported token counts.

> **A cap is not a promise.** A 222K prompt and a full 128K completion cannot fit together in 256K. The adapter/server must enforce the actual remaining capacity. A provider that rejects `input + max_tokens` before generation may overflow earlier; ordinary DSH overflow recovery still applies. This plugin is not an HTTP budget-clamping proxy.

## What it does

- Caps proactive output reservation without statically lowering the model's output ceiling.
- Keeps whole messages and tool-call/result units; never edits reasoning or truncates tool output itself.
- Treats retention as a **soft target**: an older large message can join the summary instead of protecting it forever behind a tiny checkpoint. The newest atomic unit always stays verbatim, even if it exceeds the target.
- Requires enough **non-checkpoint** content before spending a summary call.
- Makes at most **one summary transaction per pressure step**. It does not immediately summarize its own fresh checkpoint again.
- Backs off failed summaries for 60s, 120s, 240s… up to 10 minutes, with at most one probe when the next pressure check occurs after expiry. Material changes can permit an earlier retry; unrelated tail appends do not.
- Preserves the stock **manual and confirmed-overflow paths**, including the host's retry limit and durable-progress requirement.
- Adds `/compaction-policy [status|reset]`. Diagnostics contain budgets, counts and sequence numbers, not transcript content. No extra instructions are injected into model context.

It does **not** add a provider, lower thinking, call an external compression service, wrap global `fetch`, patch ASAR, or install another DSH kernel.

## Install and opt in

From the tagged GitHub release (this project is not currently published to npm):

```sh
dsh plugin --profile desktop add github:huohua-dev/dsh-compaction-policy#v0.1.0
```

Use the profile your DSH actually runs (`desktop` above, or `web`/another profile). Do not copy a `web` example into a desktop deployment blindly.

1. Reload/restart the **existing** DSH host after the initial bundle installation.
2. Open a **new** session.
3. Select **Compaction Policy (standard)** before its first message.
4. After a model step, run `/compaction-policy status` to inspect the effective decision and threshold.

**Installing adds a separate preset; it does not change your default, stock standard preset, providers, existing conversations, or history.** Installing the package does not switch an existing session to its engine. Existing sessions do not automatically migrate.

The preset is assembled in memory from the **installed host's shipped standard**. Only its compaction backend row changes; `/compact` and the tool-result pruner remain in the same isolated group. No stale copy of the entire roster is shipped. Custom edits you made to your own standard preset are **not** inherited; mount the backend in a custom preset for that case. Unsupported host versions or unexpected preset structure fail explicitly.

## Configure

Add an override for the plugin's preset row to your profile's `cordis.patch.yml`. DSH replaces a row's **whole config**, so restate the values you want to keep. Reload the profile and start a new test session; this release does not promise live mutation of already-running preset instances.

### Only enable the new policy on one exact route

```yaml
- id: compaction-policy-preset
  config:
    id: compaction-policy
    name: Compaction Policy (standard)
    policy:
      mode: stock
      modelPolicies:
        - provider: your-local-provider
          model: your-model-id
          mode: policy
          thresholdRatio: 0.85
          outputReserveCap: 20000
          headroomTokens: 13000
```

Other routes in this preset use stock Basic. The unmodified standard preset always uses stock Basic. Matching is exact and case-sensitive, not a substring or family match.

### Policy fields

| Field | Default | Meaning |
|---|---:|---|
| `mode` | `policy` | `policy` uses this strategy; `stock` delegates pressure to Basic. |
| `thresholdRatio` | `0.85` | Window fraction; the remaining-capacity branch can make it lower. |
| `outputReserveCap` | `20000` | Maximum **proactive reservation**, not the actual API output cap. |
| `headroomTokens` | `13000` | Extra proactive margin; independent of Basic's summary budget. |
| `retainRatio` | `0.16` | Soft recent-tail target as a fraction of `window − capped reservation`. |
| `retainTokens` | unset | Absolute soft tail target instead of `retainRatio`; the two are mutually exclusive. |
| `minFreshTokens` | `2048` | Minimum selected non-checkpoint token weight before proactive summarization. |
| `retryAfterTokens` | `4096` | Minimum changed candidate weight to retry before the cooldown expires. |
| `retryCooldownMs` | `60000` | Initial failed-summary cooldown. |
| `maxRetryCooldownMs` | `600000` | Maximum exponential cooldown; must be at least the initial value. |
| `modelPolicies` | `[]` | Exact `{ provider, model, ...policyFields }` overrides. |
| `dryRun` | `false` | Observe the **new proactive path** without pruning or summarizing. **Stock-mode, manual, and overflow paths still operate normally.** |
| `basic` | `{}` | Separate, unchanged official Basic configuration for summarization, manual/overflow, and stock-mode policy. |

All policy fields except `modelPolicies`, `basic` and `dryRun` can be overridden per route. Unknown keys and invalid values are rejected. Tiny windows may need smaller margins/retention; invalid pressure budgets produce a diagnostic, not an invented larger model window. Overflow recovery remains available.

### Three independent budgets

1. **Main output cap:** configured on your existing model, unchanged here.
2. **Proactive reservation:** `policy.outputReserveCap`, used only in the formula above.
3. **Summary output cap:** `policy.basic.maxTokens`, an official Basic setting.

The plugin leaves Basic defaults intact, including the **65,536-token summary cap**. Setting policy headroom to 13,000 does **not** silently lower the summary cap. To configure an auxiliary summarizer explicitly:

```yaml
    policy:
      basic:
        summarizationProvider: your-summary-provider
        summarizationModel: your-summary-model
        maxTokens: 16384
```

Both summarization fields must be set together. This is an explicit summary-budget choice, not a required recommendation. The plugin does not force summary reasoning off. Without an override, upstream routing/default reasoning behavior remains unchanged.

`basic.compactionRetries` still applies to delegated stock behavior; the new pressure path intentionally performs one transaction per step. `basic.maxOverflowRetries` remains authoritative for overflow. `basic.auto: false` disables **both** automatic pressure and overflow listeners, as in upstream; manual `/compact` remains available.

### Custom presets / headless compositions

Replace the compaction backend **inside the agent's isolated compaction group**, preserving its companion rows:

```yaml
- id: compaction
  name: cordis:group
  group: true
  isolate:
    compaction: true
    toolResultPruner: true
  config:
    - id: compaction-policy-engine
      name: dsh-compaction-policy
      config:
        thresholdRatio: 0.85
    - id: command-compact
      name: '@deepseek-ai/dsh-command-compact'
    - id: tool-result-pruner
      name: '@deepseek-ai/dsh-compaction-tool-result-pruner'
```

This is an **owned preset composition**, not a top-level patch that magically reaches into another preset. Same-realm compaction providers cannot coexist. In a rosterless/headless composition, mount the root backend directly and do not mount the `/preset` plugin (it needs the web preset registry).

## Status and recovery

```text
/compaction-policy status
/compaction-policy reset
/compact
```

Typical decisions: `below-threshold`, `pruning-sufficient`, `insufficient-fresh-history`, `retry-cooldown`, `compacted`, `compacted-still-above-threshold`, `invalid-pressure-budget`.

`reset` clears only this session's proactive retry guard; it does not compress or change model settings. Manual `/compact` is never held back by this guard. Summary failures still close the official transaction and are reported by DSH. A successful reduction that remains over threshold is **not** reported as “back under budget”.

## Uninstall / roll back

1. Finish or stop sessions using this preset. Choose **standard** for new sessions; if you manually made this preset the default, restore the standard default first.
2. Remove any **user-authored** row/custom preset referring to this package. The example override is yours and is not erased by package removal.
3. Remove the bundle and reload the existing host:

```sh
dsh plugin --profile desktop remove dsh-compaction-policy
```

The plugin writes no auxiliary store. Committed checkpoints are ordinary DSH events and remain readable without it. However, a saved session still names its original preset: after uninstall it may need the plugin reinstalled to resume, or an explicit handoff to a new standard session. Uninstallation does not silently rewrite session identities or restore pre-compaction history into active context.

## Limits and safety

- Summary quality and provider behavior remain upstream/model concerns. We do not guarantee a full 128K completion after a long prompt, or that summarizing a large span with a 65K summary cap fits every provider.
- Token counts are the host's meter estimates. We never alter them to claim a reduction.
- System nodes are protected. An unexpected later system node is a **barrier**; proactive selection will not cross it, even if useful older content sits beyond it.
- The recent-tail target can be exceeded by an indivisible newest unit or undershot to obtain a useful prefix. No partial message rewriting is introduced.
- Failure state is held per live Session in memory, not persisted across restarts. A cooldown expires only into a future pressure check, not a background timer or autonomous model request.
- Confirmed overflow and manual requests deliberately bypass proactive size/guard/dry-run checks. They can still fail; the original error is not hidden behind a fabricated success.
- A DSH host plugin runs with the host's privileges. Model tool approvals do **not** sandbox plugin code. Review the source before installing.
- rc.2 compatibility uses dynamically dispatched Basic methods and a cancellation check at its final synchronous measurement seam. Host upgrades require re-testing, not merely widening a peer range.

## Verification

```sh
npm test             # dependency-free policy, selection, retry, preset tests
npm run check        # syntax, inventory, host pins, opt-in bundle checks
npm run pack:check   # inspect publish contents; does not publish
```

The real-host suite additionally uses the installed Cordis, Session, TokenMeter and Basic transaction, checks the realm-facing service object, replays synthetic tool/summary events, and exercises cancellation at 12 post-stream microtask boundaries. See [CONTRIBUTING.md](CONTRIBUTING.md) for setup. It does not start DSH or send model requests.

## License and inspiration

MIT © 2026 huohua-dev. See [NOTICE.md](NOTICE.md) for upstream contracts and related community work. No third-party plugin implementation or DSH kernel is vendored.
