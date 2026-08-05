# Workspace recovery v1

**Status:** implemented as read-only inspection plus a separate explicit non-destructive recovery action.

Workspace recovery validates protected local state, reconciles already-authorized private production receipts and may retry the normal bounded production path. It is not a reset, cleanup command, historical backfill, quarantine bypass or evidence editor.

## Bootstrap inspection versus recovery

Opening Metrora or the Workspace view uses two read paths:

1. a fast bootstrap reads protected Workspace identity and lifecycle state;
2. an automatic read-only inspection loads the complete public evidence summary.

While inspection is pending, the desktop shows an indeterminate verification state rather than false zero counts. Inspection never scans canonical usage, repairs receipts, produces events, creates batches, exports, uploads or changes lifecycle state.

Recovery remains a separate explicit action. The renderer cannot request deletion, reset, source selection, provider changes, time boundaries, historical backfill or evidence replacement.

## Safe recovery path

When a Workspace exists, production is active and current evidence is not blocked or quarantined, recovery performs two bounded operations:

1. reconcile private production receipts with the append-only outbox;
2. retry normal reviewed production from the protected Workspace creation timestamp.

Receipt reconciliation is independent of scanner scope. If an interrupted pass committed a valid private receipt before publishing its public event, recovery can restore that exact event without restarting historical production.

The retry may refresh current source/cache state, inspect only source-present in-scope calls and deduplicate already published measurements.

## Outcomes

The public summary reports one bounded outcome:

- `workspace-required` — no local Workspace exists;
- `paused` — production is paused, so no repair or scan occurs;
- `blocked` — invalid, quarantined or inconsistent evidence prevents mutation;
- `healthy` — no reconciliation was needed;
- `reconciled` — one or more receipts or already-known measurements were preserved without duplication.

The summary exposes only whether retry occurred, a bounded blocker category, receipt-repair count and the ordinary production summary when applicable.

## Fail-closed states

Read-only inspection reports failure without mutation. It never falls back to zero counts and never starts recovery automatically.

Recovery stops before repair and scanning when:

- the Workspace does not exist;
- production is paused;
- evidence is blocked;
- invalid or quarantined evidence is present.

Receipt reconciliation fails closed when filenames, schemas, private production identities, immutable event bytes or semantic digests conflict.

Recovery never:

- deletes invalid, quarantined or valid records;
- clears blockers;
- resets endpoint identity or lifecycle;
- rewrites signed batches or acknowledgements;
- bypasses provenance validation;
- reprices historical usage;
- converts pre-Workspace history into evidence;
- creates a batch, export or upload automatically.

## Desktop boundary

The protected main process owns bootstrap, complete inspection and recovery. The renderer receives public snapshots and bounded summaries only. Raw exceptions, private paths, calls, receipt identities and keys remain private.

Older staged runtimes without the recovery capability return an explicit unavailable result rather than pretending recovery succeeded.

## Persistence and scope

Every desktop session repeats read-only inspection against persisted local state. Normal production and recovery remain scoped from Workspace creation; pre-Workspace history stays available to ordinary Overview analytics.

Tests cover creation, production, pause/resume, receipt reconciliation, batching, export, disposal, reopen, repeated inspection and idempotent recovery.

## Non-goals

Recovery provides no destructive reset, startup mutation, historical backfill, remote support authority, account, team, billing, mobile or alternate collector/pricing behavior.
