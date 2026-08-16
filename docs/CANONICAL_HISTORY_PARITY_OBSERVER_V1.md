# Canonical history parity observer v1

## Status

Implemented as a non-authoritative diagnostic boundary.

The parity observer validates one canonical history read projection against the two current local authorities before that projection may advance the removable shadow store.

It does not change what Metrora reports, display a new history surface, or make the shadow store a product dependency.

## Invocation boundary

The observer runs after the generic analytics lifecycle has:

1. completed the ordinary fresh session-cache refresh;
2. finalized a complete current-version SessionCache v8;
3. finalized a complete, watermark-trusted DailyCache v19.

The analytics publisher supplies the already-completed in-memory authorities
and a local analytics-history scope. It performs no Workspace creation,
evidence acceptance, disclosure, candidate generation, source discovery, or
second parse. The reviewed-production scanner may trigger the same publisher,
but does not own this publication boundary.

Renderer code cannot supply:

- session or daily cache payloads;
- source paths;
- provider identities;
- deduplication keys;
- observations or activity groupings;
- cost assignments;
- shadow-store records.

## Independent parity checks

### Observation parity

The observer independently walks the current session cache and derives one expected path-free observation payload for every endpoint-scoped source fingerprint.

It compares those expected payloads with the projection by identity and canonical RFC 8785 content.

The comparison covers:

- collector and model identity;
- timestamp;
- token accounting;
- immutable cost assignment and numeric cost state;
- explicit unavailable cost;
- estimation state;
- speed.

Exact duplicate source records are counted once. Reuse of one source identity with a conflicting payload fails closed.

The cache section name is interpreted through the explicit storage-namespace
authority used by the projection. Ordinary sections preserve their name as the
collector; the internal Copilot journal and CLI-resume namespaces both map to
the canonical collector `copilot`. An unregistered mismatch is an integrity
failure, not a reason to trust the call field.

### Activity parity

The observer independently reconstructs the activity partition as ordered sets of observation identities anchored to collector and turn timestamp.

It requires:

- every projected observation to belong to exactly one activity;
- no activity to reference an absent observation;
- no duplicate or conflicting activity payload;
- the projected partition to equal the partition derived from the session cache.

The observer does not expose private session identifiers.

### Daily-history parity

The observer independently removes project paths from the trusted daily cache and compares the complete canonical daily payload with the projection.

This comparison includes:

- headline totals;
- token totals;
- models and categories;
- provider slices;
- project statistics without paths;
- carried-history markers;
- the timezone used for day bucketing.

The observation collection and daily snapshots remain separate authorities and are never added together.

When a live turn extends an existing activity, the shadow reconciliation marks
the activity as `revised`. This is a projection revision only: observations
remain source-identity stable, daily totals remain a separate non-additive
authority, and the observer does not add a second accounting record.

## Publication rule

The order is strict:

1. validate current cache versions and trust;
2. build the read projection;
3. prove observation, activity and daily parity;
4. persist the projection through the canonical shadow store.

A parity mismatch therefore cannot advance the shadow head.

A successful result records only:

- projection digest;
- shadow publication outcome;
- entity counts;
- reconciliation counts;
- the non-additive authority marker.

## Failure behavior

Parity is diagnostic, not a production gate.

When the observer is invoked through reviewed production:

- a mismatch or shadow-store integrity error leaves current analytics and reviewed production unchanged;
- a generic sanitized warning is written to stderr;
- the detailed exception is not copied into renderer, public event, report or telemetry output;
- a diagnostic reporter failure is also prevented from becoming a production failure.

An incomplete or untrusted daily cache does not mint a shadow snapshot. A later trusted refresh retries the observation through the same bounded path.

## Privacy boundary

The observer and shadow store do not persist:

- prompts or responses;
- source code or patches;
- source or project paths;
- private session identifiers;
- private deduplication material;
- commands, tool inputs or tool arguments;
- secrets.

Endpoint-scoped source fingerprints remain the public observation identity.

## Authority boundary

Current product authority remains unchanged:

- session cache: source-present normalized call materialization;
- trusted daily cache: durable daily totals and carried aggregate-only history;
- canonical history shadow: removable diagnostic snapshots only;
- CLI terminal status reads only the bounded, generation-sealed headline index
  when same-generation parity passes; all other CLI and desktop/report
  surfaces remain legacy-owned.
- Workspace, Android and APIs: no reads from the shadow store.

Deleting the complete `history-shadow/v1` directory must leave current product behavior unchanged.

## Deferred work

This observer does not authorize:

- consumer parity claims based on real-world observation duration;
- additional CLI or desktop consumer cutover beyond the bounded terminal headline;
- replacement of session or daily caches;
- migration or historical backfill;
- database introduction;
- remote sync, accounts, billing or managed infrastructure.
