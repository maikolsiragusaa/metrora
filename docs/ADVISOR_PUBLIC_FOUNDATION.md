# Metrora Advisor public foundation

Metrora Advisor is a read-only, local-first investigation surface. It turns a plain-language question into a bounded conversation over canonical Metrora records. It does not execute actions, change provider settings, estimate billing, or act as an accounting authority.

## Public architecture

The public path is deliberately replaceable:

  canonical Metrora records
          -> deterministic evidence tools
          -> Advisor Kernel
          -> AdvisorModelRuntime
          -> verified local runtime (Ollama or LM Studio)
          -> session-local Advisor UI

The deterministic tools own facts, arithmetic, coverage, currency formatting, and provider-quota freshness. A model can choose among the exposed read-only tools and write qualitative context, but its prose never replaces verified evidence. The UI renders the verified evidence rail and details beside the model context.

## Shipped AdvisorToolV1 Community contract

The public tool boundary is versioned as `advisor-tool-v1` with schema version `1`. The contract keeps these seven identities stable: `get_spend_snapshot`, `get_model_efficiency`, `get_quota_snapshot`, `get_overview_snapshot`, `get_project_drivers`, `get_session_highlights`, and `get_coverage_report`.

Metrora captures an immutable invocation scope before a runtime sees a tool call. Period, custom date range, Project, provider authority, and model context cannot be replaced by a model-supplied scope object. The only bounded filters are an exact model identifier on the applicable usage tools and a factual `all`/`claude`/`codex` provider filter on provider quota. Unknown tools, malformed or additional arguments, unsupported providers, and pathological identifiers fail closed before an evidence read.

Each result is bounded JSON and carries the tool identity, invocation scope, canonical authority, freshness, coverage, observed/derived/unknown semantics, evidence references, explicit unavailable state, and a `content-minimal` privacy classification. Metrora usage remains canonical measured/derived evidence; quota remains provider-reported evidence. Explicit zero remains zero, stale evidence remains labelled stale, and unavailable evidence is never converted into zero. The serialized tool payload is capped at 32 KiB and excludes raw prompts, responses, source, patches, secrets, credentials, account identifiers, and unrestricted local paths.

The reusable synthetic conformance fixtures and suite live beside the Advisor contract in `app/renderer/advisor/conformance.ts` and `conformance.test.ts`. They run without a model, network, provider SDK, or Ollama installation and are also used to exercise the current Ollama adapter. Cancellation is checked before reads, after asynchronous reads, before the final runtime envelope, and on the local runtime boundary.

The first tool set covers:

- overview and measured spend;
- descriptive Project and content-minimal session highlights;
- observed model cost-per-call rows;
- provider-reported quota windows, freshness, reset boundaries, and credits;
- coverage, assumptions, unknowns, and next investigations.

Tool outputs are compact JSON contracts. They do not include raw source content, prompts, local paths, secrets, or chain-of-thought.

## Runtime boundary

The implemented local transport supports two selectable runtimes: Ollama and LM Studio. Both use the same Advisor Kernel, immutable evidence scope, seven-tool contract, deterministic fact precedence, privacy projection, cancellation, and bounded output rules. The runtime/model selector is session-local and keeps the primary UX to “Runtime”, “Local model”, “Ready”, “Unavailable”, and “Tool support varies”.

Electron main is the only process allowed to call either fixed loopback boundary:

- Ollama: `http://127.0.0.1:11434/api/tags` for model discovery and `/api/chat` for chat;
- LM Studio: `http://127.0.0.1:1234/api/v1/models` for model discovery and `/v1/chat/completions` for OpenAI-compatible chat and tool calls.

The LM Studio adapter reads language-model identifiers factually from the local `models` response and ignores embedding models. The default local server does not require a token; configurations that require authentication are unavailable in this Community V1 path because Metrora does not add credential management. Tokens are never logged, stored in renderer state, or synchronized. The endpoint, protocol, and port are not renderer-configurable: arbitrary URLs, LAN binding, remote OpenAI-compatible servers, and cloud fallback are not accepted.

Both adapters use a bounded two-stage flow: a planning request may return multiple tool calls, Metrora executes canonical read-only tools locally, and a final request runs with tools disabled. Ollama uses bounded NDJSON parsing; LM Studio uses bounded OpenAI-compatible SSE parsing. A discovered model is not treated as verified Advisor tool support: each discovered model receives a session-local `ModelCapabilityProfileV1` with conversational availability and streaming support facts, while tool support remains `unknown` until a bounded synthetic conformance check establishes more.

Cancellation uses an AbortController in main and a request id in the bridge. Request/model/message/content/response byte caps, stream chunk caps, malformed-event caps, timeouts, and bounded redacted errors are enforced. Raw model deltas are not forwarded to the renderer; only the completed bounded response is eligible for the existing narrative sanitizer. Unsafe narrative is dropped while deterministic evidence remains available.

The deterministic local runtime remains an explicit offline evidence fallback when no local model is connected; it is not presented as a full free-form chatbot. The optional Local BYOK path calls the selected OpenAI, Anthropic, or Gemini origin directly from Electron main, with fixed descriptors, protected local credentials, bounded responses, and no Metrora inference proxy. Arbitrary OpenAI-compatible endpoints and managed inference remain out of scope. See [ADVISOR_LOCAL_BYOK_V1_IMPLEMENTATION_READY.md](ADVISOR_LOCAL_BYOK_V1_IMPLEMENTATION_READY.md).

Official provenance references: [Ollama Chat API](https://docs.ollama.com/api/chat), [Ollama tool calling](https://docs.ollama.com/capabilities/tool-calling), [LM Studio REST API](https://lmstudio.ai/docs/developer/rest), [LM Studio model listing](https://lmstudio.ai/docs/developer/rest/list), [LM Studio OpenAI-compatible endpoints](https://lmstudio.ai/docs/developer/openai-compat), and [LM Studio tool use](https://lmstudio.ai/docs/developer/openai-compat/tools).

## Evidence and truth rules

Metrora measured spend uses the active Metrora currency formatter. Provider-reported credits remain explicitly USD because the provider contract says so. Missing totals stay unavailable; they are never coerced to zero. A provider quota snapshot is distinct from Metrora usage.

Fresh and connected provider snapshots may show values. A stale snapshot is the canonical combination of `freshness: stale` and `availability: unavailable`; it retains last-observed values only when its connection is `stale` or `transientFailure` and its `observedAt` is valid, and says that refresh failed. Unavailable snapshots without valid retained facts show no number, plan, or invented zero. A passed reset boundary is not rendered as “resets now”. No burn-rate, forecast, allocation, routing, or automation is introduced in this tranche.

Trend language is deliberately descriptive: latest returned day versus the average of earlier returned days. It does not claim previous-period causality.

## Privacy and storage

Conversation history is session-local in the renderer and is not synced or persisted by this foundation. A local model receives only bounded conversation, the current question, tool schemas, and compact evidence-tool results through the fixed loopback boundary. A hosted BYOK runtime receives the question plus the minimum content-minimal evidence only after explicit consent. Raw source content, prompts, paths, secrets, and hidden reasoning are excluded from the public contract.

There is no Metrora gateway, managed inference service, or cloud billing path. Direct Local BYOK calls use the user’s selected provider account; provider terms, privacy, and retention apply. Credentials live behind the Electron main-process/OS secure-storage boundary and never in renderer JavaScript. See [ADVISOR_BENCH_EVIDENCE_INTEGRATION_V1_IMPLEMENTATION_READY.md](ADVISOR_BENCH_EVIDENCE_INTEGRATION_V1_IMPLEMENTATION_READY.md) for the separate read-only Bench projection.

## Public/private boundary

This branch publishes the reusable Advisor Kernel/contracts, deterministic evidence tools, safe local runtime rules, UI, tests, and this conformance/provenance description.

It does not publish proprietary ranking or recommendation systems, private evaluations or playbooks, personalized forecasting, advanced allocation/routing/automation, commercial strategy, or private roadmap material. The public UI is an evidence reader and investigator, not a decision authority.

## Provenance and licenses

The repository is MIT-licensed. This foundation adds no package dependency. Ollama core is MIT-licensed (see the official license link above); this branch incorporates no Ollama code or package, so THIRD_PARTY_NOTICES.md does not change. The Ollama service/API are separate from each model's weights. Model weights may carry independent licenses and must be reviewed by the operator before use. The Advisor interaction pattern is an original Metrora implementation.

Synthetic conformance tests cover the fixed loopback endpoint, incremental NDJSON, cancellation, bounded errors, nullable evidence, mixed quota freshness, unavailable-provider privacy, multi-tool aggregation, deterministic fact authority, and the session-local welcome surface.
