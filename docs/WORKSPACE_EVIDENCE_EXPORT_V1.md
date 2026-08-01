# Workspace evidence export v1

**Status:** implemented as an explicit local runtime boundary; no uploader or desktop UI is active.

Workspace evidence export v1 turns the existing reviewed outbox and immutable signed-batch chain into a user-owned JSON artifact that can be verified without Metrora, an account, or a server.

## What is reused

The implementation does not introduce a second signer, event format, workspace schema, or analytics store. It reuses:

- the persisted personal `WorkspaceV1`, owner membership, and enrolled endpoint;
- reviewed `UsageMeasurementEventV1` records from the local outbox;
- the existing RFC 8785 batch canonicalization;
- the existing Ed25519 endpoint signer;
- per-batch public keys, identity generations, sequence ranges, and previous-digest chain;
- immutable batch acknowledgements, with private receipt identifiers removed from exports.

Frozen public contract v1 field names and identifiers remain authoritative compatibility data and are not rewritten.

## Workspace authorization

`createNextLocalWorkspaceSignedBatchV1()` loads the local workspace and passes its workspace ID into the existing signed-batch boundary.

Authorization is checked inside batch creation, after the outbox is scanned and while the batch store lease is held:

- every visible outbox event must belong to the enrolled endpoint;
- every visible outbox event must belong to the active personal workspace;
- every existing batch must contain only events from that endpoint and workspace;
- invalid or quarantined outbox state blocks workspace batch creation;
- foreign workspace or endpoint records fail closed;
- no record is silently dropped to make a batch pass.

The generic legacy batch function remains compatible for existing callers, but Workspace v1 always supplies a workspace ID.

## Honest local states

`inspectLocalWorkspaceEvidenceV1()` exposes:

- `workspace-required` — no explicit local workspace exists;
- `empty` — the workspace has no signed evidence yet;
- `ready` — reviewed events still need batching or signed batches remain unacknowledged;
- `acknowledged` — the existing signed chain is fully acknowledged and no reviewed event remains unbatched;
- `quarantined` — a deliberate quarantine decision requires review;
- `blocked` — invalid, foreign, or cryptographically inconsistent state requires recovery.

Counts for pending, unbatched, acknowledged, invalid, quarantined, pending-batch, and acknowledged-batch records accompany the state. A blocked or quarantined state cannot be exported as valid evidence.

## Export envelope

`createLocalWorkspaceEvidenceExportV1()` creates a strict JSON envelope containing only:

- the active personal workspace contract;
- the active owner membership;
- the enrolled endpoint contract and current identity generation;
- the ordered signed-batch chain;
- sanitized pending/acknowledged batch states;
- a recomputable summary;
- an RFC 8785 payload digest;
- an Ed25519 signature from the current endpoint identity.

An explicit output path may be supplied. Publication is atomic and local. The path itself is never embedded in the artifact.

The export refuses to run while reviewed events remain unbatched. This prevents a package from appearing complete while known workspace evidence is still outside the signed chain.

## Independent verification

`verifyLocalWorkspaceEvidenceExportV1()` requires no local Metrora state. It verifies:

1. the strict export and public contract schemas;
2. the RFC 8785 payload digest;
3. the export signature and public-key fingerprint;
4. the match between export signer, endpoint snapshot, and identity generation;
5. every batch digest and Ed25519 signature using the public key embedded in that batch;
6. endpoint and workspace authorization for every event;
7. ordered, non-overlapping sequence ranges;
8. the previous-batch digest chain;
9. sanitized acknowledgement-to-batch binding;
10. the recomputed batch/event summary.

Each batch carries the public key and identity generation that signed it. Old batches therefore remain verifiable after endpoint-key rotation. The export envelope is signed by the current generation and binds the current workspace/endpoint snapshot to the complete included chain.

## Privacy boundary

The export never includes:

- endpoint private signing keys;
- endpoint event-identity/HMAC keys;
- private production-receipt digests;
- raw deduplication keys;
- acknowledgement receipt identifiers;
- prompts, responses, source code, patches, secrets, tool arguments, or unrestricted local paths;
- outbox filenames, private cache paths, or recovery markers.

Only the already allowlisted structured measurement fields inside signed public batches are exported.

## Non-goals

- no automatic provider scan or measurement production;
- no network uploader, synchronization, retry worker, or hosted ingestion;
- no account, invitation, team, entitlement, or billing behavior;
- no Android-side signing, pricing, or collection;
- no collector, parser, token, historical-price, label, or aggregation change;
- no desktop Workspace screens in this tranche.

The next bounded tranche is the desktop Workspace experience: creation, state, coverage, batch/export actions, recovery guidance, and exact reconciliation with canonical local analytics.