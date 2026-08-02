# Workspace production scope v1

## Status

Normal local Workspace production is scoped from the trusted local Workspace creation timestamp.

This policy was frozen after physical Windows acceptance found that a newly created Workspace with a large Lifetime history could attempt an unbounded retroactive publication pass.

## Normal Produce action

`Produce reviewed measurements`:

- is explicit and zero-argument from the renderer;
- derives `notBefore` from the protected local Workspace `createdAt` field;
- considers calls recorded exactly at or after that timestamp;
- leaves older calls available to canonical Overview analytics;
- does not count pre-Workspace history as withheld, failed, invalid, or quarantined evidence;
- preserves existing source-presence, explicit-provider, reviewed-provenance, immutable-cost, receipt, outbox, and lifecycle checks;
- remains idempotent when repeated;
- still stops before scanning while production is paused.

The renderer cannot supply or alter the timestamp, calls, providers, costs, fingerprints, paths, deduplication identities, receipts, or signing material.

## Historical backfill

Historical backfill is not part of Workspace v1 normal production.

A future backfill may be introduced only as a separate explicit workflow with:

- a visible bounded scope;
- progress reporting;
- cancellation;
- resumable checkpoints;
- deterministic ordering;
- idempotent receipt reconciliation;
- an estimate before mutation;
- no change to canonical analytics or historical cost assignments.

It must never be triggered by opening Workspace, creating Workspace, normal Produce, recovery, batching, export, startup, or background refresh.

## Safe interruption

Each produced event remains protected by the existing atomic private receipt and outbox publication sequence. Stopping the application during production may leave a partial set of valid events or a receipt awaiting publication, but it must not corrupt previously published evidence. The explicit recovery path may reconcile the existing receipt without deleting, resetting, repricing, or duplicating evidence.
