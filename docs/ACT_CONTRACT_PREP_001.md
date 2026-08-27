# ACT Contract Preparation 001

**Status:** design-only preparation; no new ACT executor is implemented by this document.

## Purpose

ACT is the explicit, user-authorized boundary for operations that may run a
controlled workload or change local state. Advisor remains read-only and may
produce a proposal, but it does not execute an ACT contract. `AdvisorToolV1`
is unchanged.

The public contract should keep the model in the role of interpreter and
proposal author while Metrora owns scope, preconditions, confirmation,
cancellation, budgets, result identity and evidence.

```text
Advisor question
    -> read-only evidence + proposal-only answer
    -> explicit user confirmation in the owning surface
    -> ActionContractV1 validation
    -> bounded local executor
    -> immutable result/evidence record
```

## Proposed `ActionContractV1` shape

The first public shape should be a strict JSON-safe envelope with:

- `contractVersion: "metrora.action.v1"` and `schemaVersion: 1`;
- opaque `actionId`, `kind`, `status`, creation time and originating surface;
- immutable scope: selected runtime/model, Project or Workspace scope where
  applicable, task-pack identity, and provider/network boundary;
- explicit `preconditions` and a bounded `effects` declaration;
- required user confirmation and the exact confirmation summary shown;
- bounded timeout, work-unit/cost limits, cancellation and expiry behavior;
- deterministic result/evidence references and a failure/cancellation reason;
- rollback semantics. If an action has no rollback, the contract says so
  before confirmation.

The contract must reject undeclared fields, arbitrary shell/path input,
unbounded prompts, provider-native credentials, remote endpoints and hidden
side effects. A proposal is not an authorization and a successful HTTP call
is not proof that the action satisfied its contract.

Existing file-mutating ACT records under `src/act/` remain compatible. A
controlled Bench run is a separate effect class: it creates bounded local
Bench evidence and does not silently become a file-edit action or an Advisor
tool result.

## First ACT candidate: Run Core Conformance Bench

This is a future action design, not an implementation claim. The candidate
would wrap the existing local `bench task-pack` authority:

- kind: `run-core-conformance-bench`;
- runtime: local Ollama only for the first tranche;
- model: selected explicitly by the user, never auto-selected;
- pack: exact `metrora.bench.core@1.0.0` identity and digest;
- generation policy: the existing fixed task-pack parameters;
- effect: bounded local Bench history record, or an explicit no-save result;
- no upload, managed compute, provider credential forwarding or user-content
  workload;
- cancellation, timeout, unavailable and malformed results remain distinct;
- result is comparable only through the existing Bench compatibility rules.

Confirmation must show the runtime, model, pack, local execution boundary,
save/no-save choice, limits and the fact that this is controlled evidence, not
a general model ranking. The action must not expose task prompts or generated
text through Advisor or the mobile projection.

## Smartphone projection

The smartphone surface may display a pending proposal, confirmation summary,
progress state and bounded result through the existing local companion
boundary when that capability is explicitly authorized. The first mobile
projection should be read-only and content-minimal:

- action id, kind, status, selected runtime/model and pack identity;
- start/end time, cancellation or failure category;
- pass/fail/unavailable/cancelled counts and nullable score/timing facts;
- evidence digest and navigation to the local Bench view.

It must not sync provider keys, task prompts, generated output, raw provider
payloads, local paths or arbitrary execution requests. Remote smartphone
execution, background execution and managed Bench remain separately gated.

## Follow-up: custom OpenAI-compatible endpoint

Do not add a custom endpoint field to this foundation. A future follow-up would
need its own contract covering exact origin allowlisting, TLS/redirect policy,
credential custody, model discovery, protocol selection, retention/privacy,
tool capability, cancellation, conformance fixtures and mobile projection.
“OpenAI-compatible” is not a compatibility guarantee and must not become an
arbitrary URL escape hatch.

## OSS reuse proposal

Metrora should reuse commodity OSS behind Metrora-owned contracts where a
bounded review passes:

- a chat UI substrate such as `assistant-ui` for accessible conversation and
  streaming primitives;
- provider transport helpers such as the Vercel AI SDK only inside direct,
  fixed-origin Local BYOK adapters;
- a replaceable chart renderer behind Metrora-owned presentation blocks;
- AG-UI as a future interoperability candidate for remote/mobile workflows,
  not as current authority.

Every adoption still requires a licence/NOTICE review, pinned version,
security and replacement assessment, bounded cancellation and a test fixture
that proves provider types do not leak through Metrora contracts. No OSS
gateway is required for direct Local BYOK, and no dependency changes are
authorized by this preparation alone.

## Explicitly not implemented here

- ACT contract runtime validation or a new executor;
- Advisor actions or automatic Bench execution;
- mobile write/execute routes;
- remote or managed Bench;
- custom provider URLs;
- billing, entitlements or provider usage metering;
- proprietary recommendations, ranking or playbooks.
