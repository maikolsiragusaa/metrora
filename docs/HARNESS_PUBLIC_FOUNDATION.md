# Metrora Harness public foundation

**Status:** Harness Productization V2 implementation slice for review
**Implementation compatibility:** the user-facing Desktop surface is now Metrora Harness. Stable `Advisor` / `Advisor*` identifiers remain as technical compatibility names where they still describe contracts, runtime adapters or file boundaries.

See also [Metrora ecosystem surfaces](ECOSYSTEM_SURFACES.md) for the public composition/status map across Tools, Harness, MCP, ACT, Bench, Widgets, Wrapped and future Swarm.

## What Metrora Harness means

**Metrora Harness** is the product-facing direction for Metrora's conversational and operational AI surface.

Canonical interaction rule:

> **Chat first. Tools when useful. Actions only with authority.**

Harness is a normal capable conversational surface. A configured model can help with ordinary conversation, coding, explanations and reasoning. When the user asks for user-specific Metrora facts, the model can use fixed typed Metrora Tools instead of guessing those facts.

The model is not Metrora's accounting, pricing, quota or action authority.

## Current public foundation

This branch keeps the existing conversational foundation and productizes it behind the Metrora Harness identity:

- chat-first behavior for capable configured runtimes;
- ordinary conversation without requiring an evidence read;
- bounded same-scope conversation history;
- bounded typed UI context;
- fixed read-only Metrora factual tools;
- canonical fact/evidence verification;
- proposal-only handling for state-changing requests;
- Ollama, LM Studio and existing-binary llama.cpp `llama-server` local runtimes;
- supported direct BYOK provider adapters;
- explicit hosted evidence-sharing consent;
- bounded cancellation/error/privacy behavior.
- compact bounded Tool activity with no prompts, secrets, paths or hidden reasoning;
- immediate pending state and streamed conversational deltas where the selected runtime supports them;
- a canonical `src/tools` registry/contract/evidence/privacy layer with a thin renderer compatibility adapter;
- bounded multi-tool planning with a maximum of two rounds and four calls per turn.

Current public `main` also now contains the separate **ACT V2 execution foundation**:

- strict `metrora.action.v1` executable authority;
- first controlled kind `run-core-compatibility`;
- trusted approval/freshness/digest binding;
- replay/forgery/restart fail-closed protections;
- bounded cancellation/timeout/late-result behavior;
- canonical Bench evidence ownership.

The branch also exposes one narrow Harness action path for Core Compatibility. The renderer receives only a safe proposal/lifecycle projection; a trusted Electron host re-reads the proposal, canonicalizes the sole `ActionContractV1`, requires explicit confirmation, and delegates execution to ACT. No general action executor is exposed.

See [Advisor implementation compatibility](ADVISOR_PUBLIC_FOUNDATION.md) for current `Advisor*` contract names and [ACT contract preparation](ACT_CONTRACT_PREP_001.md) for the controlled-action boundary.

This document does **not** add or claim:

- arbitrary shell or repository access;
- autonomous model approval;
- agents or Swarm;
- managed Metrora inference;
- a bundled or automatically managed llama.cpp distribution;
- an MCP server that can mutate state or bypass the canonical Tools boundary;
- a hosted MCP service;
- persistent cloud conversation memory.

## Conversation vs factual authority

Ordinary conversation does not need a Metrora evidence bundle.

For user-specific Metrora facts, the desired path is:

```text
user question
→ model decides a bounded read is useful
→ Metrora validates Tool + scope
→ canonical Metrora evidence
→ model explains/synthesizes
→ Metrora keeps factual claims within accepted evidence
```

The read result is **evidence**, not automatically the whole answer.

For example, a question such as:

> Why did I spend about $2 today?

should not stop at repeating the total when Metrora has bounded breakdown/driver evidence capable of answering the question more usefully. Harness should read the smallest sufficient evidence, describe observed contributors and make material limits clear. It must not invent causality or quality claims that the evidence does not prove.

## Observable activity, not chain-of-thought

Harness UX is intended to expose useful **observable work** similar to modern coding harnesses and IDE agents.

Examples of safe observable events:

- `Reading Usage · Today`;
- Tool started/completed/unavailable;
- bounded scope used;
- evidence freshness/coverage where material;
- action proposal/progress when an approved ACT path is invoked.

Private chain-of-thought, hidden scratchpads and internal model reasoning are not product telemetry and should not be exposed.

## Pending and streaming UX

The shipped Harness UX makes prompt processing unmistakable:

```text
message sent
→ immediate visible pending state
→ optional Tool activity
→ streamed answer where supported
→ final answer
```

Product language should remain simple, for example `Thinking…`, `Reading Usage…`, `Checking Activity…` rather than exposing planner/guard/schema terminology.

Factual answers remain buffered behind the canonical evidence boundary; conversational runtime deltas are sanitized before they reach the renderer. Tool and action activity is compact, bounded and truthful.

## Runtime/model interaction direction

The primary conversation should remain central. Runtime/provider/model controls should become compact and quick to change instead of dominating the conversation surface.

Current local runtime support:

- Ollama;
- LM Studio.

The existing-binary llama.cpp / `llama-server` adapter is a local Community runtime path; it connects only to the fixed loopback default and does not download, build or start llama.cpp.

Any new runtime/provider still requires explicit endpoint, privacy, streaming, Tool and failure-semantics review. `OpenAI-compatible` by itself is not a compatibility guarantee.

## Canonical Tools layer

The reusable canonical **Metrora Tools** layer is implemented in `src/tools`. It preserves the public `advisor-tool-v1` contract and exact eight tool identities while the renderer's `advisor/tools.ts` remains only a compatibility adapter. Harness does not own the factual registry.

The Tool boundary stays:

- fixed and allowlisted;
- read-only for current factual capabilities;
- scope-bounded;
- content-minimal;
- cancellation-aware;
- explicit about freshness/coverage/unavailable state.

Future Tool growth should prefer useful bounded factual drill-downs over unrestricted database/file access.

The same canonical factual Tools are reusable by:

- Metrora Harness;
- the local Metrora MCP Server V1;
- bounded CLI/integration surfaces where appropriate.

Do not build a second MCP-specific accounting/evidence implementation.

## MCP relationship

MCP is an adopted interoperability surface with a shipped local V1.

The shipped product shape is a **local, read-only Metrora MCP Server V1** exposing canonical factual Metrora Tools to compatible external AI clients.

Example:

```text
external AI client
→ Metrora MCP
→ get_spend_snapshot / other factual Tool
→ canonical Metrora evidence
→ external client explains result
```

MCP capability discovery does not grant execution authority.

Future state-changing requests from external clients must remain proposal-only until Metrora's trusted authority performs explicit ACT confirmation/authorization.

## ACT boundary

Harness may understand a state-changing request and prepare a proposal. It is not execution authority.

The shipped canonical relationship is:

```text
Harness intent / proposal
→ trusted host canonicalization
→ strict ActionContractV1
→ explicit real-user confirmation
→ ACT
→ bounded executor
→ canonical result/evidence owner
→ Harness explanation
```

ACT is an execution authority underneath product workflows, not a chat mode the user must select first.

Current public ACT V2 implements the first bounded Core Compatibility operation through canonical Bench authority. It deliberately does not make `AdvisorActionProposalV1` or another conversational proposal object executable.

The Desktop bridge accepts only `run-core-compatibility`. It takes a model-selected proposal into a trusted host, returns a content-minimal action event, and exposes confirmation/cancellation/read operations without returning the internal contract or approval token to the renderer.

Future MCP callers follow the same authority boundary.

## Swarm direction

**Swarm** is the name reserved for a future Harness mode/capability that coordinates multiple workers/subagents under explicit policy and action authority.

No Swarm implementation is shipped by this document.

A future `Swarm · Soon` UI can be truthful only when clearly disabled/unavailable and must not imply autonomous repository execution already exists.

An external AI/MCP caller may someday propose Swarm work, but it cannot directly authorize or execute the controller.

## Bench relationship

Harness may read and explain canonical Bench evidence. It may not rescore or reinterpret a Bench family as something it does not measure.

ACT may invoke a supported Bench operation, but Bench remains the canonical evidence/history owner.

The Desktop Harness read path can inspect retained Performance evidence through the existing `get_bench_evidence` flow. The native `llama-bench` run itself remains a Bench/Desktop operation with no new ACT kind; Harness cannot start it from a read-only Tool call and cannot turn its throughput or latency into a quality claim.

Public Bench evidence families are documented in [Bench evidence families](BENCH_EVIDENCE_FAMILIES.md).

## Widgets / sharing relationship

Metrora's existing Share Card foundation is intended to evolve into a broader Widgets family for shareable, privacy-aware presentation of canonical evidence.

Harness may later help explain or prepare a Widget, but it must not calculate a parallel set of totals for sharing.

Wrapped remains a future recap/share experience built on canonical evidence and Widget rendering primitives.

## Privacy

Current public privacy rules remain:

- local use does not require a Metrora account;
- direct BYOK credentials remain on the endpoint and use protected local custody;
- raw prompts/responses/source/patches/secrets/unrestricted paths are outside factual Tool outputs;
- hosted BYOK requires explicit evidence-sharing consent;
- Harness action events contain only bounded status, progress, result and failure metadata;
- contract material and ACT approval tokens stay in trusted host/ACT boundaries;
- conversation state is currently client/session managed;
- no Metrora managed inference gateway exists in the current public foundation;
- Local MCP Server V1 is shipped as a read-only stdio surface; hosted MCP remains outside this public wave.

## Naming compatibility and migration

The product direction is **Metrora Harness**.

`Advisor` is no longer the long-term product identity.

Technical compatibility names such as:

- `AdvisorKernel`;
- `AdvisorToolV1`;
- `AdvisorActionProposalV1`;
- current route/file/schema identifiers;

remain intentionally stable while ownership is migrated semantically; the current user-facing route labels and copy use Harness.

The migration should be semantic rather than cosmetic:

- factual Tool contracts/registry → canonical Tools ownership;
- conversation/model-flow → Harness ownership;
- provider/runtime behavior → provider/runtime ownership;
- evidence helpers → factual evidence/Tool ownership where appropriate;
- UI product presentation → Harness.

Do not mass-rename a type to `Harness*` when its real responsibility belongs to Tools, runtime transport or evidence.

## Public/private boundary

This public repository contains the reusable Community foundation: canonical facts, generic conversation/Tool mechanics, supported runtime/provider adapters, evidence verification, local interoperability mechanics and public safety contracts.

It does not publish private commercial algorithms, private evaluation/playbook assets, proprietary routing/recommendation systems, Swarm controller policy or managed-service implementation.

## Ratified public principles

1. Product-facing conversational/operational identity: **Metrora Harness**.
2. `Advisor` is compatibility/migration debt, not a second long-term product.
3. Capable runtimes may converse normally; conversation is not limited to Metrora analytics questions.
4. User-specific Metrora facts come from bounded typed Tools.
5. Canonical Tools are reusable by Harness and the Local MCP Server V1 instead of duplicated per caller.
6. Tool results should be explained/synthesized when useful.
7. Observable Tool/action activity may be shown; private chain-of-thought is not.
8. Factual authority remains with Metrora evidence.
9. ACT V2 is current trusted execution foundation; the model/proposal layer cannot self-authorize.
10. ACT is not a user-facing chat mode.
11. Local MCP V1 is read-only and cannot bypass ACT.
12. Swarm is future and not shipped.
13. Local Community remains useful without a managed Metrora AI service.
