# Workspace recovery v1

**Status:** W1.D.C.D local recovery checkpoint, amended by physical Windows acceptance.

Workspace recovery validates protected local state, reconciles already-authorized private production receipts, and may retry one bounded canonical production path. It is not a reset, cleanup command, historical backfill, quarantine bypass, or evidence editor.

## User action

The desktop exposes one explicit zero-argument action:

```text
Check & recover local state
```

Opening Metrora or the Workspace screen never runs recovery automatically.

The renderer cannot request deletion, reset, source selection, receipt selection, provider changes, lifecycle changes, time boundaries, historical backfill, or evidence replacement. Unexpected IPC arguments are ignored.

## Safe recovery path

When the Workspace exists, production is active, and current evidence is not blocked, quarantined, or invalid, recovery performs two bounded operations:

1. reconcile the private production-receipt index with the append-only outbox;
2. run the normal reviewed-production retry scoped from the protected Workspace `createdAt` timestamp.

Receipt reconciliation is independent of the scanner scope. This matters when an older or interrupted production pass wrote a valid private receipt before its corresponding public event file and then stopped. Recovery can republish only that original immutable event without restarting historical production.

The normal retry may safely:

- refresh canonical local source/cache state;
- inspect only source-present calls at or after Workspace creation;
- deduplicate already published in-scope calls;
- return a refreshed public Workspace snapshot.

The receipt is authoritative for interrupted publication. Recovery never generates a competing identity or a second semantic event for the same production key.

## Outcomes

The public summary reports one outcome:

- `workspace-required` — no local Workspace exists; no state is created;
- `paused` — production is paused; no receipt repair, scan, or mutation occurs;
- `blocked` — evidence is invalid, quarantined, or otherwise blocked; no repair or retry occurs;
- `healthy` — neither receipt publication nor in-scope production required reconciliation;
- `reconciled` — one or more private receipts were republished or already-known in-scope production was preserved without duplication.

The summary also states:

- whether the bounded retry was attempted;
- a bounded blocker category;
- `receiptRepairCount`, an integer count only;
- the ordinary bounded production summary when a retry occurred.

It contains no calls, token values, model/provider details, paths, fingerprints, deduplication identities, receipt IDs, keys, prompts, responses, code, patches, secrets, or tool arguments.

## Fail-closed states

Recovery stops before receipt reconciliation and scanning when:

- the Workspace does not exist;
- production is paused;
- public evidence is blocked;
- any invalid event is present;
- any quarantined evidence is present.

Receipt reconciliation fails closed when:

- a receipt filename is malformed or disagrees with its private production key;
- a receipt cannot be parsed through the strict schema;
- its immutable event or semantic digest conflicts with canonical evidence;
- reconciliation produces contradictory event counts.

Recovery does not:

- delete invalid or quarantined records;
- clear blockers;
- reset endpoint identity or keys;
- reset lifecycle revision or pause state;
- rewrite signed batches or acknowledgements;
- remove valid receipts or outbox events;
- bypass source/provider/provenance validation;
- reprice historical usage;
- convert pre-Workspace analytics history into evidence;
- create a batch, export, upload, or publish automatically.

A scanner, receipt, outbox, Workspace, lifecycle, or evidence integrity error remains a bounded failure requiring explicit review. It is not downgraded to success.

## Desktop boundary

The protected main-process runtime owns recovery. Electron exposes only the zero-argument action and returns the bounded recovery summary plus refreshed public snapshot.

Older staged runtimes without the capability return `workspace-recovery-unavailable`. Raw exceptions and local paths never cross IPC.

## Complete local flow

Blocking tests validate the persisted local sequence:

1. create Workspace;
2. produce one reviewed event at or after Workspace creation;
3. pause production;
4. verify recovery stops before receipt repair or scanning;
5. resume production;
6. reproduce idempotently through the existing receipt;
7. create one signed batch;
8. export one independently verifiable package;
9. dispose and zero private identity buffers;
10. reopen the same endpoint and Workspace;
11. recover/deduplicate without a second event or batch;
12. export the same one-event chain again.

A separate interruption test removes only the public event file after its private receipt commits, then makes the bounded source retry return no candidate. Recovery still restores the original event and sequence directly from the receipt. A second recovery performs zero repairs.

## Historical scope

Normal Produce and Recovery do not backfill pre-Workspace history. That history remains available to canonical Overview analytics.

A future historical evidence import, if approved, must be a separate explicit action with a visible scope, progress, cancellation, resumable checkpoints, deterministic ordering, and an estimate before mutation.

## Non-goals

- no destructive repair or reset;
- no automatic startup recovery;
- no normal-action historical backfill;
- no remote recovery service, support backdoor, hosted queue, or cloud receipt;
- no account, team, entitlement, billing, Android, Advisor, or Bench behavior;
- no collector, pricing, label, or aggregation redesign.
