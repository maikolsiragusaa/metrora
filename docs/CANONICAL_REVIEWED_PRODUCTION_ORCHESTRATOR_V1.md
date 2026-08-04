# Canonical reviewed-production orchestrator v1

**Status:** implemented core orchestration contract. Canonical scanning and secure desktop integration are implemented as separate boundaries.

This contract converts a trusted set of already-normalized and contextualized local candidates into durable reviewed Workspace measurements. It sits above the existing one-call reviewed producer and below the secure desktop action.

## Authority boundary

The orchestrator accepts candidates only from an injected trusted scanner owned by the canonical parser/cache runtime.

The scanner, not the renderer, provides:

- the exact normalized call, including its immutable historical cost assignment;
- a source-state fingerprint derived by the canonical parser/cache authority;
- source-recorded API/model provider identity where available;
- an explicit session disclosure decision;
- allowed opaque references when policy permits them;
- tool and Metrora adapter versions;
- source-backed operation and request-model context.

The scanner does not select the public reviewed profile ID or source kind. The reviewed event factory derives those fields from the executable provenance registry and normalized call. A candidate that the low-level factory still withholds is a trusted-scanner contradiction and rejects the action.

The renderer action passes no calls, providers, provenance, costs, fingerprints, paths, receipts, keys or evidence claims.

Scanner, IPC and user-interface responsibilities remain in separate modules documented by the scanner and desktop runtime contracts.

## Identity and secret ownership

The orchestrator receives the already-loaded `LoadedLocalEndpointIdentityV1` from the trusted local runtime. It does not accept renderer-controlled endpoint metadata or event keys.

The protected identity object is passed to `produceLocalReviewedMeasurementV1`, which remains authoritative for:

- loading the enrolled local Workspace;
- binding the stable endpoint;
- using the private event-identity key;
- creating or repairing private production receipts;
- appending reviewed events to the durable outbox.

No key or private identity material appears in the public summary.

## Production-control lease

One dedicated production-control lease serializes:

- an explicit reviewed-production pass;
- pause;
- resume.

The lease is separate from the existing Workspace state lease because the low-level producer and receipt/outbox path acquire local-state leases of their own.

Every operation uses the same lock order:

1. production-control lease;
2. Workspace state, receipt and outbox operations.

The local lock keeps same-directory same-process serialization and cross-process lock-file fencing. Its in-process queue is keyed by the resolved lock directory, so one operation can hold the production-control domain while entering distinct Workspace, receipt or outbox domains.

This ordering prevents a pause from racing between lifecycle inspection and evidence publication without introducing nested-lock deadlock.

## Pause enforcement

The orchestrator reads lifecycle state while holding the production-control lease.

When mode is `paused`:

- the scanner is not invoked;
- no candidate is read;
- no production receipt is created or repaired;
- no outbox event is appended;
- the result reports `paused`, `scanned: false` and zero counts.

A pause requested during a running pass waits for that complete atomic pass. Once the pause commits, later production stops before scanning.

Pause never affects collectors, parser caches, ordinary Overview analytics, historical pricing, labels, existing evidence, signed batches or exports.

## Active production

When mode is `active`:

1. the trusted scanner runs once;
2. scanner-owned nonnegative withheld and failed counts are validated;
3. eligible candidates are processed sequentially through `produceLocalReviewedMeasurementV1`;
4. `enqueued` increments the newly produced count;
5. `duplicate` increments the already-existing count;
6. a low-level `withheld` result rejects the action because an eligible candidate contradicted the reviewed registry;
7. existing private receipts make repeated or concurrent passes idempotent.

Sequential processing preserves deterministic local outbox order. Repeated candidates do not duplicate events because receipt and semantic-collision checks remain authoritative.

## Failure semantics

`withheldCount` and `failedCount` describe source-level outcomes classified by the trusted scanner before it emits eligible candidates.

The orchestrator does not catch and downgrade integrity failures from the low-level producer. Ineligible candidates, contradictory provider identity, invalid provenance, semantic collisions, corrupt receipts, outbox corruption, Workspace mismatch and other fail-closed conditions reject the action.

A retry uses the existing receipt-repair protocol. This preserves the distinction between:

- unsupported or unreadable source data that the scanner can count honestly;
- a contradiction or local evidence failure that requires explicit recovery.

## Public summary

The result contains only:

- outcome `paused` or `completed`;
- whether scanning occurred;
- eligible candidate count;
- newly produced count;
- already-existing count;
- scanner-withheld count;
- scanner-failed count.

It contains no normalized calls, tokens, costs, provider or model names, paths, fingerprints, session IDs, opaque references, receipts, keys, prompts, responses, source code, patches, secrets or tool arguments.

The secure desktop runtime exposes this bounded summary together with the refreshed public Workspace snapshot.

## Validation

Blocking tests cover:

- one active pass and bounded scanner counts;
- idempotent replay through private receipts;
- paused mode before scanner invocation;
- pause waiting behind an in-flight pass;
- later passes blocked after pause;
- concurrent production serialization and deduplication;
- same-directory serialization and independent-directory nested locks;
- an ineligible trusted candidate rejecting rather than being hidden in a count;
- malformed scanner counts rejecting before evidence production;
- focused TypeScript checking of lock, lifecycle and orchestration boundaries;
- focused Ubuntu and Windows filesystem and locking execution.

## Non-goals

- no renderer-owned evidence input;
- no automatic background scan or production;
- no automatic batch creation, export, upload or publication;
- no mandatory remote, account, team, billing, mobile or unrelated product behavior;
- no collector, parser, pricing, cache, label or aggregation redesign.
