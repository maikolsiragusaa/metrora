# Metrora Advisor public foundation

Metrora Advisor is a read-only, local-first investigation surface. It turns a plain-language question into a bounded conversation over canonical Metrora records. It does not execute actions, change provider settings, estimate billing, or act as an accounting authority.

## Public architecture

The public path is deliberately replaceable:

  canonical Metrora records
          -> deterministic evidence tools
          -> Advisor Kernel
          -> AdvisorModelRuntime
          -> verified local runtime (Ollama first)
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

The implemented local transport targets the official Ollama local HTTP API. Model capability remains unverified until an operator selects and uses a local model:

- Electron main is the only process allowed to call http://127.0.0.1:11434;
- the renderer receives an allowlisted IPC bridge with probe, chat, cancellation, and bounded delta events;
- the endpoint is fixed to loopback; arbitrary URLs are not accepted;
- model names are discovered from /api/tags and selected explicitly in the Advisor header;
- a planning request may return multiple tool calls; tools execute locally; one final request streams with tools disabled;
- cancellation uses an AbortController in main and a request id in the bridge;
- timeouts, message/content/response byte caps, stream chunk caps, malformed-chunk caps, and bounded redacted errors are enforced.

Ollama support is model-dependent: a discovered model is not automatically evidence that its tool-calling behavior is capable. The UI says that capability varies by model. The deterministic local runtime remains an explicit offline fallback when no local model is connected; it is not presented as a full free-form chatbot.

No provider SDK or new runtime dependency is required. LM Studio and hosted/cloud BYOK adapters are follow-up work until their Electron boundary, model capability, cancellation, and privacy behavior are proven.

Official provenance references: [Ollama Chat API](https://docs.ollama.com/api/chat), [tool calling](https://docs.ollama.com/capabilities/tool-calling), [streaming](https://docs.ollama.com/capabilities/streaming), and the [Ollama core license](https://github.com/ollama/ollama/blob/main/LICENSE).

## Evidence and truth rules

Metrora measured spend uses the active Metrora currency formatter. Provider-reported credits remain explicitly USD because the provider contract says so. Missing totals stay unavailable; they are never coerced to zero. A provider quota snapshot is distinct from Metrora usage.

Fresh and connected provider snapshots may show values. A stale snapshot is the canonical combination of `freshness: stale` and `availability: unavailable`; it retains last-observed values only when its connection is `stale` or `transientFailure` and its `observedAt` is valid, and says that refresh failed. Unavailable snapshots without valid retained facts show no number, plan, or invented zero. A passed reset boundary is not rendered as “resets now”. No burn-rate, forecast, allocation, routing, or automation is introduced in this tranche.

Trend language is deliberately descriptive: latest returned day versus the average of earlier returned days. It does not claim previous-period causality.

## Privacy and storage

Conversation history is session-local in the renderer and is not synced or persisted by this foundation. The local model receives only the bounded conversation, the current question, tool schemas, and compact evidence-tool results through the local loopback boundary. Raw source content, prompts, paths, secrets, and hidden reasoning are excluded from the public contract.

There is no Metrora gateway, managed inference service, cloud billing path, secret storage requirement, or hosted BYOK in this tranche. If a future provider adapter needs a credential, it must live behind the existing Electron main-process/OS secure-storage boundary and never in renderer JavaScript.

## Public/private boundary

This branch publishes the reusable Advisor Kernel/contracts, deterministic evidence tools, safe local runtime rules, UI, tests, and this conformance/provenance description.

It does not publish proprietary ranking or recommendation systems, private evaluations or playbooks, personalized forecasting, advanced allocation/routing/automation, commercial strategy, or private roadmap material. The public UI is an evidence reader and investigator, not a decision authority.

## Provenance and licenses

The repository is MIT-licensed. This foundation adds no package dependency. Ollama core is MIT-licensed (see the official license link above); this branch incorporates no Ollama code or package, so THIRD_PARTY_NOTICES.md does not change. The Ollama service/API are separate from each model's weights. Model weights may carry independent licenses and must be reviewed by the operator before use. The Advisor interaction pattern is an original Metrora implementation.

Synthetic conformance tests cover the fixed loopback endpoint, incremental NDJSON, cancellation, bounded errors, nullable evidence, mixed quota freshness, unavailable-provider privacy, multi-tool aggregation, deterministic fact authority, and the session-local welcome surface.
