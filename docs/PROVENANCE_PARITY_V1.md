# Qovrion provenance parity v1

Status: **implemented contract test and fail-closed evidence resolver**.

This tranche connects the reviewed collector provenance registry to real parser output without enabling runtime export.

## Fixture parity

Three static JSONL fixtures exercise the three registered paths through the existing parser code:

- Claude JSONL is decoded with `parseJsonlLine()` and `parseApiCall()`;
- Codex `token_count` is decoded by the streaming Codex session parser;
- Codex content fallback is decoded by the same streaming parser when no token ledger is present.

The tests assert the normalized facts that the provenance profiles describe:

- Claude: measured input/output, derived positive cache fields, no separate reasoning-token count;
- Codex token-count: cached input is removed from ordinary input, cache-read and reasoning remain separately measured;
- Codex fallback: input/output are positive estimates derived from content length and the call is marked estimated.

The fixtures contain no real prompts, source code, paths, credentials, or user data.

## Evidence resolver

`resolveMeasurementEvidenceV1()` combines:

1. one reviewed `CollectorProvenanceProfileV1`;
2. the normalized `ParsedApiCall`;
3. current model-pricing coverage;
4. whether a session identifier will actually be exported.

It returns the profile, public event quality, and public cost evidence. It returns `undefined` for an unreviewed collector path or an attribution source the profile does not support.

### Token-quality roll-up

The public event has one token-quality label while the registry remains field-level. The roll-up therefore considers only positive token quantities that will be exported:

- any active `unknown` field -> `unknown`;
- otherwise any active `estimated` field -> `estimated`;
- otherwise any active `derived` field -> `derived`;
- otherwise -> `measured`;
- no positive token quantity -> `unknown`.

Zero-valued fields do not convert an unknown capability into a measured zero. The field-level collector profile remains authoritative for completeness.

### Identity roll-up

- exact model identity remains `exact`;
- normalized model identity remains `normalized`;
- derived model identity degrades to `unknown` because the event schema has no derived model tier;
- session identity is always `unknown` when the session ID is withheld;
- normalized or derived exported session identity maps to the weaker public `derived` tier.

### Pricing coverage

For locally token-priced profiles, cost is exportable only when all positive billable dimensions have a positive current rate:

- input;
- output plus reasoning;
- cache creation;
- cache read;
- web-search requests.

The resolver recomputes local cost using the existing pricing engine and compares it with the normalized call at micro-USD wire precision. Missing pricing, zero-rate stubs, stale cached costs, local-savings rewrites, or any mismatch degrade cost to `unavailable` rather than publishing a false zero or silently changing the amount.

A Codex content-length fallback uses `estimated/content-length`; measured or mixed locally priced paths use `estimated/token-pricing`. Future reviewed metered profiles can map to provider, client, or billing-export evidence without changing the resolver shape.

## Explicit non-goals

- no automatic parser/cache export;
- no mutation or repricing of internal calls;
- no profile for Zed, OpenCode, Copilot, Cursor, Antigravity, or other unreviewed collectors;
- no hosted synchronization;
- no batch persistence or signing;
- no replacement of the inherited pricing engine.

## Next safe integration

The next bounded step is to build one event-context factory for the three approved paths. It may call the evidence resolver and `toUsageMeasurementEventV1()`, but must still require explicit endpoint identity, source fingerprint, actual AI provider, operation, and session-sharing decision. It must not be wired into normal collection until endpoint key storage and an offline outbox are defined.
