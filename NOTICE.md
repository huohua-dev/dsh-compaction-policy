# Sources and acknowledgements

This is an independent community plugin, not an official DeepSeek product.

The runtime uses the host-provided [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (MIT) compaction service, Basic backend, token meter and preset registry. The budgeting terminology, checkpoint contract and compatibility behavior follow those interfaces. No DSH kernel source or other plugin implementation is vendored in this package.

Related projects investigated during design:

- [Yunado/dsh-qwen38-local-qol](https://github.com/Yunado/dsh-qwen38-local-qol) (MIT): local-model pressure issues and a separate rc.2 compaction preset. This project does **not** adopt its main-output-cap slider coupling or custom model adapter.
- [BOWLUNA/dsh-zcode-breaker](https://github.com/BOWLUNA/dsh-zcode-breaker) (MIT): guarding repeated unproductive compaction. This project uses its own candidate-based retry design, not the rapid-refill tracker implementation.
- [mrbeandev/dsh-hypercompact](https://github.com/mrbeandev/dsh-hypercompact) (MIT): opt-in compaction presets and explicit recoverability boundaries. This project retains the stock LLM summarizer instead of a deterministic compiler.
- [OpenAI Codex](https://github.com/openai/codex) and [Claude Code documentation](https://code.claude.com/docs/en/model-config#default-auto-compact-thresholds): comparisons showing that pressure reservation need not equal the model's maximum output capability. No proprietary Claude Code code or extracted binary snippets are included.

Default values are a transparent policy choice, **not** a claim to implement the exact behavior of Claude Code or Codex, and not a benchmark-derived quality guarantee.
