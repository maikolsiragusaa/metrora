# Canonical history shadow store v1

**Status:** C3-P0.B endpoint-local shadow persistence; no consumer authority.

The shadow store persists successive outputs of the [canonical history read projection v1](CANONICAL_HISTORY_READ_PROJECTION_V1.md) so identity stability, retention and reconciliation can be tested across refreshes and source expiry.

It does not replace the session cache, daily cache, reports, Workspace evidence or any user-visible read path.

## Storage layout

The store uses the canonical private Metrora data directory:

```text
history-shadow/
└── v1/
    ├── head.json
    └── snapshots/
        └── <projection-sha256>.json
```

Each snapshot is immutable and content-addressed by an RFC 8785 canonical digest of the complete projection.

The head is a small atomic pointer to the latest accepted snapshot.

## Publication order

A distinct projection is published in this order:

1. validate the projection version, authority boundary and privacy constraints;
2. load and validate all retained snapshots;
3. reject identity conflicts against retained history;
4. write the immutable content-addressed snapshot atomically;
5. advance the head atomically.

If the process stops after step 4, the next identical call recognizes the existing snapshot and repairs the missing head.

A head that points to a missing or invalid snapshot is an integrity failure. It is not treated as an empty store.

## Idempotence and retention

Writing the same projection again is a no-op:

- no second snapshot is created;
- the head timestamp is not rewritten;
- observation, activity and daily-snapshot identities reconcile as unchanged.

When a distinct projection becomes current:

- the previous snapshot remains on disk;
- the head advances to the new digest;
- reconciliation reports identities that were added, unchanged or retained only in the previous head.

Retained-only observations or activities are not silently copied into the new projection. Their earlier immutable snapshot remains available for later C3 reconciliation work.

## Historical conflict detection

Before accepting a new projection, the store scans all retained snapshots.

One observation, activity or daily-snapshot identity may not resolve to different canonical payloads anywhere in retained shadow history.

A conflicting reuse fails closed and does not advance the head.

This rule still applies when the conflicting identity disappeared from the immediately previous head and reappears later.

## Privacy boundary

The store accepts only the content-minimal projection contract.

It rejects persisted objects containing private source material such as:

- source or project paths;
- private session identifiers;
- private deduplication keys;
- prompts or responses;
- commands or tool arguments.

The shadow files contain hashed observation and activity identities, normalized accounting evidence and path-free trusted daily snapshots. They are local private state and are not export or synchronization contracts.

## Current authority

C3-P0.B is mechanically non-authoritative for product consumers:

- session cache remains the source-present parse materialization;
- trusted daily cache remains the historical totals authority;
- CLI, desktop, Workspace and Android do not read the shadow store;
- removing `history-shadow/v1` does not change existing product behavior.

The store is evidence for future parity and migration decisions, not a migration itself.

## Failure and recovery

The store fails closed for:

- unsupported projection or store versions;
- invalid authority metadata;
- malformed or duplicate identities;
- invalid canonical JSON;
- digest mismatch;
- unexpected snapshot files;
- corrupt head metadata;
- missing head targets;
- conflicts with any retained snapshot.

Atomic temporary files use the existing local-state cleanup and Windows mutation retry behavior.

No automatic deletion, compaction or destructive repair is performed in v1.

## Non-goals

This tranche does not provide:

- a database or SQLite schema;
- session-cache or daily-cache migration;
- automatic backfill;
- unioned canonical consumer reads;
- CLI, desktop, Workspace or Android cutover;
- server ingestion or synchronization;
- account, billing or managed infrastructure;
- a second parser, pricing or evidence engine.

A later tranche must prove consumer parity, rollback and state-preserving migration before any current authority can change.
