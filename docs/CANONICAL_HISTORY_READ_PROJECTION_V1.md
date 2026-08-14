# Canonical history read projection v1

**Status:** C3-P0.A implemented shadow read contract within progressive migration. The separately derived, parity-gated terminal headline is the first bounded production consumer; this projection remains non-authoritative for other consumers.

This contract makes source-observation and activity identity explicit while the existing trusted daily cache remains authoritative for user-visible historical totals.

It is deliberately read-only. It does not create a database, migrate a cache, change reports or authorize synchronization.

## Authorities

The projection exposes three separate collections:

1. **observations** — path-free identities and content-minimal accounting evidence derived from the complete current session cache;
2. **activities** — deterministic groupings of source-observed calls derived from the canonical collector, private session identity, source timestamp and the first source-record fingerprint;
3. **daily snapshots** — sanitized copies of the trusted complete daily cache, including carried history that can no longer be reconstructed from source files.

Observation and activity collections are shadow authorities in v1. Daily snapshots remain the totals authority.

These collections are **not additive**. A source-backed observation may also be represented inside a daily snapshot. Consumers must not sum observations and daily snapshots.

## Observation identity

The projection reuses `canonicalSourceRecordFingerprintSha256V1`, the same endpoint-scoped, path-free source-record identity already used by reviewed production.

The fingerprint is derived from:

- protected endpoint identity;
- canonical collector identity;
- the collector's private deduplication key.

The session-cache section name is a storage/parser namespace, not automatically
the public collector identity. Ordinary sections use the same name for both.
The current internal Copilot journal and CLI-resume lanes are explicitly
registered exceptions: their storage namespaces remain versioned cache
authorities while their canonical collector identity is `copilot`. Any other
namespace/provider mismatch fails closed.

The local source path and private deduplication key are not emitted. The endpoint scope prevents identical copied source records on different endpoints from becoming a public cross-device correlation handle.

One fingerprint may resolve to only one observation representation. Conflicting reuse fails closed.

## Activity identity

An activity groups the ordered observations emitted by one cached turn.

Its identity is derived from:

- protected endpoint identity;
- canonical collector identity;
- private session identity;
- source-observed turn timestamp;
- the first observation fingerprint.

Private session identity is hashed and never emitted. Local day, timezone, cache version and file path are not activity-identity inputs.

A timezone change may therefore move a daily snapshot boundary without changing observation or activity identity.

The activity identity is a stable logical source identity, not an immutable
payload digest. A live turn may receive more source observations between two
projection snapshots. Such a revision is valid only when the new ordered
observation list preserves the previous list as an exact prefix. The current
head represents the current activity projection; earlier content-addressed
snapshots remain immutable audit evidence. A reordered, shortened or otherwise
conflicting activity payload fails closed, as does a conflicting observation
payload under an existing observation identity.

## Accounting evidence

Each observation preserves:

- collector;
- source timestamp;
- model and explicit source-recorded model provider when available;
- normalized token usage;
- immutable cost assignment;
- numeric canonical cost only when the assignment is settled;
- legacy comparison cost when already retained by the session cache;
- estimated-cost marker and speed class.

`explicit-zero` remains numeric zero. `unavailable` remains `null` and is never converted into an intentional zero. Mismatched cost evidence fails closed.

The projection does not reprice calls and does not introduce a second pricing engine.

## Retained history

Source files may expire while their history remains preserved in the daily cache. C3-P0.A keeps that history as a daily snapshot, including the `carried` marker.

It does not invent source observations, activities, sessions or project assignments from aggregate-only history.

Project paths are removed from snapshots. Existing local project keys and numeric rollups remain available for local reconciliation, while unavailable historical project detail stays unavailable.

## Integrity requirements

The projection requires:

- the current session-cache version;
- a complete session cache;
- the current daily-cache version;
- a complete daily cache;
- a trusted daily watermark;
- valid timestamps;
- explicit storage-namespace/canonical-collector agreement;
- non-empty private source and session identities;
- internally consistent immutable cost assignments.

Unknown, stale, incomplete or contradictory state fails closed.

## Privacy boundary

The projection omits:

- source paths;
- project paths;
- private deduplication keys;
- private session identifiers;
- prompts and responses;
- commands, tool inputs, source code and patches;
- endpoint secrets and receipt material.

It remains an endpoint-local internal projection. No export or remote transport is authorized by this contract.

## Non-goals

C3-P0.A does not provide:

- persistent canonical-history storage;
- cache-schema changes;
- migration or backfill;
- report, desktop, Workspace or Android cutover beyond the bounded terminal headline;
- server ingestion or synchronization;
- account, team, billing or managed infrastructure;
- a second collector, parser, pricing or evidence implementation.

A later migration tranche must prove consumer-specific parity and rollback independently before any additional consumer can change authority.
