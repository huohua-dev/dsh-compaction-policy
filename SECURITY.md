# Security and privacy

A DSH host plugin runs with the privileges of its host process. Model-facing tool approvals and workspace sandboxes do not sandbox plugin code. Review the source and pin a release before installing.

This package:

- reads the host's shipped standard preset through its exported package path;
- applies a version- and method-fingerprint-pinned, reversible pressure-method adapter to existing official Basic engines in its runtime;
- registers a hidden same-ID legacy compatibility composition and a global status/reset command;
- filters only the owning registry instance's selection roster; it does not translate or rewrite session identities;
- uses the existing LLM and session services for ordinary official compaction;
- keeps failure metadata and content hashes in session-keyed memory;
- does not read credentials itself, wrap HTTP, add telemetry, start subprocesses, download a model, or create an auxiliary transcript store;
- does not alter the default preset or any model's actual maximum output / reasoning settings.

Existing DSH summarization can send selected conversation history to the route configured by the user. “No new external service” does not mean “no network” when the chosen summarizer is remote. The normal host logging/persistence policies still apply.

Known constraints:

- The host's token meter is approximate; capped reservation cannot guarantee admission by every provider.
- The plugin's cooldown is proactive only. Manual and provider-confirmed overflow recovery can perform compaction during a proactive cooldown or dry run.
- The plugin is explicitly pinned to DSH 0.2.0-rc.2; an untested host is refused.
- The current test evidence covers core contracts with a scripted model, not live-model quality or a full GUI installation.

Do not include credentials, complete conversation logs or private source code in public bug reports. For a vulnerability, use GitHub private vulnerability reporting if available, otherwise ask the maintainer for a private channel before sharing exploit details. Do not open a public issue containing secrets.
