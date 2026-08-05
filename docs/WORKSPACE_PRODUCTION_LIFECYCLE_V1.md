# Workspace production lifecycle v1

**Status:** implemented, persisted and enforced by the local Workspace runtime.

This contract controls only whether future explicit reviewed-measurement production may run. It does not control ordinary collectors, parsing, analytics, historical pricing, existing outbox events, signed batches or exports.

## Default behavior

A local personal Workspace without a lifecycle file is treated as:

- production mode `active`;
- revision `0`;
- not yet persisted;
- no lifecycle update timestamp.

Reading that default does not create a file, so existing Workspace state remains compatible without silent mutation.

## Durable state

The private endpoint stores one strict versioned record containing:

- stable Workspace ID;
- stable endpoint ID;
- mode `active` or `paused`;
- positive monotonic revision;
- creation and latest-update timestamps.

The record contains no keys, receipts, source paths, prompts, responses, code, tool arguments, normalized calls, token counts, costs or provider claims.

Writes reuse the Workspace cross-process lease and atomic private-file publication. Concurrent identical requests converge on one transition; repeated requests are idempotent.

## Pause semantics

Pause means:

> A future explicit reviewed-production action must stop before the canonical source scan.

Pause does not:

- stop local discovery, parsing or Overview refreshes;
- change calls, sessions, tokens, costs, models, providers, projects or labels;
- delete, quarantine, acknowledge, sign or export existing evidence;
- reset receipts or the append-only outbox;
- disable ordinary analytics.

A pause requested while one atomic production pass is active waits for that pass to finish. Later passes stop before scanning.

## Resume semantics

Resume changes only the durable mode to `active` and advances the revision. It never deletes lifecycle history or rewrites earlier evidence.

Requesting the already-active or already-paused state is a no-op that preserves revision and timestamp.

## Identity and recovery

Lifecycle state binds the stable Workspace and endpoint, not one key generation. Normal endpoint-key rotation therefore preserves the production mode.

Malformed, cross-bound or contradictory lifecycle state fails closed. Recovery is explicit and non-destructive; it does not mean deleting the record or resetting identity.

## Desktop boundary

The secure main-process runtime exposes a bounded public lifecycle summary:

- mode;
- revision;
- whether a durable record exists;
- latest update timestamp, or `null` for the implicit default.

The desktop UI provides explicit pause and resume controls. IPC actions take no renderer-supplied mode or measurement data; the main process selects the exact private transition.

Before Workspace creation the lifecycle summary is `null`.

## Validation boundary

Tests cover:

- Workspace-required behavior;
- the non-creating active default;
- atomic pause publication;
- concurrent idempotency;
- monotonic resume;
- endpoint-key rotation;
- malformed and cross-bound fail-closed state;
- public snapshot privacy;
- fixed pause/resume IPC mapping;
- unchanged evidence state across lifecycle transitions.

## Non-goals

This lifecycle does not add automatic production, background work, upload, synchronization, account, team, billing, mobile or alternate analytics behavior.
