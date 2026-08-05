# Metrora local endpoint identity, outbox and signed batches v1

**Status:** implemented for the local personal Workspace. Automatic upload, hosted synchronization and server acknowledgement are not active.

This component gives one Metrora installation a durable cryptographic identity, a crash-recoverable reviewed-measurement outbox, an immutable signed-batch chain and independently verifiable local export.

## Cryptographic and storage foundations

Metrora uses established platform and library primitives rather than custom cryptography:

- Ed25519, SHA-256, HMAC, AES-256-GCM and secure randomness from Node.js Crypto;
- Electron asynchronous `safeStorage` for desktop secret wrapping;
- RFC 8785 canonicalization for interoperable signed-batch and export boundaries;
- atomic private-file publication with fsync, rename and cross-process leases.

No plaintext fallback is allowed for endpoint signing or event-identity material.

## Desktop vault boundary

The desktop host supports:

- Windows DPAPI through Electron `safeStorage`;
- macOS Keychain through Electron `safeStorage`.

Linux Workspace signing remains unavailable until an acceptable secure credential backend is implemented. Vault failure disables Workspace actions without blocking ordinary local analytics or creating replacement identity material.

The desktop stores an operating-system-encrypted master-key envelope under its private local state. The master key protects the endpoint secret and never crosses into the renderer.

## Endpoint identity

A local endpoint owns:

- one stable opaque endpoint ID;
- one Ed25519 signing key pair;
- one 32-byte event-identity HMAC key;
- identity-generation and event-key version counters;
- public key material, fingerprint and lifecycle timestamps.

Private keys remain inside an authenticated AES-256-GCM envelope. They are never derived from usernames, hostnames or machine identifiers.

Publication is ordered so interrupted creation or rotation can be repaired without silently replacing a known identity. Missing or contradictory secret state fails closed.

Rotation preserves the endpoint ID while changing signing and event-identity keys. Existing signed batches remain verifiable because each batch records the signer generation and public key that produced it.

## Local personal Workspace

Workspace creation is explicit. Loading local state does not create a Workspace implicitly.

The local container binds:

- one personal Workspace;
- one active owner membership;
- the existing protected endpoint identity;
- versioned public Workspace, Membership and Endpoint records.

Creation and reload are lease-protected, atomic and idempotent. No account, remote service or network operation is required.

## Reviewed measurement production

Reviewed production accepts only normalized calls admitted by the executable provenance registry. It preserves immutable historical cost assignments and publishes only validated, content-minimal measurement events.

A registered collector is not automatically eligible for signed measurements. Unreviewed, contradictory or insufficient evidence is withheld rather than converted into an optimistic claim.

Production is an explicit Workspace action. Opening Metrora or the Workspace view does not scan sources or create events.

## Local outbox

The outbox stores immutable measurement events and separate side records:

```text
<METRORA_DATA_DIR>/outbox/v1/
  next-sequence.json
  events/<sha256(event-id)>.json
  production/<private-production-sha256>.json
  acks/<sha256(event-id)>.json
  quarantine/<sha256(event-id)>.json
```

Core rules:

- event files and production receipts are immutable;
- acknowledgements and quarantine decisions never rewrite events;
- retrying the same identity and payload is idempotent;
- conflicting reuse of an event or production identity fails closed;
- sequence numbers are reserved before publication and never reused;
- filenames contain hashes rather than raw event identifiers or local paths.

## Rotation-safe production receipts

Public event IDs intentionally change when the event-identity key rotates. A separate private production receipt preserves repeated-scan idempotency across rotation.

The receipt binds the Workspace, stable endpoint, reviewed profile, source fingerprint and private normalized-call identity. Only a digest is stored; raw private deduplication material is never written into public events, batches or exports.

Publishing the receipt before the public event permits deterministic repair after interruption without creating a second semantic measurement.

## Signed measurement batches

Pending events are selected in sequence order and bound into immutable signed batches. Each signed record includes:

- first and last outbox sequence;
- event count;
- RFC 8785 payload digest;
- previous-batch digest;
- producing endpoint and adapter versions;
- signer generation, public key and fingerprint;
- Ed25519 signature.

The chain is reconstructed from verified immutable files rather than a mutable head pointer. Sequence ranges cannot overlap, and every later batch must bind the exact preceding digest.

Batch acknowledgements are immutable side records. No server currently issues them.

## User-owned evidence export

The local Workspace can export a bounded JSON package containing the public Workspace, enrolled endpoint and complete included signed-batch chain.

Independent verification checks schemas, digests, sequence ranges, chain links, embedded public keys, signatures and Workspace/endpoint binding.

The export excludes:

- private keys and event-identity keys;
- private production receipts and acknowledgement receipt IDs;
- prompts, responses, source code, patches and secrets;
- raw tool arguments and unrestricted local paths.

Creating an export does not authorize upload, indexing, retention or remote processing.

## Recovery and durability

Private writes use restrictive directories, exclusive temporary files, fsync where supported, atomic rename and cross-process leases. Known interrupted publication can be reconciled without deleting valid evidence or generating a replacement identity.

Malformed, foreign, conflicting, quarantined or cryptographically inconsistent state remains blocked for explicit review.

## Current limits

This component does not provide:

- automatic background production;
- network transport or hosted synchronization;
- a retry scheduler or server acknowledgement issuer;
- account, team, tenant, entitlement or billing behavior;
- remote recovery or lifecycle control;
- destructive compaction or retention deletion.

Ordinary local collection, analytics and export remain usable without a Workspace or remote service.
