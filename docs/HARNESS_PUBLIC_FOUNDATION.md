# Metrora Harness public foundation

**Status:** public product/architecture direction grounded in current `main`  
**Implementation compatibility:** the current Desktop/code/contracts still use `Advisor` / `Advisor*` identifiers; a bounded semantic migration into Harness, Tools, provider/runtime and evidence ownership is not yet implemented by this document.

See also [Metrora ecosystem surfaces](ECOSYSTEM_SURFACES.md) for the public composition/status map across Tools, Harness, MCP, ACT, Bench, Widgets, Wrapped and future Swarm.

## What Metrora Harness means

**Metrora Harness** is the product-facing direction for Metrora's conversational and operational AI surface.

Canonical interaction rule:

> **Chat first. Tools when useful. Actions only with authority.**

Harness is a normal capable conversational surface. A configured model can help with ordinary conversation, coding, explanations and reasoning. When the user asks for user-specific Metrora facts, the model can use fixed typed Metrora Tools instead of guessing those facts.

The model is not Metrora's accounting, pricing, quota or action authority.

## Current public foundation

Current public `main` already implements the conversational foundation under existing `Advisor*` names:

- chat-first behavior for capable configured runtimes;
- ordinary conversation without requiring an evidence read;
- bounded same-scope conversation history;
- bounded typed UI context;
- fixed read-only Metrora factual tools;
- canonical fact/evidence verification;
- proposal-only handling for state-changing requests;
- Ollama and LM Studio local runtimes;
- supported direct BYOK provider adapters;
- explicit hosted evidence-sharing consent;
- bounded cancellation/error/privacy behavior.

Current public `main` also now contains the separate **ACT V2 execution foundation**:

- strict `metrora.action.v1` executable authority;
- first controlled kind `run-core-compatibility`;
- trusted approval/freshness/digest binding;
- replay/forgery/restart fail-closed protections;
- bounded cancellation/timeout/late-result behavior;
- canonical Bench evidence ownership.

ACT V2 is not yet presented as a general Harness action UI. The conversational proposal layer remains non-executing until a trusted host performs the explicit ACT mapping/confirmation path.

See [Advisor implementation compatibility](ADVISOR_PUBLIC_FOUNDATION.md) for current `Advisor*` contract names and [ACT contract preparation](ACT_CONTRACT_PREP_001.md) for the controlled-action boundary.

This document does **not** add or claim:

- arbitrary shell or repository access;
- autonomous model approval;
- agents or Swarm;
- managed Metrora inference;
- llama.cpp support;
- a local MCP server;
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

## Pending and streaming UX direction

A future Harness UX tranche should make prompt processing unmistakable:

```text
message sent
→ immediate visible pending state
→ optional Tool activity
→ streamed answer where supported
→ final answer
```

Product language should remain simple, for example `Thinking…`, `Reading Usage…`, `Checking Activity…` rather than exposing planner/guard/schema terminology.

The current public foundation already has bounded request/progress mechanics, but this document does not claim the future polished Harness presentation is implemented.

## Runtime/model interaction direction

The primary conversation should remain central. Runtime/provider/model controls should become compact and quick to change instead of dominating the conversation surface.

Current local runtime support:

- Ollama;
- LM Studio.

A future llama.cpp / `llama-server` adapter is a planned public Community direction, not current support.

Any new runtime/provider still requires explicit endpoint, privacy, streaming, Tool and failure-semantics review. `OpenAI-compatible` by itself is not a compatibility guarantee.

## Canonical Tools layer

Current implementation uses the public `AdvisorToolV1` contract and still stores substantial Tool code under `advisor/` namespaces. Stable current identities remain documented in [Advisor implementation compatibility](ADVISOR_PUBLIC_FOUNDATION.md).

The ratified product/architecture direction is to extract a reusable canonical **Metrora Tools** layer that is not owned by the Harness UI.

The Tool boundary stays:

- fixed and allowlisted;
- read-only for current factual capabilities;
- scope-bounded;
- content-minimal;
- cancellation-aware;
- explicit about freshness/coverage/unavailable state.

Future Tool growth should prefer useful bounded factual drill-downs over unrestricted database/file access.

The same canonical factual Tools are intended to be reusable by:

- Metrora Harness;
- a future local Metrora MCP Server;
- bounded CLI/integration surfaces where appropriate.

Do not build a second MCP-specific accounting/evidence implementation.

## MCP relationship

MCP is an adopted interoperability direction, not current shipped functionality.

The intended first product shape is a future **local, read-only Metrora MCP Server** exposing canonical factual Metrora Tools to compatible external AI clients.

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

Current canonical relationship:

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

Future MCP callers follow the same authority boundary.

## Swarm direction

**Swarm** is the name reserved for a future Harness mode/capability that coordinates multiple workers/subagents under explicit policy and action authority.

No Swarm implementation is shipped by this document.

A future `Swarm · Soon` UI can be truthful only when clearly disabled/unavailable and must not imply autonomous repository execution already exists.

An external AI/MCP caller may someday propose Swarm work, but it cannot directly authorize or execute the controller.

## Bench relationship

Harness may read and explain canonical Bench evidence. It may not rescore or reinterpret a Bench family as something it does not measure.

ACT may invoke a supported Bench operation, but Bench remains the canonical evidence/history owner.

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
- conversation state is currently client/session managed;
- no Metrora managed inference gateway exists in the current public foundation;
- no MCP server is currently shipped by this document.

## Naming compatibility and migration

The product direction is **Metrora Harness**.

`Advisor` is no longer the long-term product identity.

Current implementation names such as:

- `AdvisorKernel`;
- `AdvisorToolV1`;
- `AdvisorActionProposalV1`;
- current route/file/schema identifiers;

remain truthful compatibility names until a bounded migration lands.

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
5. Canonical Tools should be reusable by Harness and future MCP instead of duplicated per caller.
6. Tool results should be explained/synthesized when useful.
7. Observable Tool/action activity may be shown; private chain-of-thought is not.
8. Factual authority remains with Metrora evidence.
9. ACT V2 is current trusted execution foundation; the model/proposal layer cannot self-authorize.
10. ACT is not a user-facing chat mode.
11. Local MCP is planned, read-only first and cannot bypass ACT.
12. Swarm is future and not shipped.
13. Local Community remains useful without a managed Metrora AI service.
