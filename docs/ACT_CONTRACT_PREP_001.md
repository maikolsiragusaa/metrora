# ACT Contract Preparation 001

**Status:** current-main ACT foundation v2 contract and implementation note; the first bounded executor is shipped for Core Compatibility.

## Purpose

ACT / ActionContract is the trusted Metrora-owned boundary for **specific product workflows that Metrora itself defines as bounded state-changing or controlled execution**.

It is not a universal execution layer beneath every coding action in Metrora.

After the accepted Code surface became the product boundary, ordinary coding execution inside **Code** is owned by the embedded upstream OpenCode runtime, including its normal filesystem, shell, Git and permission/question mechanics.

Current ACT relationship:

```text
Metrora-owned bounded workflow
→ read-only evidence + proposal
→ explicit trusted confirmation
→ ActionContractV1 validation
→ bounded Metrora executor
→ lifecycle + canonical result/evidence
→ caller-facing result
```

ACT is not a user-facing `Act` chat mode and is not inserted in front of upstream Code merely to duplicate OpenCode's own execution/permission system.

## ActionContractV1 shape

A public Metrora action contract should remain a strict JSON-safe envelope containing, where applicable:

- `contractVersion: "metrora.action.v1"` and schema version;
- opaque action ID, kind, lifecycle status and originating Metrora surface/workflow;
- immutable target/scope;
- selected runtime/model/Project/Workspace where relevant to that Metrora-owned action;
- declared network/filesystem/provider boundaries;
- explicit preconditions/effects;
- exact trusted confirmation summary/digest where implemented;
- bounded timeout/work/resource/cost limits;
- cancellation/expiry behavior;
- deterministic result/evidence references;
- explicit failure/cancel reason;
- rollback semantics, including declared `none` before confirmation.

A proposal is not authorization. A successful process/HTTP call is not proof that a Metrora-owned action satisfied its contract.

The generic contract must not become an escape hatch for arbitrary shell/path input, provider credentials, arbitrary remote endpoints, unbounded prompts or hidden side effects.

## Current narrow ACT operation: Core Compatibility

The first and currently implemented operation is the public Core Compatibility workflow; the historical command name was `Run Core Conformance Bench`.

Product classification:

- Bench family: **Compatibility / Runtime Health**;
- public pack: `metrora.bench.core@1.0.0`;
- runtime: local Ollama;
- model: explicitly selected;
- effect: bounded local Compatibility evidence/history;
- no user-content workload;
- no arbitrary prompt;
- no provider credential forwarding;
- no remote endpoint;
- cancellation/timeout/unavailable/malformed remain distinct.

This remains a useful ACT proof because the Metrora-owned effect is narrow and evidence-oriented.

It must **not** be treated as the definition of Metrora Bench. Mainstream Bench product direction is Performance-first; see [Bench evidence families](BENCH_EVIDENCE_FAMILIES.md).

A future Metrora-owned Performance action may receive its own action kind only if that workflow actually needs an ActionContract. Do not broaden Core Compatibility into arbitrary benchmark or coding execution for architectural symmetry.

## Implemented foundation boundary

The current foundation binds `metrora.action.v1` to the single `run-core-compatibility` kind.

Its strict contract fixes the local Ollama loopback runtime, explicit model, `core-v1` selector, canonical pack identity/digest, fixed generation parameters, bounded timeouts, cancellation precedence, declared journal/history writes and no rollback capability.

Approval is issued and verified by a trusted Metrora process using exact action, proposal, confirmation, execution, target, model, pack and parameter digests. Stored `ready` authority is revalidated for freshness after restart; stale, malformed, forged, replayed, duplicate or mismatched actions fail closed.

Execution delegates to the existing canonical task-pack runner and history store. ACT persists lifecycle state, bounded progress/counts, digests and references only; task prompts, generated output, credentials, repository paths and arbitrary shell operations are not persisted or accepted by this action kind.

Orphaned running state is recovered only from exact existing evidence; otherwise it reaches a terminal failure/cancellation without retry.

## Contract-facing confirmation shape

Before Core Compatibility execution, an authorized caller may show material effects in ordinary language, for example:

```text
Core Compatibility
Model       <selected model>
Runtime     Ollama local
Checks      6
Network     Local only
Writes      Local Bench history

[Run] [Cancel]
```

The former custom conversational action card and Desktop ACT bridge are not part of the shipped product surface.

Any future caller of this action should expose only the selected model, pack identity, bounded checks/progress, proposal digest and safe lifecycle state; the internal contract and approval token remain inside trusted authority.

A model does not supply a trusted approval token merely by emitting `yes` or a tool call.

## Lifecycle and observable progress

The current ACT operation exposes authoritative lifecycle events without exposing hidden model reasoning:

```text
proposed
→ ready/confirmed
→ running
→ completed | unavailable | failed | cancelled
```

Progress is tied to actual executed work/result evidence.

CLI or another explicitly authorized Metrora consumer may display the narrow Core Compatibility lifecycle.

## Relationship to Code / OpenCode

Canonical Code rule:

> **Metrora adds. OpenCode executes.**

OpenCode's ordinary local coding actions are **not** ActionContract operations merely because they change files or invoke shell/Git commands.

Inside the accepted Code surface, OpenCode owns:

- file read/write/edit mechanics;
- shell/process execution;
- Git/diff/review mechanics;
- normal Tool execution;
- normal permission/question flow;
- Agent/Subagent execution mechanics.

Metrora may add bounded factual Tools/context without interposing ACT around those commodity mechanics.

If a future Metrora product feature introduces a **new Metrora-owned trust domain or stronger effect**, it may require a new bounded action/control contract. Examples could include:

- remote/background Job authority;
- enrolled-endpoint control;
- managed Workspace/Organization actions;
- release/merge/publication automation;
- other high-impact Metrora-owned workflows.

Those future contracts must be designed for their exact effect; they are not implied by the current Core Compatibility ACT implementation.

## Smartphone / remote projection

A mobile or remote projection may display content-minimal state for an explicitly authorized Metrora-owned action.

Safe projected fields may include:

- action ID/kind/status;
- runtime/model/pack identity;
- start/end time;
- progress counts;
- cancellation/failure category;
- bounded result counts;
- evidence/result digest.

Do not project provider keys, task prompts, generated output, arbitrary local paths or unrestricted execution arguments.

Remote **execution/approval** is a separate stronger authority and is not implied by read-only projection.

## Provider/runtime endpoints

Do not add an arbitrary `OpenAI-compatible endpoint` escape hatch to the current ACT operation.

Any future Metrora-owned provider/runtime action needs its own reviewed origin/auth/model-discovery/protocol/privacy/conformance contract.

`OpenAI-compatible` is not a compatibility or authorization guarantee.

## OSS reuse rule

Metrora should own ActionContract semantics where Metrora owns the effect.

Commodity runtimes, benchmark engines, sandboxes or other OSS may be used behind a bounded Metrora-owned action after licence/security/provenance review.

An upstream runtime cannot self-authorize a **Metrora-owned ActionContract effect** merely because it exposes its own Tool/approval mechanism.

Equally, ACT must not claim authority over ordinary upstream Code actions that Metrora has deliberately delegated to OpenCode.

## Explicitly outside the current ACT foundation

- ordinary OpenCode filesystem/shell/Git execution;
- general coding-agent permissions/questions;
- automatic conversational execution;
- arbitrary repository/shell execution through `metrora.action.v1`;
- mobile write/execute routes;
- managed remote Jobs;
- arbitrary provider URLs;
- billing/entitlements;
- proprietary recommendation/routing policy.

## Relationship to current main

The concrete `metrora.action.v1` Core Compatibility implementation is already part of current public `main`.

The core/CLI boundary keeps proposal validation, trusted approval, execution, cancellation, recovery and evidence under one ACT authority **for this action kind**. The removed custom conversational/renderer proposal bridge is not replaced by a second runner, mobile execution path or MCP action path.

Future ActionContract additions should be justified one bounded Metrora-owned effect at a time.

## Ratified public principles

1. A Metrora-owned ActionContract proposal is not authorization.
2. ACT is not a chat mode or a universal Code execution layer.
3. The current action is Core Compatibility, not arbitrary Bench or repository execution.
4. Mainstream Bench remains Performance-first.
5. A model cannot self-authorize a Metrora-owned ActionContract effect.
6. Ordinary OpenCode file/shell/Git/permission mechanics remain upstream Code behavior.
7. Stronger future Metrora-owned effects require their own explicit bounded authority contracts.
8. ActionContract lifecycle/evidence must preserve explicit scope, effects, limits, cancellation and result authority.