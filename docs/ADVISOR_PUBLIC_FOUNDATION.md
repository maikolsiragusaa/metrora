# Metrora Advisor public foundation

Metrora Advisor is a read-only, local-first conversational surface. It can answer normally, use bounded Metrora evidence when useful, and keep canonical facts separate from model prose. It does not execute actions, change provider settings, estimate billing, or act as an accounting authority.

## Public architecture

The public path is deliberately replaceable:

  canonical Metrora records
          -> deterministic evidence tools
          -> Advisor Kernel
          -> AdvisorModelRuntime
          -> verified local runtime (Ollama or LM Studio)
          -> session-local Advisor UI

Deterministic guards own authorization, canonical scope, privacy, the fixed read-only allowlist, cancellation, and bounds at their respective boundaries. For a capable runtime, the deterministic EN/IT comprehension result is only a bounded fallback hint; the model receives conversation and optional typed tools first. It may answer directly, or request one or more bounded reads. Metrora executes only canonical read-only requests, merges same-scope evidence, and uses a fresh synthesis when factual evidence was read. Synthesis selects only Metrora-owned AdvisorVerifiedClaimAtomV1 IDs and presentation kinds; Metrora verifies the atom kind/path/value/scope relationship and renders material factual clauses in canonical EN/IT copy. Ordinary chat does not need an evidence bundle, and chart/table values are resolved by Metrora rather than model prose.

## Shipped AdvisorToolV1 Community contract

The public tool boundary is versioned as `advisor-tool-v1` with schema version `1`. The contract keeps these eight identities stable: `get_spend_snapshot`, `get_model_efficiency`, `get_quota_snapshot`, `get_overview_snapshot`, `get_project_drivers`, `get_session_highlights`, `get_coverage_report`, and `get_bench_evidence`.

Metrora captures an immutable invocation scope before a runtime sees a tool call. Period, custom date range, Project, provider authority, and model context cannot be replaced by a model-supplied scope object. Bounded filters are an exact model identifier, a relative period refinement including yesterday where allowed, and a factual `all`/`claude`/`codex` provider filter on provider quota. Unknown tools, malformed or additional arguments, unsupported providers, scope widening, and pathological identifiers fail closed before an evidence read.

Each result is bounded JSON and carries the tool identity, invocation scope, canonical authority, freshness, coverage, observed/derived/unknown semantics, evidence references, explicit unavailable state, and a `content-minimal` privacy classification. Metrora usage remains canonical measured/derived evidence; quota remains provider-reported evidence. Explicit zero remains zero, stale evidence remains labelled stale, and unavailable evidence is never converted into zero. The serialized tool payload is capped at 32 KiB and excludes raw prompts, responses, source, patches, secrets, credentials, account identifiers, and unrestricted local paths.

The reusable synthetic conformance fixtures and suite live beside the Advisor contract in `app/renderer/advisor/conformance.ts` and `conformance.test.ts`. They run without a model, network, provider SDK, or Ollama installation and are also used to exercise the current Ollama adapter. Cancellation is checked before reads, after asynchronous reads, before the final runtime envelope, and on the local runtime boundary.

The first tool set covers:

- overview and measured spend;
- descriptive Project and content-minimal session highlights;
- observed model cost-per-call rows;
- provider-reported quota windows, freshness, reset boundaries, and credits;
- coverage, assumptions, unknowns, and next investigations.
- controlled Bench history and compatible comparisons; starting a Bench run remains an action outside Advisor;

Tool outputs are compact JSON contracts. They do not include raw source content, prompts, local paths, secrets, or chain-of-thought.

## Runtime boundary

The implemented local transport supports two selectable runtimes: Ollama and LM Studio. Both use the same Advisor Kernel, immutable evidence scope, eight-tool contract, chat-first model boundary, deterministic fact precedence, privacy projection, cancellation, and bounded output rules. The runtime/model selector is session-local and keeps the primary UX to “Runtime”, “Local model”, “Ready”, “Unavailable”, and “Tool support varies”.

Electron main is the only process allowed to call either fixed loopback boundary:

- Ollama: `http://127.0.0.1:11434/api/tags` for model discovery and `/api/chat` for chat;
- LM Studio: `http://127.0.0.1:1234/api/v1/models` for model discovery and `/v1/chat/completions` for OpenAI-compatible chat and tool calls.

The LM Studio adapter reads language-model identifiers factually from the local `models` response and ignores embedding models. The default local server does not require a token; configurations that require authentication are unavailable in this Community V1 path because Metrora does not add credential management. Tokens are never logged, stored in renderer state, or synchronized. The endpoint, protocol, and port are not renderer-configurable: arbitrary URLs, LAN binding, remote OpenAI-compatible servers, and cloud fallback are not accepted.

For a factual/tool turn, the first bounded model call receives same-scope conversation, UI context, and the fixed read-only tool definitions. It may answer directly or select typed tools; Metrora executes canonical reads locally and, when evidence was read, sends one fresh synthesis request with tools disabled and merged evidence in a new context. Ordinary chat can finish after the first call. No provider-native tool-result continuation is used. Ollama uses bounded NDJSON parsing; LM Studio uses bounded OpenAI-compatible SSE parsing. A discovered model is not treated as verified Advisor tool support: each discovered model receives a session-local `ModelCapabilityProfileV1` with conversational availability and streaming support facts, while tool support remains `unknown` until a bounded synthetic conformance check establishes more. Deterministic comprehension remains a fallback hint, same-scope history is bounded, UI context is referential only, and action language stays proposal-only.

Cancellation uses an AbortController in main and a request id in the bridge. Request/model/message/content/response byte caps, stream chunk caps, malformed-event caps, timeouts, and bounded redacted errors are enforced. Raw model deltas and final free-form model prose are not forwarded or displayed as material facts. Deterministic evidence remains the factual source, with typed claim atoms and user-friendly Metrora renderers as the public answer authority; bounded social and non-factual boundary copy can remain conversational.

The deterministic local runtime remains an explicit offline evidence fallback when no local model is connected; it is not presented as a full free-form chatbot. Local BYOK supports OpenAI, Anthropic, Gemini, OpenRouter, and OpenCode Zen through fixed provider descriptors, protected local credentials, bounded responses, and direct provider traffic from Electron main; Metrora is not an inference proxy. Conversation state remains client-managed. OpenAI Responses requests explicitly send `store: false` and omit conversation, previous-response, and background state. Anthropic and Gemini are stateless from Metrora’s perspective. OpenRouter uses its direct Chat Completions surface. OpenCode Zen resolves the documented protocol per model: Responses, Anthropic Messages, OpenAI-compatible Chat Completions, or Gemini `generateContent`; a model with no reviewed mapping is unsupported rather than guessed. Each hosted runtime uses one bounded initial chat/tool-selection call and, only when canonical reads are selected, one fresh synthesis call; direct ordinary answers do not require a second model call. Provider-native tool-result continuation is not part of Advisor V2. Arbitrary OpenAI-compatible endpoints and managed inference remain out of scope.

Official provenance references: [Ollama Chat API](https://docs.ollama.com/api/chat), [Ollama tool calling](https://docs.ollama.com/capabilities/tool-calling), [LM Studio REST API](https://lmstudio.ai/docs/developer/rest), [LM Studio model listing](https://lmstudio.ai/docs/developer/rest/list), [LM Studio OpenAI-compatible endpoints](https://lmstudio.ai/docs/developer/openai-compat), [LM Studio tool use](https://lmstudio.ai/docs/developer/openai-compat/tools), [OpenRouter quickstart](https://openrouter.ai/docs/quickstart), [OpenRouter models](https://openrouter.ai/docs/guides/overview/models), [OpenRouter Chat Completions](https://openrouter.ai/docs/api/api-reference/chat/send-chat-completion-request?explorer=true), [OpenRouter tool calling](https://openrouter.ai/docs/guides/features/tool-calling), and [OpenCode Zen](https://opencode.ai/docs/zen/).

## Hosted BYOK Provider Foundation V2

The V2 provider boundary is a small Metrora-owned descriptor/adapter layer. Descriptors own the exact HTTPS origin, model-list route, model protocol and chat route; adapters normalize provider-specific request bodies, authentication headers, JSON responses, SSE events, tool calls, usage and bounded errors into the existing Metrora event/result contract.

| Provider | Discovery | Conversation surface | Capability rule |
|---|---|---|---|
| OpenAI | `GET https://api.openai.com/v1/models` | Responses `/v1/responses` | Fixed Responses route; discovered models remain unverified until conformance |
| Anthropic | `GET https://api.anthropic.com/v1/models` | Messages `/v1/messages` | Fixed Messages route; native content blocks are normalized |
| Gemini | `GET https://generativelanguage.googleapis.com/v1beta/models` | `generateContent` / `streamGenerateContent` | `supportedGenerationMethods` gates usability |
| OpenRouter | `GET https://openrouter.ai/api/v1/models?output_modalities=text` | Chat Completions `/api/v1/chat/completions` | `supported_parameters` advertises potential tool support; Advisor conformance remains separate; text-only models use a limited deterministic-tool path |
| OpenCode Zen | `GET https://opencode.ai/zen/v1/models` | Protocol selected per model | Responses, Messages, OpenAI-compatible, and Gemini routes are explicit; unknown mappings fail closed |

Discovery is not compatibility. A returned model receives a bounded state (`discovered`, `unverified`, `verified`, `limited`, `unsupported`, or `failed-conformance`) plus conversational, streaming and tool-call capability facts. The UI can select only models that are not `unsupported` or `failed-conformance`; unknown tool support never causes provider-native tools to be sent. The eight `AdvisorToolV1` identities, read-only authority, content-minimal evidence projection, direct chat path, and fresh factual synthesis boundary remain in force.

Credentials remain in the existing Electron `safeStorage` file and are read only by the main-process adapter. Provider switching invalidates active requests, stale model/consent state and in-flight probe results. Evidence-sharing consent is explicit, starts unchecked, and resets on provider/model/authority changes. Credentials, raw provider bodies, and arbitrary endpoints do not cross the renderer boundary. Bounded normalized provider text and tool calls are returned transiently only to the renderer chat/tool validator and read-only dispatcher; they are not rendered as material facts, logged, persisted, included in evidence, or synchronized.

## Evidence and truth rules

Metrora measured spend uses the active Metrora currency formatter. Provider-reported credits remain explicitly USD because the provider contract says so. Missing totals stay unavailable; they are never coerced to zero. A provider quota snapshot is distinct from Metrora usage.

Fresh and connected provider snapshots may show values. A stale snapshot is the canonical combination of `freshness: stale` and `availability: unavailable`; it retains last-observed values only when its connection is `stale` or `transientFailure` and its `observedAt` is valid, and says that refresh failed. Unavailable snapshots without valid retained facts show no number, plan, or invented zero. A passed reset boundary is not rendered as “resets now”. No burn-rate, forecast, allocation, routing, or automation is introduced in this tranche.

Trend language is deliberately descriptive: latest returned day versus the average of earlier returned days. It does not claim previous-period causality.

## Bench evidence

Bench results are controlled evidence for a declared task pack. A clean completed run is available for that pack; incomplete, corrupt, or unavailable records remain partial or unavailable, and incompatible canonical comparisons remain not comparable. Even available Bench evidence does not establish universal model quality, ranking, or a purchase recommendation.

## Privacy and storage

Conversation history is session-local in the renderer and is not synced or persisted by this foundation. The initial chat call receives only bounded same-scope conversation, the current question, the deterministic semantic fallback hint, the deterministic guard contract, bounded UI context, and tool schemas. If canonical reads occur, the fresh synthesis call receives the question, same-scope conversation, verified scope, validated plan, selectable typed claim atoms, and final content-minimal evidence; tool results are not replayed as provider-native messages. A hosted BYOK runtime shares only that minimum content-minimal context after explicit consent. Raw source content, paths, secrets, and hidden reasoning are excluded from the public contract. Hosted lifecycle events exposed to the renderer contain only safe status metadata and raw provider bodies/deltas stay in the main-process boundary; bounded normalized responses and read-only tool-call arguments are transient inputs excluded from logs, evidence, mobile projection, and sync.

There is no Metrora gateway, managed inference service, or cloud billing path. Direct Local BYOK calls use the user’s selected provider account; provider terms, privacy, abuse-monitoring, and retention policies still apply, including when OpenAI `store: false` is used. A credential is entered into a transient password field, sent immediately to the Electron main process, cleared from renderer state, and never returned to renderer code or persisted there; durable custody uses Electron `safeStorage` when available.

## Conversation, synthesis, and presentation

Each turn is represented by a versioned `AdvisorTurnPlanV1`, but for a capable runtime it is a bounded fallback hint rather than a conversation gate. The model receives the question, bounded same-scope history, bounded UI context, and the fixed eight-tool read contract; it may answer directly or request typed evidence. When evidence is read, Metrora verifies selected `AdvisorVerifiedClaimAtomV1` values and renders factual clauses from canonical data. Ordinary chat needs no evidence. Requests such as “run this benchmark”, “launch agents”, “change routing”, or “apply policy” remain proposal-only and expose no action executor from Advisor.

When a connected model supplies a synthesis draft, `AdvisorSynthesisDraftV1` conclusion/why/details blocks contain only ordered `{ claimIds, emphasis? }` selections; factual block text is not accepted. The selected IDs resolve to Metrora-owned `AdvisorVerifiedClaimAtomV1` values. Each atom has a closed `claimKind`, metric, subject, equality operator, canonical value/unit, exact evidence reference/path, and canonical scope. Metrora uses an explicit claim-kind-to-evidence mapping to verify the relationship, then renders the material factual clauses from EN/IT canonical renderers. This prevents a true value from laundering unsupported prose such as “cheapest”, “more efficient”, or a causal explanation, and prevents an extra unsupported clause from hiding in a valid block. The model owns semantic understanding and planning plus verified-atom selection, ordering, emphasis, and presentation selection. Metrora owns factual rendering and the current bounded follow-up suggestions; bounded conversational behavior remains product-controlled. `AdvisorPresentationBlockV1` values are built from canonical evidence for metric cards, native SVG charts, comparison tables, quota cards, Bench summaries, warnings, and evidence disclosure. Missing values remain unavailable rather than being zero-filled.

## Public/private boundary

This branch publishes the reusable Advisor Kernel/contracts, deterministic evidence tools, safe local runtime rules, UI, tests, and this conformance/provenance description.

It does not publish proprietary ranking or recommendation systems, private evaluations or playbooks, personalized forecasting, advanced allocation/routing/automation, commercial strategy, or private roadmap material. The public UI is a conversational evidence reader, not a decision authority.

## Provenance and licenses

The repository is MIT-licensed. This foundation adds no package dependency. Ollama core is MIT-licensed (see the official license link above); this branch incorporates no Ollama code or package, so THIRD_PARTY_NOTICES.md does not change. The shipped path uses Metrora-owned adapters, contracts, and native SVG presentation. The Ollama service/API are separate from each model's weights. Model weights may carry independent licenses and must be reviewed by the operator before use. The Advisor interaction pattern is an original Metrora implementation.

Synthetic conformance tests cover the fixed loopback endpoint, incremental NDJSON, cancellation, bounded errors, nullable evidence, mixed quota freshness, unavailable-provider privacy, multi-tool aggregation, deterministic fact authority, chat-first generic turns, bounded UI context/history, action safety, and the session-local welcome surface.
