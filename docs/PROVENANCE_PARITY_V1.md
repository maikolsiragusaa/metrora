# Qovrion provenance parity v1

Status: **implemented contract tests and fail-closed evidence resolver**.

This layer connects reviewed collector provenance to real parser output without enabling automatic runtime export.

## Reviewed paths

Six concrete evidence paths are registered:

- Claude JSONL usage;
- Codex `token_count`;
- Codex content-length fallback;
- Gemini message usage from JSON or JSONL;
- Zed per-request token usage;
- Zed cumulative remainder.

Approval is path-specific. A collector name alone never grants a quality claim.

## Parser parity

Tests exercise the inherited parser code rather than recreating provider logic:

- Claude JSONL is decoded with `parseJsonlLine()` and `parseApiCall()`;
- Codex paths use the streaming Codex session parser;
- Gemini JSON and JSONL pass through the same Gemini provider parser and must agree;
- Zed builds a real `threads.db`, passes through the existing SQLite parser, preserves `model.provider`, and emits both request and remainder records;
- the blocking CI suite separately exercises Zed's primary zstd-compressed database path on Ubuntu and Windows.

The fixtures contain no real prompts, source code, credentials, user paths or private data.

## Field-level facts

The registry describes each field independently:

- Claude: measured input/output, derived cache fields, no reviewed separate reasoning-token count;
- Codex token-count: measured input/output/cache-read/reasoning after cached-input normalization;
- Codex fallback: estimated input/output from content length;
- Gemini: derived fresh input, measured output/cache-read/thought tokens, unknown effort level;
- Zed request entries: measured input/output/cache-read/cache-write;
- Zed remainder: those four fields are derived by subtracting visible requests from cumulative counters.

A zero reasoning value does not prove that the underlying model performed no hidden reasoning.

## Evidence resolver

`resolveMeasurementEvidenceV1()` combines:

1. one reviewed path-specific profile;
2. the normalized `ParsedApiCall`;
3. current model-pricing coverage;
4. the concrete session identifier, when one will actually be exported.

It returns the profile, public quality and public cost evidence. It returns `undefined` for unreviewed paths, missing required source identity or unsupported reasoning attribution.

### Token-quality roll-up

The public event has one token-quality label while the registry remains field-level. Only positive exported quantities participate:

- any active `unknown` field -> `unknown`;
- otherwise any active `estimated` field -> `estimated`;
- otherwise any active `derived` field -> `derived`;
- otherwise -> `measured`;
- no positive token quantity -> `unknown`.

Zero-valued fields do not turn an unknown capability into a measured zero.

### Identity

- exact model identity remains `exact`;
- normalized model identity remains `normalized`;
- session identity is `unknown` unless a non-empty session ID is actually exported;
- Zed sharing additionally requires the explicit provider from `thread.model.provider`;
- the event factory withholds the event when its caller-supplied provider conflicts with the provider read from Zed.

No provider is inferred from a model label or collector name.

### Cost

For locally token-priced profiles, every positive exported token dimension must have pricing coverage. The resolver recomputes cost using the existing pricing engine and compares it at micro-USD wire precision.

Missing rates, stale costs, unsafe ranges or mismatches degrade cost to `unavailable`; token facts remain usable.

These values are labelled estimated token-pricing costs. In particular, a Zed estimate is not a `zed.dev` billing receipt and does not claim that a subscription incurred a marginal charge.

Calls with web-search charges remain `unavailable` because the v1 public event does not yet expose the billed request count.

## Privacy

None of the six profiles requires prompts, responses, source code, patches or local paths. Private parser deduplication keys and thread summaries are not serialized into public events.

## Explicit non-goals

- no automatic parser-to-outbox producer;
- no mutation or repricing of internal calls;
- no profile for OpenCode, Copilot, Cursor, Antigravity or other pending paths;
- no hosted synchronization;
- no inference of provider or reasoning effort;
- no replacement of the inherited parsers or pricing engine.
