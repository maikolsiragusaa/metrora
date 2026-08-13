# Metrora CLI status C3 dual-read v1

## Problem

Metrora needs a fast, fail-safe read boundary for the compact terminal
headline while preserving the existing legacy status result as the immediate
authority. C3 rendering is an optional parity-gated projection of that result.

## Current publication ownership

Canonical analytics history is published only by explicit Metrora-owned
analytics triggers. The generic publisher consumes the completed in-memory
SessionCache v8 and DailyCache v18 objects and calls the existing projection,
parity observer, and shadow-store contracts. It owns no Workspace creation,
evidence acceptance, disclosure, or reviewed-production candidate authority.

`buildDurablePeriod()` is a legacy analytics builder. It does not publish,
rebuild, reconcile, persist, or deep-validate canonical history. Ordinary
terminal status therefore does not synchronously publish C3.

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

The generic publication boundary binds a C3 head to the exact SessionCache
payload digest, DailyCache payload digest, source manifest digest, projection
digest, snapshot digest, and headline-index digest that completed together.
That metadata remains useful to deep readers and later publication triggers;
it is not a freshness claim made by the terminal consumer.

Snapshot mode remains legacy-only for this tranche. It performs no C3
publication or terminal C3 read and does not mutate shadow state.

## Read cost

The canonical projection remains the accounting authority. The compact,
content-addressed headline index is derived during publication and is bound to
the projection digest, snapshot seal, index kind/version, and its own content
digest.

The terminal path reads only the small `head.json` seal, the compact headline
index, and snapshot-file metadata (`stat`). It does not open or hash the
canonical snapshot, parse the full projection, reconcile retained history,
discover providers, invoke parsers, hydrate daily state, serialize caches, or
hash current cache generations. The canonical snapshot is still checked for
existence; its content hash remains a full-validation concern.

An older persisted C3 index is harmless: if its supported Today/Month tuple
matches the just-computed legacy tuple, the terminal may render the compact
result. If source activity advanced and the tuple differs, legacy wins. C3 is
not an independent accounting authority on this path.

Timings from a small synthetic soak are not representative of a large local
user corpus. Large-corpus checks must record the session-cache and canonical
snapshot sizes and separate legacy status, no-C3 status, parity-gated C3
status, mismatch fallback, and one bounded headline/index read. Publication
performance is a separate follow-up; it must not block ordinary interactive
status.

The fast reader fails closed on missing or malformed head/index state, missing
snapshot files, head/index projection or snapshot-seal mismatch, unsupported
versions, invalid queries, unsupported providers or filters, timezone mismatch,
and incomplete requested periods. It intentionally does not claim to detect
in-place corruption of snapshot bytes without opening them; the full canonical
reader remains the deep integrity path, and the terminal result remains gated
by parity with the current legacy tuple.

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
renderable only when the compact artifact is valid and the diagnostic parity
result is an exact match. The visible result remains the legacy result
otherwise. The read boundary remains removable: future work can change or
remove the C3 projection without changing the legacy accounting contract.
