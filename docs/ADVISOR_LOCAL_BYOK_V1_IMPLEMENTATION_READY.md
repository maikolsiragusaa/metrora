# Metrora Advisor Local BYOK V1 — implementation-ready contract

Status: Lane A implementation on `feat/advisor-local-intelligence-v2`. This document describes the public, local-first hosted-provider boundary; it is not a managed Metrora inference service.

## Product contract

Advisor still plans an answer from deterministic Metrora evidence first. A hosted runtime may add bounded qualitative context, but the deterministic conclusion, arithmetic, coverage, scope, and limitations remain authoritative. The hosted path is optional and never silently replaces Ollama, LM Studio, or the offline evidence fallback.

Before the first hosted investigation, the UI identifies the selected provider and model and asks for explicit consent. The copy explains that the question and the minimum content-minimal Metrora evidence go directly to the user-selected provider using the user’s account; Metrora does not proxy the request; provider terms, privacy, and retention apply; and the saved key remains protected locally.

## Credential boundary

- Credential authority lives in Electron main.
- The renderer may submit one bounded secret during entry, but main never returns key material.
- Plaintext is not written to localStorage, sessionStorage, settings, history, logs, diagnostics, telemetry, exports, or sync.
- The entry field is cleared after the save attempt settles. A failed protected-store write returns `needs-reentry`.
- Status is opaque: `not-configured`, `ready`, `locked-unavailable`, `invalid`, or `needs-reentry`.
- Electron `safeStorage` async encryption is required. Windows and macOS use the supported OS-backed store. Linux fails closed unless Electron reports a genuinely protected backend; `basic_text`, plaintext, and unknown backends are rejected.

The current file is ciphertext-only JSON under the Electron user-data directory. Provider adapters read secrets only in main-process memory and only for the active request. The renderer bridge exposes status, set, and clear operations, never read-secret.

## Fixed provider authority

BYOK V1 does not accept arbitrary URLs or generic OpenAI-compatible cloud servers. The descriptors own the origins and paths:

| Provider | Origin | Discovery | Text request | Auth in main |
| --- | --- | --- | --- | --- |
| OpenAI | `https://api.openai.com` | `/v1/models` | `/v1/responses` | Bearer |
| Anthropic | `https://api.anthropic.com` | `/v1/models` | `/v1/messages` | `x-api-key` plus `anthropic-version` |
| Gemini | `https://generativelanguage.googleapis.com` | `/v1beta/models` | `/v1beta/models/{model}:generateContent` or `:streamGenerateContent?alt=sse` | `x-goog-api-key` |

Every request is HTTPS, exact-origin checked, redirect-rejecting, bounded, cancellable, and subject to a timeout. Provider response bodies are not forwarded on errors; user-facing failures are normalized to recoverable states such as credential invalid, model unavailable, rate limited, provider unavailable, malformed response, response too large, or cancelled.

Gemini V1 intentionally uses stateless `generateContent` / `streamGenerateContent` with client-managed message history. It does not create provider-side persistent Interactions state. This keeps retention behavior explicit while the API semantics evolve.

## Normalized adapter boundary

Main normalizes provider-native response formats into a bounded Metrora event contract:

`started`, `text-delta`, `tool-call-start`, `tool-call-delta`, `tool-call-complete`, `usage`, `completed`, `failed`, `cancelled`.

Only bounded text, allowlisted Metrora tool calls, and authoritative usage fields may cross the typed bridge. Provider-native web search, file search, computer use, code execution, remote MCP, and arbitrary tools are rejected. Unknown or malformed tool calls fail closed. Raw provider events, request bodies, response bodies, and credentials never cross into the renderer.

The renderer currently enables the text-first hosted path with `tools: []`. The normalized tool event boundary is present for a later, separately verified read-only round trip; it does not silently grant provider-native capabilities.

Discovered models are not automatically verified. The UI uses factual states such as `discovered`, `unverified`, `limited`, `unsupported`, and `failed-conformance`. A model appearing in `/models` does not prove Advisor tool compatibility.

## Verification

Synthetic tests cover protected credential storage, Linux fail-closed behavior, ciphertext-only persistence, all three fixed descriptors and auth headers, non-streaming and SSE text, redirect rejection, bounded provider errors, cancellation, unsupported tools, normalized events, minimum evidence projection, and deterministic answer precedence. CI does not call a real provider.

Official references: [OpenAI Responses streaming](https://platform.openai.com/docs/api-reference/responses-streaming), [OpenAI models](https://platform.openai.com/docs/api-reference/models/list), [Anthropic Messages](https://docs.anthropic.com/en/api/messages), [Anthropic models](https://docs.anthropic.com/en/api/models-list), [Gemini models](https://ai.google.dev/api/models), [Gemini generateContent](https://ai.google.dev/api/generate-content), and [Electron safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage).
