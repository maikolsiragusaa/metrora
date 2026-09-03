# ACT Contract Preparation 001

**Status:** current-main-native ACT foundation v2 contract and implementation note; the bounded first executor is implemented on this branch for review.

## Purpose

ACT is the explicit trusted boundary for operations that run a controlled workload or change state.

Metrora Harness is the public coding/agent surface. ACT remains the separate
Metrora authority for bounded state-changing product actions; a coding Tool
approval is not an ACT action proposal unless it crosses that action boundary.

Harness may understand a state-changing request and prepare a proposal. It does **not** authorize itself.

Canonical relationship:

```text
Harness conversation / product workflow
→ read-only evidence + proposal
→ explicit trusted confirmation
→ ActionContractV1 validation
→ bounded executor
→ lifecycle + canonical result/evidence
→ Harness explanation
```

ACT is an execution authority underneath product workflows, not a user-facing `Act` chat mode.

## ActionContractV1 shape

A public action contract should remain a strict JSON-safe envelope containing at least:

- `contractVersion: "metrora.action.v1"` and schema version;
- opaque action ID, kind, lifecycle status, creation time/originating surface;
- immutable target/scope;
- selected runtime/model/Project/Workspace where applicable;
- declared network/filesystem/provider boundaries;
- explicit preconditions/effects;
- exact user confirmation summary/digest where implemented;
- bounded timeout/work/resource/cost limits;
- cancellation/expiry behavior;
- deterministic result/evidence references;
- explicit failure/cancel reason;
- rollback semantics, including declared `none` before confirmation.

The contract must reject undeclared fields, arbitrary shell/path input, unbounded prompts, provider-native credentials, arbitrary remote endpoints and hidden side effects.

A proposal is not authorization. A successful process/HTTP call is not proof that the action satisfied the contract.

## First narrow ACT operation: Core Compatibility

The first safe operation is the existing public Core Compatibility workflow; the historical command name was `Run Core Conformance Bench`.

Product classification:

- Bench family: **Compatibility / Runtime Health**;
- public pack: `metrora.bench.core@1.0.0`;
- first runtime: local Ollama;
- model: explicitly selected;
- effect: bounded local Compatibility evidence/history;
- no user-content workload;
- no arbitrary prompt;
- no provider credential forwarding;
- no remote endpoint;
- cancellation/timeout/unavailable/malformed stay distinct.

This remains a useful first ACT proof because its external effect is narrow and evidence-oriented.

It must **not** be treated as the definition of Metrora Bench. Mainstream Bench product direction is Performance-first; see [Bench evidence families](BENCH_EVIDENCE_FAMILIES.md).

A future Performance run may receive its own action kind only after a normalized Performance contract/executor is implemented. Do not broaden the first Core Compatibility action into arbitrary benchmark execution merely for convenience.

## Implemented foundation boundary

The v2 foundation currently binds `metrora.action.v1` to the single `run-core-compatibility` kind. Its strict JSON-safe contract fixes the local Ollama loopback runtime, explicit model, `core-v1` selector, canonical pack identity/digest, fixed generation parameters, bounded timeouts, cancellation precedence, declared journal/history writes, and no rollback capability.

Approval is issued and verified by a trusted process using exact action, proposal, confirmation, execution, target, model, pack, and parameter digests. Stored `ready` authority is revalidated for freshness after restart; stale, malformed, forged, replayed, duplicate, or mismatched actions fail closed.

Execution delegates to the existing canonical task-pack runner and history store. ACT persists lifecycle state, bounded progress/counts, digests and references only; task prompts, generated output, credentials, repository paths and shell operations are not persisted or accepted. Orphaned running state is recovered only from exact existing evidence, otherwise it reaches a terminal failure/cancellation without retry.

## Shipped confirmation UX

Before execution the user should see material effects in ordinary language, for example:

```text
Core Compatibility
Model       <selected model>
Runtime     Ollama local
Checks      6
Network     Local only
Writes      Local Bench history

[Run] [Cancel]
```

The current Harness action card exposes the selected model, pack identity, bounded checks/progress, proposal digest and safe lifecycle state. It does not expose the internal contract or approval token. The renderer sends only the action ID and proposal digest to the trusted Electron host.

The model does not supply the trusted approval token merely by emitting `yes` or a tool call.

## Lifecycle and observable progress

ACT exposes authoritative lifecycle events without exposing hidden model reasoning:

```text
proposed
→ ready/confirmed
→ running
→ completed | unavailable | failed | cancelled
```

Progress must be tied to actual executed work/result evidence.

Metrora Harness displays the narrow Core Compatibility lifecycle inline in the same observable style as read tools. Tool/action activity remains compact and bounded.

## Smartphone projection

A first mobile projection may display content-minimal action state only after the capability is explicitly authorized.

Safe projected fields may include:

- action ID/kind/status;
- runtime/model/pack identity;
- start/end time;
- progress counts;
- cancellation/failure category;
- bounded result counts;
- evidence/result digest.

Do not project:

- provider keys;
- task prompts;
- generated output;
- arbitrary paths;
- unrestricted execution arguments.

Remote smartphone **execution/approval** is a separate stronger authority, not implied by a read-only projection.

## Provider/runtime endpoints

Do not add an arbitrary `OpenAI-compatible endpoint` escape hatch to ACT.

Any future provider/runtime adapter needs its own reviewed origin/auth/model-discovery/protocol/privacy/conformance contract.

`OpenAI-compatible` is not a compatibility or authorization guarantee.

## OSS reuse rule

ACT itself should stay Metrora-owned because it defines trust/authorization semantics.

Commodity external runtimes, benchmark engines, sandboxes or UI primitives may be used behind bounded adapters after licence/security/provenance review.

An external agent/harness framework must never bypass ActionContract/ACT authority merely because it exposes its own tool/approval system.

No dependency is added by this document.

## Explicitly outside this foundation

- Harness automatic execution;
- arbitrary shell/repository writes;
- mobile write/execute routes;
- managed Bench;
- arbitrary provider URLs;
- billing/entitlements;
- Swarm/orchestration;
- proprietary recommendation/routing policy.

## Relationship to current Draft implementation work

This branch contains the concrete `metrora.action.v1` implementation around Core Compatibility for review against current `main`. Harness remains proposal-only at the product/model boundary: the renderer cannot authorize, construct or execute the action. A trusted Electron host re-reads the persisted proposal, canonicalizes the sole `ActionContractV1`, requires explicit confirmation, and delegates to ACT. The implementation does not add a second runner, change mobile execution, or introduce MCP.

Any acceptance pass must ensure there is one ACT authority rather than separate
action proposal and execution systems that can diverge.

## Ratified public principles

1. Harness may propose; ACT authorizes/executes.
2. ACT is not a chat mode.
3. The first safe action is Core Compatibility, not arbitrary Bench execution.
4. Mainstream Bench remains Performance-first.
5. The model cannot self-authorize.
6. External OSS cannot bypass Metrora action authority.
7. State-changing execution requires explicit bounded effects, limits, cancellation and evidence.
