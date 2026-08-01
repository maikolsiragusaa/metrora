# Metrora local endpoint identity, outbox and signed batches v1

Status: **desktop vault, local Workspace identity, explicit reviewed production, outbox and signed-batch primitives implemented; automatic collection and network sync remain disabled**.

This layer gives one Metrora installation a durable cryptographic identity, a local personal workspace, a crash-recoverable queue for reviewed usage events and a locally verifiable signed-batch chain.

## Reused foundations

Metrora does not introduce custom cryptographic algorithms or a private JSON canonicalization standard.

- Ed25519 signing, SHA-256, HMAC inputs, AES-256-GCM and secure random generation use Node.js Crypto.
- Desktop secret wrapping uses Electron asynchronous `safeStorage` APIs.
- RFC 8785 canonicalization adapts the Apache-2.0 `erdtman/canonicalize` implementation recorded in `THIRD_PARTY_NOTICES.md`.
- Filesystem durability reuses the temp-file, file-fsync, rename and refresh-lease patterns already proven by the inherited cache.
- No plaintext secret fallback is allowed.

Electron `safeStorage` remains a host concern rather than a dependency of the core. This keeps the future CLI and server hosts free to use another mature OS credential backend without changing endpoint or batch formats.

## Desktop OS vault

The desktop bootstrap initializes local state after `app.whenReady()` and before the existing main module completes startup.

Initially supported vault backends:

- Windows DPAPI through Electron asynchronous `safeStorage`;
- macOS Keychain through Electron asynchronous `safeStorage`.

Linux is deliberately not enabled yet. Metrora does not accept Electron's weak `basic_text` fallback as protection for endpoint signing or HMAC material. A secure Linux Secret Service/keyring adapter can be added later behind the same core interface.

The desktop stores only an OS-encrypted 32-byte master-key envelope under its `userData` directory. The master key protects the endpoint secret through AES-256-GCM and is never returned to the renderer or exposed over IPC. If Electron reports that ciphertext should be re-encrypted after OS key rotation, Metrora atomically rewraps it.

Failure to access or decrypt the OS vault leaves Metrora in its existing local-only mode. It does not generate replacement identity material and does not fall back to plaintext.

## Endpoint identity

`loadOrCreateLocalEndpointIdentityV1()` creates:

- one stable opaque `endpointId`;
- one Ed25519 signing key pair;
- one 32-byte event-identity HMAC key;
- generation and event-key version counters;
- public SPKI key material and SHA-256 fingerprint;
- creation, update and rotation timestamps.

The private PKCS#8 key and event HMAC key live only inside an authenticated AES-256-GCM envelope. The core never derives a weak key from usernames, hostnames or machine identifiers.

### Publication order and recovery

The protected secret is written and fsynced before public metadata. Therefore:

- secret present + metadata missing: metadata is reconstructed safely;
- secret generation newer than public metadata: the interrupted publication is repaired;
- metadata present + secret missing: recovery is required and Metrora fails closed;
- wrong master key, same-generation mismatch or mismatched signing pair: recovery is required;
- concurrent create, repair and rotation operations reuse the cross-process refresh lease.

Metrora never silently generates a replacement identity when evidence shows that an endpoint already existed.

### Rotation

`rotateLocalEndpointIdentityV1()` preserves `endpointId` and creation time while incrementing:

- identity generation;
- event-identity key version.

It generates a new Ed25519 pair and a new HMAC key. Rotation intentionally breaks future public HMAC linkability. Signed batches embed the public key and generation that produced them, so batches from older generations remain independently verifiable.

The local workspace reconciles the new public fingerprint without changing workspace, membership, subject or endpoint IDs. Private production receipts prevent old reviewed calls from being enqueued again under a new public event ID.

## Local personal workspace

`createLocalPersonalWorkspaceV1()` explicitly creates one local personal workspace with:

- an active owner membership bound to a pseudonymous local subject;
- active enrollment of the existing desktop endpoint identity;
- exact public v1 Workspace, Membership and Endpoint records inside a Metrora-owned local container;
- atomic, lease-protected and idempotent publication;
- fail-closed corruption, cross-link, foreign-identity and stale-generation handling.

Loading does not create a workspace implicitly. No server, account or network path is involved.

## Reviewed measurement production

`produceLocalReviewedMeasurementV1()` accepts one already-normalized call plus explicit source/tool/provider/session context. It:

- loads the local workspace and enrolled endpoint;
- invokes only the executable reviewed-provenance boundary;
- uses immutable per-call cost assignments rather than mutable current pricing;
- withholds unreviewed evidence or source-provider conflicts;
- publishes only validated content-minimal `UsageMeasurementEventV1` records;
- returns `enqueued` or `duplicate` through the local outbox;
- performs no scan, automatic hook, signing, upload or retry scheduling.

A supported collector is not automatically eligible. Only an exact reviewed evidence path can produce an event.

## Local measurement outbox

The outbox accepts only validated `UsageMeasurementEventV1` objects. It does not call parsers or transmit data.

```text
<METRORA_DATA_DIR>/outbox/v1/
  next-sequence.json
  events/<sha256(event-id)>.json
  production/<private-production-sha256>.json
  acks/<sha256(event-id)>.json
  quarantine/<sha256(event-id)>.json
```

Event identifiers are hashed for filenames so CloudEvents IDs never become filesystem paths and remain portable on Windows.

### Append-only semantics

- event files are immutable;
- production receipts are immutable private recovery/index records;
- acknowledgements are separate immutable marker files;
- quarantine decisions are separate immutable marker files;
- acknowledgement never deletes or rewrites an event;
- retrying the same event ID and payload returns the existing sequence;
- reusing one event ID for another payload is rejected;
- reusing one private production identity for another semantic event is rejected.

### Rotation-safe production receipts

The event ID is HMAC-derived and intentionally changes after event-key rotation. To preserve repeated-scan idempotency, the reviewed producer also derives a private SHA-256 production key from:

- workspace ID;
- stable endpoint ID;
- reviewed profile ID;
- source fingerprint;
- private normalized-call deduplication key.

The raw private deduplication key is never stored. The production receipt contains the digest, the semantic event digest excluding the rotating public event ID, and the original immutable outbox record.

The semantic comparison also excludes the Metrora adapter release version. A normal application upgrade is not a new measurement. Evidence profile, source identity, scope, disclosure, provider/model facts, token facts and cost remain bound.

The receipt is published before the public event file. Therefore:

- an interruption between receipt and event publication can be repaired;
- reprojection after HMAC-key rotation returns the original event record;
- changed public semantics under the same private production identity fail closed;
- the private production digest is never copied into a public event or signed batch.

### Sequence allocation

The counter is atomically advanced before an event is published. A crash may leave a sequence gap, but a reserved sequence is never reused. The maximum safe-integer value is reserved as an exhaustion sentinel and is rejected before event publication.

### Event digest

The outbox still uses the narrow Metrora local v1 canonicalization contract for event idempotency. It is not advertised as RFC 8785. Interoperable RFC 8785 canonicalization begins at the signed-batch boundary.

The frozen v1 identifier retains its historical value. Changing an already-issued identifier requires a future contract version rather than an in-place rename.

## Signed measurement batches

`createNextSignedMeasurementBatchV1()` selects pending immutable events in sequence order and creates a bounded `MeasurementBatchV1`.

```text
<METRORA_DATA_DIR>/batches/v1/
  signed/<first>-<last>-<batch-sha256>.json
  acks/<sha256(batch-id)>.json
```

Each signed record binds:

- first and last outbox sequence;
- event count;
- RFC 8785 SHA-256 digest of the public batch;
- previous batch digest;
- producer endpoint and Metrora/adapter versions;
- the full public measurement batch;
- signer generation, SPKI public key and fingerprint;
- Ed25519 signature over the RFC 8785 canonical range + digest + batch payload.

The current chain is reconstructed from verified immutable files. There is no mutable head pointer that can advance without publishing a batch. Sequence ranges must not overlap and every batch after the first must bind the exact previous digest.

A signed batch can remain verifiable after endpoint key rotation because it carries its signer public key and fingerprint. The stable endpoint ID still defines chain ownership.

### Batch acknowledgement

Batch acknowledgements are immutable side records. Acknowledging one batch:

- binds the receipt to the batch ID, digest and last accepted sequence;
- idempotently acknowledges each member event with a batch-derived receipt;
- rejects a conflicting receipt;
- never deletes the signed batch or source events.

No server currently issues these receipts. The API is a local contract for the future sync protocol.

## Durability and concurrency

- private directories use restrictive creation modes;
- temp files are created exclusively;
- file contents are fsynced before rename;
- parent-directory fsync is attempted where supported;
- transactions reuse the cross-platform refresh lease with heartbeat and stale-owner takeover;
- stale temp files are cleaned without touching canonical records;
- Windows CI runs identity, workspace, reviewed production, outbox and signed-batch tests plus a real Electron DPAPI probe.

## Explicit non-goals

This tranche does not add:

- automatic event creation during scans;
- CLI keyring setup;
- network transport or hosted sync;
- a retry scheduler;
- a server acknowledgement implementation;
- team enrollment or hosted workspace authentication;
- DSSE/Sigstore packaging;
- compaction or retention deletion;
- repository-path derivation;
- new collector provenance profiles.

## Next safe step

W1.C can bind pending workspace-authorized outbox records into the existing signed-batch chain and create an independently verifiable local export package. Network upload still waits for managed workspace authorization, transport idempotency and server acknowledgement contracts.
