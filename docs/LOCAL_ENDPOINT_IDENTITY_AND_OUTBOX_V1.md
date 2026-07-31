# Qovrion local endpoint identity and outbox v1

Status: **implemented local primitives; not wired into normal collection or sync**.

This tranche gives one Qovrion installation a durable cryptographic identity and a crash-recoverable local queue for reviewed usage events.

## Reused foundations

Qovrion does not introduce a custom cryptographic algorithm or database engine here.

- Ed25519 signing, SHA-256, HMAC inputs, AES-256-GCM and secure random generation use Node.js Crypto.
- Filesystem durability reuses the same temp-file, file-fsync and rename publication pattern already proven by the session cache.
- The desktop host is expected to protect the 32-byte master key with Electron `safeStorage` asynchronous APIs. Other hosts may provide an OS keyring-backed master key without changing the identity format.
- No plaintext fallback is allowed by the local identity API.

Electron `safeStorage` is deliberately a host concern rather than a dependency of the core. This keeps the CLI and future server endpoint free to use another mature OS credential backend while preserving the same protected payload.

## Endpoint identity

`loadOrCreateLocalEndpointIdentityV1()` creates:

- one stable opaque `endpointId`;
- one Ed25519 signing key pair;
- one 32-byte event-identity HMAC key;
- generation and event-key version counters;
- public SPKI key material and SHA-256 fingerprint;
- creation, update and rotation timestamps.

The private PKCS#8 key and event HMAC key live only inside an authenticated AES-256-GCM envelope. The caller supplies the 32-byte master key through `SecretProtector`; the core never derives a weak key from username, hostname or machine identifiers.

### Publication order and recovery

The protected secret is written and fsynced before public metadata. Therefore:

- secret present + metadata missing: metadata is reconstructed safely;
- metadata present + secret missing: recovery is required and Qovrion fails closed;
- wrong master key or mismatched signing pair: recovery is required;
- concurrent create/repair/rotate operations are serialized by a short cross-process file lock.

Qovrion never silently generates a replacement identity when metadata indicates that an endpoint already existed.

### Rotation

`rotateLocalEndpointIdentityV1()` preserves `endpointId` and creation time while incrementing:

- identity generation;
- event-identity key version.

It generates a new Ed25519 pair and a new HMAC key. Rotation intentionally breaks future HMAC linkability while previously-created immutable event IDs and signatures remain self-contained.

## Local measurement outbox

The outbox accepts only validated `UsageMeasurementEventV1` objects. It does not call parsers, create events or transmit data.

Layout:

```text
<QOVRION_DATA_DIR>/outbox/v1/
  next-sequence.json
  events/<sha256(event-id)>.json
  acks/<sha256(event-id)>.json
  quarantine/<sha256(event-id)>.json
```

Event identifiers are hashed for filenames so CloudEvents IDs never become filesystem paths and remain portable on Windows.

### Append-only semantics

- event files are immutable;
- acknowledgements are separate immutable marker files;
- quarantine decisions are separate marker files;
- acknowledgement never deletes or rewrites an event;
- retrying the same ID and payload returns the existing sequence;
- reusing one ID for another payload is rejected.

### Sequence allocation

The counter is atomically advanced before an event is published. A crash may therefore leave a sequence gap, but a reserved sequence is never reused. Gaps are valid and must not be interpreted as missing billable usage without checking the local recovery state.

### Durability and concurrency

- private directories use restrictive creation modes;
- temp files are created exclusively;
- file contents are fsynced before rename;
- parent-directory fsync is attempted where supported;
- short transactions use an exclusive cross-process lock with stale-lock recovery;
- stale temp files are cleaned without touching canonical records.

### Canonical event digest

The outbox hashes a deterministic sorted-key JSON representation named `qovrion-sorted-json-v1`. It is intentionally not advertised as RFC 8785. The public event schema currently contains only values that this narrow canonicalizer supports: objects, arrays, strings, booleans, null and safe integers.

RFC 8785/DSSE belongs to the later signed-batch boundary, where interoperability justifies adopting a complete implementation.

## Explicit non-goals

This tranche does not add:

- automatic event creation during scans;
- an Electron `safeStorage` master-key bridge;
- CLI keyring setup;
- network transport or hosted sync;
- batch creation;
- acknowledgements from a server;
- compaction or retention deletion;
- DSSE, Sigstore or RFC 8785 signing;
- repository-path derivation;
- new collector provenance profiles.

## Next safe step

The next bounded integration is a desktop-host master-key provider using Electron asynchronous `safeStorage`, with an explicit refusal of Linux `basic_text` storage. After that, the reviewed event factory may enqueue locally behind an opt-in feature flag. Network sync still waits for batch, acknowledgement and enrollment contracts.
