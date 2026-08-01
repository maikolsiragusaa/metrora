# Gemini

Google Gemini CLI.

- **Source:** `src/providers/gemini.ts`
- **Loading:** core/eager via `src/providers/index.ts`
- **Focused tests:** `tests/providers/gemini.test.ts`
- **Contract fixtures:** `tests/fixtures/contracts/gemini-session-json-v1.json` and `gemini-session-jsonl-v1.jsonl`
- **Signed-sharing profile:** `gemini-message-usage-v1`

## Where it reads from

Gemini CLI stores chats under:

```text
~/.gemini/tmp/<project>/chats/session-*.json
~/.gemini/tmp/<project>/chats/session-*.jsonl
```

Metrora discovers both formats automatically. The project directory name is retained as the local project key; local paths are not required by the signed measurement profile.

## Storage formats

Gemini CLI has used two equivalent session formats:

- a complete JSON document containing session metadata and a `messages` array;
- JSONL with one metadata record followed by message records.

The parser first attempts a complete JSON document, then falls back to JSONL. Both paths feed the same per-message parser and are locked to equivalent output by contract fixtures.

## Emission model

Metrora emits one `ParsedProviderCall` for each Gemini message that contains both a model and a non-zero token ledger. It does **not** collapse the complete session to one aggregate call.

The stable deduplication key is:

```text
gemini:<sessionId>:<messageId>
```

When a Gemini message has no ID, a deterministic message ordinal is used. Invalid timestamps are rejected before the deduplication key is committed.

## Token and model provenance

Gemini exposes message-level counters for:

- total input;
- output;
- cached input;
- thought/reasoning tokens.

Gemini's input counter includes cached input as a subset. Metrora therefore derives fresh input as:

```text
fresh input = max(0, total input - cached input)
```

The signed-sharing profile classifies the resulting fields as:

| Field | Provenance |
| --- | --- |
| Fresh input | Derived from measured input and cache counters |
| Output | Measured |
| Cache read | Measured |
| Cache write | Unknown/not exposed |
| Reasoning tokens | Measured |
| Model ID | Exact value recorded by Gemini |
| Session ID | Exact value recorded by Gemini |
| Reasoning effort level | Unknown |

Measured thought-token quantity does not imply that Gemini exposed an effort label such as `low`, `high`, or `max`.

## Cost

Gemini does not provide a provider-billing receipt in these session files. Metrora calculates cost locally from the recorded model and token counters using its pricing registry.

Thought tokens are priced at the output-token rate. Cached tokens are removed from fresh input before pricing so they are not charged twice. Cost remains marked as locally estimated and is withheld when pricing coverage is missing or the stored cost no longer reconciles with the current token facts.

## Tools and content

The local parser maps Gemini tool calls to Metrora's common tool names and extracts shell command names for local analysis. It also associates each Gemini response with the preceding user turn.

Prompts, responses, tool arguments, source code, commands and local paths are not required by `gemini-message-usage-v1` and are not included in signed usage measurements.

## Caching

There is no Gemini-specific cache. Parsed calls participate in Metrora's shared session cache and normal file-fingerprint invalidation.

## Known limits

- Messages without token usage or model identity are skipped.
- Cache-write counts are not exposed by the current Gemini session format.
- Gemini records thought-token counts but not a reviewed reasoning-effort level.
- A future Gemini schema change must update `GEMINI_PARSER_VERSION` and re-run JSON and JSONL fixture parity before signed sharing remains approved.

## When fixing a bug here

1. Add or update an anonymized JSON/JSONL fixture before changing parsing behavior.
2. Preserve equivalence between complete JSON and JSONL paths.
3. Keep cached input separate from fresh input; do not charge both at the input rate.
4. Bump `GEMINI_PARSER_VERSION` whenever unchanged files need provenance re-review.
5. Do not infer reasoning effort from thought-token quantity alone.
