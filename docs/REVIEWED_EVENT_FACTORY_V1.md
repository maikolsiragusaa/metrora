# Metrora reviewed event factory v1

**Status:** implemented and used by explicit local Workspace production.

`createReviewedUsageMeasurementEventV1()` is the first-party projection boundary between a normalized local call, the executable collector-provenance registry, immutable cost evidence and the public measurement contract.

`produceLocalReviewedMeasurementV1()` loads the active local Workspace and protected endpoint identity, invokes that factory and writes only accepted events into the durable outbox. Neither function scans providers or transmits data.

## Explicit context

The factory does not infer:

- repository, project, account or session disclosure;
- tool name or version;
- Metrora adapter version;
- source fingerprint;
- AI/API provider;
- operation name;
- requested model.

The trusted caller supplies those facts. A collector name never implies the AI provider, and a source-recorded provider must agree with the declared provider or the event is withheld.

Workspace and endpoint identities are loaded from protected local state rather than accepted from renderer input.

## Profile-owned evidence

The executable provenance registry owns the reviewed profile and source kind. It resolves token, model, session, reasoning and cost quality per concrete source path.

This prevents estimated content-length fallback from being labelled as measured and prevents a mutable current-price catalog from reinterpreting settled history.

## Immutable cost authority

Workspace production requires the immutable per-call cost assignment.

- compatible provider- or client-metered evidence remains metered;
- compatible token pricing remains an explicit estimated valuation;
- numeric zero remains different from unavailable cost;
- bounded legacy values retain their documented quality;
- missing, malformed or contradictory assignments become unavailable rather than being repriced from the current catalog.

A call can still produce a useful reviewed measurement when cost is unavailable.

## Session disclosure

Session sharing is explicit:

- `omit` publishes no session identifier and keeps session quality unknown;
- `include` requires one concrete non-empty session identifier.

There is no implicit default that can accidentally claim session identity.

## Enqueued, duplicate and withheld

Accepted events pass through the append-only outbox:

- `enqueued` means the immutable record was published for the first time;
- `duplicate` means the same private production identity already exists with identical semantics;
- conflicting reuse of one event or production identity fails closed.

Calls are withheld when the concrete source path is not reviewed, reasoning attribution is unsupported or source-provider evidence conflicts. Withheld calls do not touch the outbox.

## Rotation-safe idempotency

Public event IDs are HMAC-derived and intentionally change after event-key rotation. A private production receipt binds the stable Workspace, endpoint, reviewed profile, source fingerprint and normalized-call identity.

Only the receipt digest is stored. Publishing it before the public event permits deterministic repair after interruption and returns the original event after key rotation instead of creating a duplicate.

Changed tokens, cost, scope, provider or disclosure under the same production identity are rejected.

## Privacy boundary

The event, outbox record and private receipt never serialize:

- raw private deduplication keys;
- prompts, responses, source code or patches;
- tool sequences, commands, filenames or unrestricted local paths;
- endpoint event-identity or signing keys.

Only allowlisted structured measurement fields enter the public contract.

## Current reviewed paths

The executable registry currently admits six concrete paths across four collectors:

- Claude JSONL usage;
- Codex measured token-count records;
- Codex content-length fallback with estimated quality;
- Gemini message usage;
- Zed request token usage with explicit source-recorded provider;
- Zed cumulative-remainder usage with explicit source-recorded provider.

Local collector support does not imply signed-measurement eligibility.

## Responsibility boundary

The factory and one-call producer do not:

- scan provider stores;
- create signed batches or exports;
- schedule retries;
- upload data;
- create accounts or hosted services;
- change collector parsing, token accounting, historical pricing or analytics totals.

Canonical scanning, lifecycle control, batch creation, recovery and export remain separate explicit Workspace responsibilities.
