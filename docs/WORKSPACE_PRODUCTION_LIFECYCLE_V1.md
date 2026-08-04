# Workspace production lifecycle v1

**Status:** W1.D.C.A durable local lifecycle contract.

This contract controls only whether future reviewed Workspace measurements may be produced. It does not control Metrora collectors, parser execution, canonical analytics, historical pricing, existing outbox events, signed batches, or evidence exports.

## Default behavior

A local personal Workspace with no lifecycle file is treated as:

- production mode `active`;
- revision `0`;
- not yet persisted;
- no lifecycle update timestamp.

Reading this default never creates a file. Existing Workspace installations therefore remain compatible without migration or silent state mutation.

## Durable state

The private endpoint stores one strict versioned record under the existing Workspace local-state directory:

- stable Workspace ID;
- stable endpoint ID;
- mode `active` or `paused`;
- positive monotonic revision;
- creation and latest-update timestamps.

The record contains no signing key, event-identity key, production receipt, deduplication key, source path, prompt, response, source code, patch, secret, tool argument, normalized call, token count, cost, model label, or provider claim.

Writes reuse Metrora's existing cross-process Workspace lease and atomic private-file publication. Concurrent identical requests produce one transition; later requests are idempotent.

## Pause semantics

Pause means only:

> A future explicit Workspace reviewed-production action must perform no production while this mode is `paused`.

Pause does not:

- stop local tool discovery or parsing;
- change the Overview payload;
- alter calls, sessions, tokens, costs, pricing coverage, models, providers, projects, or labels;
- delete, quarantine, acknowledge, sign, export, or upload existing evidence;
- reset receipts or the append-only outbox;
- disable local analytics for users who do not use Workspace.

W1.D.C.A persists and exposes this policy but does not yet implement the reviewed-production orchestrator. Enforcement at the production entry point belongs to W1.D.C.B.

## Resume semantics

Resume changes only the durable mode back to `active` and increments the revision. It never deletes the lifecycle file or rewrites earlier evidence.

An already-active absent state is a no-op and remains unpersisted. An already-active or already-paused persisted state is also a no-op and preserves its revision and timestamp.

## Identity and recovery

The record is bound to the Workspace and stable enrolled endpoint, not to a particular endpoint-key generation. Normal forward key rotation therefore preserves the production mode.

Metrora fails closed and requires recovery when:

- the JSON or schema is invalid;
- timestamps or revision are contradictory;
- the record refers to a different Workspace;
- the record refers to a different endpoint;
- the private state cannot be read safely.

Recovery does not mean deletion or reset. W1.D.C.C will expose only deterministic, non-destructive recovery actions for known states.

## Desktop boundary

The secure main-process Workspace runtime adds the lifecycle summary to its strict public snapshot:

- mode;
- revision;
- whether a durable record exists;
- latest update timestamp, or `null` for the implicit default.

Before Workspace creation the lifecycle summary is `null`.

IPC exposes two fixed no-argument actions:

- pause Workspace production;
- resume Workspace production.

The handlers choose the exact private mode. Renderer input cannot supply a mode, call, provider, provenance profile, source fingerprint, cost assignment, path, receipt, or evidence claim.

No W1.D.C.A user-interface control is enabled yet. The bridge exists so the later focused lifecycle UI can remain a narrow client of the main-process authority.

## Validation

Blocking tests cover:

- Workspace-required behavior;
- non-creating active default;
- atomic pause publication;
- concurrent idempotency;
- monotonic resume without deletion;
- endpoint-key rotation;
- malformed and cross-bound fail-closed state;
- public snapshot privacy;
- fixed pause/resume IPC mapping and sanitized errors;
- unchanged evidence state across lifecycle transitions;
- Ubuntu full-suite and Windows secure desktop-runtime execution.

## Non-goals

- no reviewed-measurement scan or production;
- no automatic/background action;
- no batch, export, upload, synchronization, account, team, billing, mobile, or unrelated product behavior;
- no new collector, parser, pricing, cache, aggregation, or analytics authority.
