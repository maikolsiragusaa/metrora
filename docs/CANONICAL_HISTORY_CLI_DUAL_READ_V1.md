# Metrora CLI status C3 dual-read v1

## Problem

Metrora needs a fast, fail-safe read boundary for the compact terminal
headline while preserving the existing status authority until a persisted C3
head is proven current against the local cache and live source set.

## Current publication ownership

Canonical analytics history is published by the generic analytics lifecycle at
the end of `buildDurablePeriod()`, after the ordinary fresh session refresh and
trusted daily hydration have completed. The publisher consumes the completed
in-memory SessionCache v8 and DailyCache v18 objects and calls the existing
projection, parity observer, and shadow-store contracts. It owns no Workspace
creation, evidence acceptance, disclosure, or reviewed-production candidate
authority.

The reviewed-production scanner remains a consumer/trigger for Workspace and
reuses the same generic publisher. It is not the owner of canonical analytics
history publication.

Terminal status has a bounded C3 dual-read boundary for the proven headline
subset. JSON, menubar-json, sessions, models/detail, projects, savings/plans,
and unsupported filters remain legacy-owned.

## Proven C3 subset

The derived headline index contains only query-safe aggregates for cost,
calls, input tokens, output tokens, cache reads, and cache writes. It does not
represent project attribution, savings, plans, timeline data, sessions, or
combined-device data.

The candidate terminal subset is bounded to today/month ranges, all providers
or complete provider slices, the current local timezone, no project or exclude
filter, and retained historical days covered by the index plus current
activity. Unsupported queries return to legacy.

## Point-in-time generation boundary

Each cache save hashes the exact serialized payload bytes already materialized
for the atomic write. After the cache rename, Metrora writes a private adjacent
generation stamp containing the cache schema, payload digest, completeness, and
for session cache the source fingerprint manifest. A missing or stale stamp is
not current. The ordering also makes a concurrent or interrupted write fail
closed: a new payload cannot be authorized by an older stamp.

On read, the saved file identity is used only as an early rejection for an
obviously different atomic file; the exact payload digest is still verified
before a generation is accepted. A single timestamp, size, or inode is never
freshness proof.

The source manifest stores one-way path digests and file fingerprints locally;
raw source paths, session identifiers, deduplication keys, prompts, and content
are not part of C3 history. These generation identifiers are freshness
evidence only. They are not observation identity, activity identity, public
history identity, cross-device identity, or an accounting authority.

The accepted C3 head is a point-in-time authority generation. It is bound to
the exact SessionCache payload digest, DailyCache payload digest, source
manifest digest, projection digest, snapshot digest, and headline-index digest
that completed together. Provider bytes written after that generation do not
invalidate the already-completed generation. The next normal fresh lifecycle
decides whether a refresh is required and publishes a new generation; the C3
read path does not run a second discovery race.

Snapshot mode performs no discovery, provider refresh, or publication. It reads
only the last accepted analytics generation and uses it only when its cache
authority generation still matches the accepted snapshot.

## Read cost

The canonical projection remains the accounting authority. The compact,
content-addressed headline index is derived during publication and is bound to
the exact projection digest and immutable snapshot bytes. Standalone reads
without a trusted expected generation hash current cache bytes and preserve the
existing source-freshness checks. A read carrying the exact generation from the
same completed lifecycle validates the index/shadow binding to that generation
without rereading current cache bytes. The index can always be regenerated from
the projection and cannot replace it.

Timings from a small synthetic soak are not representative of a large local
user corpus. Large-corpus checks must record the session-cache and canonical
snapshot sizes and separate legacy refresh, C3 publication, and one validated
headline/index read. These measurements are evidence for the reviewed change,
not an arbitrary correctness target. The existing legacy fallback remains the
only user-visible path until a stable real hit is observed.

## Floating-point contract

Counts and token totals require exact equality. Diagnostic terminal cost parity
uses the existing `formatCost` display boundary, which preserves the legacy
user-visible result when independently ordered floating-point sums differ only
below that boundary. Machine-readable JSON remains legacy-owned, so C3 does not
change its numeric contract.

## Result and first consumer

The boundary returns one of:

- `C3_SUPPORTED_MATCH`
- `C3_SUPPORTED_MISMATCH`
- `C3_UNAVAILABLE`
- `C3_UNSUPPORTED_QUERY`

Every unavailable, stale, unsupported, or integrity-invalid C3 result selects
the unchanged legacy status path. For supported terminal queries, C3 becomes
primary only when the index generation matches the same lifecycle generation
that produced the legacy tuple and the diagnostic parity result is an exact
match. The read boundary remains removable: future work can remove the legacy
aggregation after sufficient soak without changing the C3 authority contract.
