# Metrora ACT Foundation V1 — Core Bench Operation

This document describes the public, local-only ACT foundation introduced by
`METRORA_ACT_FOUNDATION_V1_BENCH_OPERATION`. It is a contract and handoff
document; it does not implement Advisor UI or Android.

## Authority and scope

The first executable kind is exactly:

`run-core-conformance-bench`

It wraps the existing canonical `runBenchTaskPackV1` executor and
`saveBenchEvaluationV1` history authority:

- authority: `metrora.bench.core@1.0.0`
- selector: `core-v1`
- runtime: Ollama local at `http://127.0.0.1:11434`
- model: explicitly selected by the caller
- checks: six canonical deterministic tasks
- persistence: the existing ACT journal plus canonical Bench history

The action never accepts a prompt, shell command, filesystem path, remote
endpoint, provider credential, repository/code-execution request, or hosted
runtime selection.

## ActionContractV1

The canonical identity is `metrora.action.v1`, schema version `1`. The strict
JSON contract is implemented in `src/act/action-contract-v1.ts` and contains:

- action identity and originating surface;
- immutable local-only scope;
- exact Ollama runtime, model, and Core pack identity including digest;
- bounded arguments, preconditions, declared effects, limits, timeout, and
  cancellation policy;
- explicit-user-confirmation requirement and proposal/confirmation digests;
- result identity and Bench evidence-reference slots;
- failure-category and no-rollback declarations.

Unknown fields and non-JSON values are rejected at the trusted boundary. The
proposal digest covers the execution-relevant contract fields, including
scope, target, model, runtime, pack, limits, effects, and cancellation/timeout
policy. Mutable result/evidence/failure fields are excluded from that digest.

## Approval boundary

A proposal is not authorization. The renderer/LLM may receive the proposal
and confirmation summary, but the bridge exposes no approval method. A trusted
host process calls `TrustedActionAuthorityV1` only after a real user event.
That authority issues an HMAC-backed approval token bound to the exact action
ID, proposal digest, confirmation digest, and process-held signing secret.

Execution verifies the token and recomputes the proposal digest. Any material
proposal change invalidates the token. The ACT journal rejects duplicate action
IDs, replay after a terminal state, concurrent execution, and malformed or
identity-mismatched operation records.

## Lifecycle

The existing append-only ACT journal records the current lifecycle line for the
same action ID; the last line wins while prior lines remain audit history.

`proposed → ready → running → completed | unavailable | failed | cancelled`

`unavailable` means the bounded local runtime/evidence could not be used. It is
not a failed deterministic assertion, a zero score, or a cancellation.
`cancelled` means cancellation propagated through the operation. A timeout is
reported as `failed` with failure category `timeout`; it is not converted into
`unavailable`.

Progress is authoritative only for attempted task results. The operation
exposes six planned checks and increments completed checks after the canonical
executor retains an individual task result. It never fabricates progress for
unstarted work. A fresh ACT lock is heartbeated for the duration of the
operation. If a persisted running owner is no longer alive, the next trusted
execution attempt closes that record as failed with no result and requires a
new action; it never retries an unknown operation.

## Journal and Bench history

The ACT record answers what Metrora was authorized to do and which lifecycle
state it reached. The canonical Bench history record remains the sole factual
authority for task outcomes and pass counts. The ACT result stores only the
Bench result identity (`runId` plus `resultDigest`) and a bounded projection of
counts for status/mobile display. Readers verify that the referenced Bench
record exists and matches the digest.

Run Core conformance has rollback capability `none`: its only external effect
is a bounded local evidence/history append. `metrora act undo` refuses to treat
it as a file mutation.

## Future Advisor presentation contract

The isolated bridge in `src/act/bridge-v1.ts` returns a proposal and a bounded
confirmation summary suitable for a future Advisor card:

```text
Core conformance
Model        <explicit local model>
Runtime      Ollama local
Checks       6
Network      Local only
API cost     None
Result       Saved to Bench history

[Run] [Cancel]
```

While running, the card may show only authoritative counts such as `2 / 6
checks` and `[Cancel]`. On completion it may expose result-linked actions such
as Explain, Compare, and Evidence only when the corresponding Bench evidence
exists. This branch does not connect the bridge to Advisor UI.

## Android projection

`projectActionForMobile` emits the content-minimal
`metrora.action-mobile-projection.v1` shape: action ID, kind, lifecycle status,
local runtime/model, exact pack identity, planned/completed counts, timestamps,
cancellation/failure category, bounded result counts, and Bench result digest.

It deliberately excludes prompt bodies, generated model text, credentials,
local paths, and arbitrary execution arguments. Android is a reader/projection,
not a second action or Bench authority.

The existing direct Bench CLI remains additive in this slice. This branch does
not claim that every existing Bench entrypoint is already routed through ACT;
Advisor integration can adopt this bridge after the independent provider work
is complete.
