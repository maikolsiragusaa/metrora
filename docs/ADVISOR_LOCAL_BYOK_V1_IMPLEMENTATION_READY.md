# Advisor Local BYOK V1 — implementation-ready design package

> **DESIGN ONLY — NOT IMPLEMENTED.** This document is an implementation package, not a claim that Metrora currently stores external credentials or calls hosted model APIs.

## Purpose and non-negotiables

This package defines a future, opt-in path for using a user-supplied key with Advisor while preserving the current local-runtime boundary, the read-only AdvisorToolV1 contract, and the existing privacy posture.

The first implementation must be:

- direct from the Electron main process to a fixed provider origin; Metrora is not a hosted inference proxy and does not receive the key or conversation;
- renderer-blind with respect to credentials: the renderer receives only an opaque credential status and bounded model/capability metadata;
- opt-in, provider-specific, and capability-declared; no protocol-shaped adapter may infer that every model supports tools or streaming;
- transient with respect to prompts, deltas, tool arguments, and generated text; none of those are written to Metrora files, history, telemetry, sync, exports, or crash reports by this package;
- read-only if tools are enabled, and limited to an explicitly allowlisted Advisor tool surface; provider-native browsing, code execution, file search, MCP, and arbitrary remote tools are out of scope;
- unavailable rather than falsely successful when credentials, model discovery, transport, or capability metadata cannot be verified.

No implementation should begin until the existing local Ollama and LM Studio runtime paths, fixed loopback rules, and Advisor public foundation continue to pass their current tests.

## Current API authority snapshot

Verify these authorities again at implementation time. The endpoint choices below intentionally keep each provider's native request and stream model visible instead of pretending that all three APIs are interchangeable.

| Provider | Model discovery | Text request | Streaming/tool shape | Credential transport |
| --- | --- | --- | --- | --- |
| OpenAI | GET https://api.openai.com/v1/models | POST https://api.openai.com/v1/responses | stream: true; response events; custom function tools are part of the Responses request | Authorization: Bearer … in the main process only |
| Anthropic | GET https://api.anthropic.com/v1/models | POST https://api.anthropic.com/v1/messages | stream: true; message/content-block events; tool_use and streamed JSON input deltas | x-api-key plus the provider-required API-version header in the main process only |
| Gemini | GET https://generativelanguage.googleapis.com/v1beta/models | POST …/v1beta/models/{model}:generateContent; stream variant :streamGenerateContent | contents/parts; functionDeclarations and functionCall/function response turns; provider stream framing is not assumed to be OpenAI SSE | x-goog-api-key header in the main process only |

Official references:

- [OpenAI Responses create](https://developers.openai.com/api/reference/cli/resources/responses/methods/create) and [OpenAI models](https://developers.openai.com/api/reference/resources/models)
- [Anthropic Create a Message](https://platform.claude.com/docs/en/api/messages/create) and [Anthropic Models](https://platform.claude.com/docs/en/api/models)
- [Gemini generating content](https://ai.google.dev/api/generate-content), [Gemini models](https://ai.google.dev/api/models), and [Gemini API key usage](https://ai.google.dev/gemini-api/docs/api-key)

The current Gemini reference also documents a newer Interactions API. This package does not silently mix that stateful/agentic surface into the first BYOK adapter: use the stateless generateContent family for the initial provider contract, or create a separately versioned Interactions adapter with separately reviewed retention and tool semantics.

## Proposed Electron boundary

    Renderer Advisor UI
      -> preload capability bridge
      -> main-process Advisor BYOK broker
           -> secure OS credential store (opaque handle only)
           -> provider adapter (fixed origin, bounded request, AbortController)
           -> provider response normalizer
      -> bounded UI events and model capability profile

The renderer may request saveCredential, clearCredential, listModels, and startConversation by provider and opaque account identifier. It may not provide an arbitrary URL, read a secret, construct an authorization header, or select a provider-specific tool payload. The main process validates every provider/model/endpoint tuple before opening a connection.

The credential store should use the host's secure OS facility (for example, the existing Electron secure-storage boundary or the platform credential/keychain service). The concrete facility is an implementation decision, but these invariants are not:

- store only a provider-scoped secret under a Metrora-owned account key;
- never put the secret in renderer state, IPC error text, URL query strings, logs, diagnostics, crash metadata, or persisted Advisor transcripts;
- never sync or export the secret;
- clear is explicit and idempotent;
- a missing, locked, or unreadable secret produces a bounded credential-unavailable state and does not delete the user's selected model;
- provider responses are redacted before any error crosses the IPC boundary.

The network policy is outbound-only from the main process over TLS to the fixed provider origins above. Local development fixtures may use loopback under test; production configuration must reject arbitrary base URLs, HTTP, redirects to an unapproved origin, and user-supplied proxy endpoints unless a separate security review ratifies them.

## Normalized capability and event contract

Each provider adapter returns a versioned capability profile rather than a boolean “compatible” flag:

- provider and model id;
- model display name when supplied by the provider;
- supportsStreaming and supportsTools as true, false, or unknown;
- supported input/output kinds only when authoritative metadata exists;
- bounded context/parameter metadata when supplied, otherwise unknown;
- model-list freshness and a bounded discovery diagnostic.

The normalized conversation event stream should contain only these bounded event kinds:

- started;
- text-delta with a bounded text fragment;
- tool-call-start, tool-call-delta, and tool-call-complete with bounded, validated names/JSON;
- usage only when the provider returns authoritative usage fields;
- completed, failed, or cancelled.

OpenAI response events, Anthropic message/content-block events, and Gemini response chunks must be parsed by separate provider modules and mapped to this contract. A provider's unknown event is ignored or fails closed; it is never copied wholesale to the renderer.

Tool normalization must preserve provider differences:

- OpenAI can stream function-call argument deltas in a Responses event sequence;
- Anthropic represents tool use as content blocks and may stream JSON input fragments;
- Gemini represents function calls in model parts and expects a subsequent function-response turn.

Accumulate tool JSON only within a strict byte/character bound, parse it before invocation, reject duplicate or unknown tool names, and never invoke a tool merely because a provider emitted a tool-shaped object. The first external implementation should ship text streaming first and enable tools only after provider-fixture tests prove the full round trip. If enabled, the allowlist is read-only AdvisorToolV1; no existing tool name or schema may be changed.

Cancellation uses an AbortController owned by the main-process request. It must close the response reader, stop provider work where the provider supports cancellation, discard incomplete tool arguments, and emit one cancelled event. User cancellation is not retried and never becomes a successful or zero-length answer.

## Model discovery and selection

Model discovery is provider-native and bounded:

- OpenAI: page through GET /v1/models only as needed, retain the provider model id and bounded metadata;
- Anthropic: page through GET /v1/models using the provider cursor and limit bounds;
- Gemini: page through GET /v1beta/models using pageToken/pageSize, retain models whose supported actions include the selected generation surface.

The UI shows the exact provider model id, a safe display name, freshness, and capability states. It must not convert missing capability metadata into “supported”. A discovery failure leaves a previously selected model intact and exposes model-list-unavailable; it must not silently replace the model, call a default model, or erase the credential.

Discovery metadata may be cached with a bounded TTL, but the cache is advisory. Secrets, prompts, generated text, raw provider responses, and provider request headers are never part of that cache.

## Rate limits, errors, and data handling

Map provider failures into bounded user-facing classes: credential-invalid, model-unavailable, rate-limited, upstream-unavailable, request-rejected, response-malformed, response-too-large, cancelled, and unknown-provider-error. Keep status code and a short provider-neutral diagnostic; do not forward raw bodies or request ids that could contain sensitive material.

The safe default is no automatic retry after a response has started. Before first content, a single bounded retry may be considered for an idempotent text-only request after a transient network/5xx response. Never retry a tool call automatically. Respect provider rate-limit guidance when it is available, but do not promise a cost, quota, SLA, or privacy property that the provider does not return.

The user is shown a clear consent boundary that prompt, selected local evidence, tool results, and generated text will leave the machine for the selected provider. Metrora does not proxy, store, sell, rank, or synchronize that content. Existing Advisor local-runtime privacy rules continue to apply to the local side of the conversation.

## Implementation package and acceptance gates

A future implementation should be split into these reviewable units:

1. main-process credential store and redaction tests;
2. fixed-origin provider descriptors, model discovery, and capability profiles;
3. provider-specific non-streaming fixtures and bounded error mapping;
4. provider-specific streaming fixtures, cancellation, and normalized events;
5. optional read-only Advisor tool bridge with allowlist and tool-argument bounds;
6. preload/renderer model selector, credential status, consent, and diagnostics;
7. public documentation and privacy/security review.

Acceptance requires, at minimum:

- a renderer test proving no secret crosses preload IPC;
- fixture tests for each provider's model-list response and pagination;
- fixture tests for normal completion, stream truncation, malformed chunks, rate limiting, invalid credentials, and cancellation;
- tests proving fixed origins and rejection of arbitrary URLs/redirects;
- tests proving unknown capabilities stay unknown and tool calls fail closed;
- tests proving no raw prompt, output, tool argument, API key, or provider body is persisted or logged;
- regression tests for Ollama and LM Studio runtime selection, fixed loopback, existing Advisor tools, and current privacy conformance.

## Explicitly out of scope

This package does not implement hosted BYOK, a Metrora relay, account management, billing, provider usage accounting, remote telemetry, arbitrary OpenAI-compatible endpoints, provider-native browsing/code/file tools, automatic model recommendations, cross-provider quality claims, or changes to AdvisorToolV1.
