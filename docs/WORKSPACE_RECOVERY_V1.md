# Workspace recovery v1

**Status:** W1.D.C.D local recovery checkpoint.

Workspace recovery validates protected local state and may retry one known, idempotent publication path. It is not a reset, cleanup command, quarantine bypass, or evidence editor.

## User action

The desktop exposes one explicit zero-argument action:

```text
Check & recover local state
```

Opening Metrora or the Workspace screen never runs recovery automatically.

The renderer cannot request deletion, reset, source selection, receipt selection, provider changes, lifecycle changes, or evidence replacement. Unexpected IPC arguments are ignored.

## Safe recovery path

When the Workspace exists, production is active, and current evidence is not blocked, quarantined, or invalid, recovery invokes the same canonical reviewed-production path used by the explicit Produce action.

That path may safely:

- re-read source-present canonical calls;
- find an existing private production receipt;
- restore an event file whose publication was interrupted after the receipt committed;
- deduplicate an already published call;
- return a refreshed public Workspace snapshot.

The existing receipt is authoritative. Recovery never generates a competing identity or a second semantic event for the same production key.

## Outcomes

The public summary reports one outcome:

- `workspace-required` — no local Workspace exists; no state is created;
- `paused` — production is paused; no scan or mutation occurs;
- `blocked` — evidence is invalid, quarantined, or otherwise blocked; no retry occurs;
- `healthy` — the safe retry found no receipt/event reconciliation to perform;
- `reconciled` — existing private receipts or already-known production state were reconciled without duplication.

The summary also states whether a retry was attempted, a bounded blocker category, and the ordinary bounded production summary when a retry occurred.

It contains no calls, token values, model/provider details, paths, fingerprints, deduplication identities, receipt IDs, keys, prompts, responses, code, patches, secrets, or tool arguments.

## Fail-closed states

Recovery stops before scanning when:

- the Workspace does not exist;
- production is paused;
- public evidence is blocked;
- any invalid event is present;
- any quarantined evidence is present.

Recovery does not:

- delete invalid or quarantined records;
- clear blockers;
- reset endpoint identity or keys;
- reset lifecycle revision or pause state;
- rewrite signed batches or acknowledgements;
- remove valid receipts or outbox events;
- bypass source/provider/provenance validation;
- reprice historical usage;
- create a batch, export, upload, or publish automatically.

A scanner, receipt, outbox, Workspace, lifecycle, or evidence integrity error remains a bounded failure requiring explicit review. It is not downgraded to success.

## Desktop boundary

The protected main-process runtime owns recovery. Electron exposes only the zero-argument action and returns the bounded recovery summary plus refreshed public snapshot.

Older staged runtimes without the capability return `workspace-recovery-unavailable`. Raw exceptions and local paths never cross IPC.

## Complete local flow

Blocking tests validate the persisted local sequence:

1. create Workspace;
2. produce one reviewed event;
3. pause production;
4. verify recovery stops before scanning;
5. resume production;
6. reproduce idempotently through the existing receipt;
7. create one signed batch;
8. export one independently verifiable package;
9. dispose and zero private identity buffers;
10. reopen the same endpoint and Workspace;
11. recover/deduplicate without a second event or batch;
12. export the same one-event chain again.

A separate interruption test deletes only the public event file after its private receipt commits. Recovery restores the original event and sequence from that receipt.

## Non-goals

- no destructive repair or reset;
- no automatic startup recovery;
- no remote recovery service, support backdoor, hosted queue, or cloud receipt;
- no account, team, entitlement, billing, Android, Advisor, or Bench behavior;
- no collector, parser, cache-schema, pricing, label, or aggregation redesign.
