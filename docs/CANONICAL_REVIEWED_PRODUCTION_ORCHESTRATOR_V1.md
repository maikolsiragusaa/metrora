# Canonical reviewed-production orchestrator v1

**Status:** W1.D.C.B.A core orchestration contract. The canonical parser/cache scanner and desktop production action remain W1.D.C.B.B.

This contract converts a trusted set of already-normalized, already-contextualized local candidates into durable reviewed Workspace measurements. It sits above the existing one-call reviewed producer and below the future secure desktop action.

## Authority boundary

The orchestrator accepts candidates only from an injected trusted scanner owned by the canonical parser/cache runtime.

The scanner, not the renderer, must provide:

- the exact normalized call;
- reviewed collector adapter and source-kind identity;
- source-owned fingerprint;
- source-recorded API/model provider identity where available;
- immutable historical cost assignment already attached to the call;
- allowed opaque session, project, and repository references;
- tool, Metrora, and OpenTelemetry versions.

The future renderer action will pass no calls, providers, provenance, costs, fingerprints, paths, receipts, or evidence claims.

W1.D.C.B.A deliberately does not implement the canonical scanner, IPC action, or user interface. Those belong to W1.D.C.B.B after this mutation boundary is proven independently.

## Production-control lease

One dedicated production-control lease serializes:

- an explicit reviewed-production pass;
- pause;
- resume.

The lease is separate from the existing Workspace state lease because the low-level producer already uses the Workspace lease while publishing private receipts and outbox events.

Every operation uses the same lock order:

1. production-control lease;
2. Workspace state/receipt/outbox operations.

This prevents a pause from racing between lifecycle inspection and evidence publication without introducing a nested-lock deadlock.

## Pause enforcement

The orchestrator reads the durable lifecycle state while holding the production-control lease.

When mode is `paused`:

- the scanner is not invoked;
- no candidate is read;
- no production receipt is created or repaired;
- no outbox event is appended;
- the result reports `paused`, `scanned: false`, and zero counts.

A pause requested during an already-running production waits for that complete atomic pass. Once the pause transition commits, every later production pass stops before scanning.

Pause never affects collectors, parser caches, ordinary Overview analytics, historical pricing, labels, existing evidence, signed batches, or exports.

## Active production

When mode is `active`:

1. the trusted scanner runs once;
2. scanner-owned nonnegative `withheld` and `failed` counts are validated;
3. eligible candidates are processed sequentially through `produceLocalReviewedMeasurementV1`;
4. existing private receipts make repeated or concurrent passes idempotent;
5. the bounded result reports eligible, newly produced, already existing, withheld, and scanner-failed counts.

Sequential processing preserves deterministic local outbox order. Repeated candidates do not duplicate events because the existing private receipt and semantic-collision checks remain authoritative.

## Failure semantics

`withheldCount` and `failedCount` describe source-level outcomes already classified by the trusted scanner.

The orchestrator does not catch and downgrade integrity failures from the low-level producer. Contradictory provider identity, invalid reviewed provenance, semantic collisions, corrupt receipts, outbox corruption, Workspace mismatch, or other fail-closed conditions reject the entire action.

A later retry uses the existing receipt repair protocol. This preserves the distinction between:

- unsupported or unreadable source data that the scanner can count honestly;
- local evidence corruption or contradiction that requires explicit recovery.

## Public summary

The core result contains only:

- outcome `paused` or `completed`;
- whether scanning occurred;
- eligible candidate count;
- newly produced count;
- already-existing count;
- withheld count;
- scanner-failed count.

It contains no normalized calls, tokens, costs, provider names, model names, paths, fingerprints, session IDs, project/repository references, receipts, keys, prompts, responses, source code, patches, secrets, or tool arguments.

W1.D.C.B.B may expose this bounded summary through the secure main-process Workspace runtime after adding the canonical scanner and refreshed public evidence snapshot.

## Validation

Blocking tests cover:

- one active pass and bounded scanner counts;
- idempotent replay through private receipts;
- paused mode before scanner invocation;
- pause waiting behind an in-flight pass;
- later passes blocked after pause;
- concurrent production serialization and deduplication;
- contradictory trusted evidence rejecting rather than being hidden in a count;
- malformed scanner counts rejecting before evidence production;
- focused Ubuntu and Windows filesystem/locking execution.

## Non-goals

- no canonical parser/cache scanner yet;
- no desktop runtime production method, IPC action, preload method, or button;
- no automatic/background scan or production;
- no batch creation, export, upload, synchronization, account, team, billing, Android, Advisor, or Bench behavior;
- no collector, parser, pricing, cache, label, or aggregation redesign.
