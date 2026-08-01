# Metrora reviewed event factory v1

Status: **implemented and connected to an explicit local Workspace producer; automatic collection and network transport remain disabled**.

`createReviewedUsageMeasurementEventV1()` is the single first-party composition boundary between:

- an existing normalized `ParsedApiCall`;
- the reviewed collector provenance registry;
- fail-closed quality and cost-evidence resolution;
- the public CloudEvents measurement adapter.

`produceLocalReviewedMeasurementV1()` is the first Workspace v1 production boundary above it. The producer loads the local workspace, reuses the protected endpoint event-identity key, invokes the reviewed factory in immutable-assignment mode, and writes only created events to the durable local outbox.

Neither function scans providers or uploads data automatically.

## Explicit context

The factory and producer do not discover or infer the following facts:

- repository, project, account, or session disclosure;
- tool name and version;
- Metrora adapter version;
- source fingerprint;
- actual AI/API provider;
- GenAI operation;
- requested model.

The caller must supply them. In particular, collector `codex` never implies AI provider `openai`: the actual provider remains an explicit field. A source-recorded `modelProvider`, when present, must agree with the declared provider or the event is withheld.

The local producer does not accept caller-selected workspace, endpoint, or event-key values. It loads the existing local personal workspace, uses its enrolled endpoint, and uses the already-protected endpoint identity material.

## Profile-owned fields

The caller cannot choose the public collector profile identity or source kind. When evidence is approved, the factory derives:

- `collector.adapterId` from the reviewed profile ID;
- `collector.sourceKind` from the reviewed profile source kind;
- token/model/session quality from `resolveMeasurementEvidenceV1()`;
- cost evidence from the immutable per-call assignment in Workspace production.

This prevents a content-length fallback from being labelled as a measured token-count path and prevents a mutable current-price feed from reinterpreting settled history.

`collector.adapterVersion` remains explicit because it identifies the Metrora implementation release, while the provenance profile separately pins the inherited parser fingerprint.

## Cost authority

The factory supports two bounded cost-evidence modes:

- `current-compatible` preserves the earlier isolated-factory behavior for callers that have not crossed the runtime settlement boundary;
- `immutable-assignment` is mandatory for Workspace production.

In immutable-assignment mode:

- a matching `metered` assignment is accepted only when the reviewed profile declares the same provider/client/billing-export source;
- a matching `token-price` assignment becomes token-pricing cost only for a profile reviewed as local token pricing;
- an explicit numeric zero remains different from unavailable cost;
- a matching legacy-frozen value remains an estimated `other` value;
- an unavailable assignment produces unavailable cost;
- a missing, malformed, contradictory, or profile-incompatible assignment produces unavailable cost rather than current-price fallback.

Reviewed usage is not discarded merely because cost is unavailable. Measurement v1 does not yet expose the full local `priceRecordId`, zero reason, or rate-band detail; those remain authoritative in the endpoint's immutable local assignment and can be carried by a later evidence/export contract without changing the event amount.

## Session disclosure

Session sharing is a discriminated decision:

- `{ mode: "omit" }` produces no session ID and forces session quality to `unknown`;
- `{ mode: "include", sessionId }` requires a concrete non-empty ID.

There is no boolean or implicit default that can accidentally claim session identity.

## Created, duplicate, and withheld

A reviewed call with unavailable pricing still creates a useful measurement event whose cost is `unavailable`.

A call is withheld when its collector path or reasoning attribution is not reviewed, or when a source-recorded model provider conflicts with the declared provider. Withheld calls do not touch the outbox.

A produced event is written through the existing append-only outbox:

- `enqueued` means the immutable record was published for the first time;
- `duplicate` means the same private production identity was already published;
- reusing one production identity for a different semantic measurement fails closed;
- the same public event ID with different bytes remains a collision.

Malformed normalized facts, invalid context, foreign workspace identity, corrupted state, or invalid outbox state throw rather than being silently repaired.

## Rotation-safe idempotency

The public event ID is intentionally HMAC-derived from the endpoint event-identity key. Rotating that key breaks future linkability as designed, so the same source call would otherwise receive a different public ID after rotation.

Workspace production therefore creates a separate private receipt key from:

- workspace ID;
- stable endpoint ID;
- reviewed provenance profile ID;
- source fingerprint;
- the private normalized-call deduplication key.

Only the SHA-256 digest of that composition is stored. The raw deduplication key never enters the receipt, event, or batch.

The receipt stores the original immutable outbox record and its semantic digest. It is published before the public event file. Therefore:

- an interruption between receipt and event publication is repairable on the next identical production;
- endpoint HMAC-key rotation returns the original event record instead of producing a duplicate;
- changed tokens, cost, scope, provider, disclosure, or other public semantics under the same production identity are rejected;
- the private production digest is not exported or signed into a public batch.

## Privacy boundary

The factory ultimately calls the existing allowlist adapter. The event, outbox record, and private production receipt never serialize:

- private deduplication keys;
- prompts or responses;
- source code or patches;
- tool sequences, MCP names, skills, or subagents;
- shell commands, filenames, or local paths;
- endpoint HMAC/event-identity keys;
- endpoint private signing keys.

The public event contains only the structured measurement fields allowed by the v1 contract.

## Current reviewed paths

Workspace production remains limited to the paths admitted by the executable provenance registry:

- Claude JSONL usage;
- Codex measured token-count records;
- Codex content-length fallback with estimated quality;
- Gemini message usage;
- Zed request token usage with explicit source-recorded model provider;
- Zed cumulative-remainder usage with explicit source-recorded model provider.

A collector being locally supported does not make it eligible for Workspace production.

## Non-goals

- no automatic scan/parser/cache hook;
- no source-fingerprint or provider inference;
- no repository-ID derivation from local paths;
- no automatic session disclosure;
- no signed workspace batch creation in this tranche;
- no retry scheduler, synchronization, account, hosted service, or network transport;
- no additional collector profiles;
- no change to collectors, token accounting, historical pricing, observed labels, or analytics totals.

## Next safe step

W1.C can bind pending workspace-authorized outbox records into the existing immutable signed-batch chain and add a verifiable local export. It must preserve outbox sequence order, signer generation, previous-digest chaining, acknowledgements, quarantine state, private receipt recovery, and the same content-minimal boundary without activating an uploader.
