# Metrora Harness public foundation

**Status:** public product/architecture direction grounded in current `main`  
**Implementation compatibility:** the current Desktop/code/contracts still use `Advisor` / `Advisor*` identifiers; a bounded user-facing naming/UX migration is not yet implemented by this document.

## What Metrora Harness means

**Metrora Harness** is the product-facing direction for Metrora's conversational and operational AI surface.

Canonical interaction rule:

> **Chat first. Tools when useful. Actions only with authority.**

Harness is a normal capable conversational surface. A configured model can help with ordinary conversation, coding, explanations and reasoning. When the user asks for user-specific Metrora facts, the model can use the fixed typed Metrora read tools instead of guessing those facts.

The model is not Metrora's accounting, pricing, quota or action authority.

## Current shipped foundation

Current public `main` already implements the foundation under the existing `Advisor*` names:

- chat-first behavior for capable configured runtimes;
- ordinary conversation without requiring an evidence read;
- bounded same-scope conversation history;
- bounded typed UI context;
- fixed read-only Metrora tools;
- canonical fact/evidence verification;
- proposal-only handling for state-changing requests;
- Ollama and LM Studio local runtimes;
- supported direct BYOK provider adapters;
- explicit hosted evidence-sharing consent;
- bounded cancellation/error/privacy behavior.

See [Advisor implementation compatibility](ADVISOR_PUBLIC_FOUNDATION.md) for the current public contract names and exact shipped runtime/tool details.

This document does **not** add or claim:

- state-changing execution;
- arbitrary shell or repository access;
- agents or Swarm;
- managed Metrora inference;
- new runtime/provider adapters;
- persistent cloud conversation memory.

## Conversation vs factual authority

Ordinary conversation does not need a Metrora evidence bundle.

For user-specific Metrora facts, the desired path is:

```text
user question
→ model decides a bounded read is useful
→ Metrora validates tool + scope
→ canonical Metrora evidence
→ model explains/synthesizes
→ Metrora keeps factual claims within accepted evidence
```

The read result is **evidence**, not automatically the whole answer.

For example, a question such as:

> Why did I spend about $2 today?

should not stop at repeating the total when Metrora has bounded breakdown/driver evidence capable of answering the question more usefully. Harness should read the smallest sufficient evidence, describe observed contributors and make material limits clear. It must not invent causality or quality claims that the evidence does not prove.

## Observable activity, not chain-of-thought

The Harness UX is intended to expose useful **observable work** similar to modern coding harnesses and IDE agents.

Examples of safe observable events:

- `Reading spend · Today`;
- tool started/completed/unavailable;
- bounded scope used;
- evidence freshness/coverage where material;
- action proposal/progress when the approved ACT path is invoked.

Private chain-of-thought, hidden scratchpads and internal model reasoning are not product telemetry and should not be exposed.

## Pending and streaming UX direction

A future Harness UX tranche should make prompt processing unmistakable:

```text
message sent
→ immediate visible pending state
→ optional tool activity
→ streamed answer where supported
→ final answer
```

Product language should remain simple, for example `Thinking…`, `Reading spend…`, `Checking sessions…` rather than exposing planner/guard/schema terminology.

The current public foundation already has bounded request/progress mechanics, but this document does not claim the future polished Harness presentation is implemented.

## Runtime/model interaction direction

The primary conversation should remain central. Runtime/provider/model controls should become compact and quick to change instead of dominating the conversation surface.

Current local runtime support:

- Ollama;
- LM Studio.

A future llama.cpp / `llama-server` adapter is a planned public Community direction, not current support.

Any new runtime/provider still requires explicit endpoint, privacy, streaming, tool and failure-semantics review. `OpenAI-compatible` by itself is not a compatibility guarantee.

## Tools

Current implementation uses the public `AdvisorToolV1` contract. Stable identities remain documented in [Advisor implementation compatibility](ADVISOR_PUBLIC_FOUNDATION.md).

The tool boundary stays:

- fixed and allowlisted;
- read-only for the current foundation;
- scope-bounded;
- content-minimal;
- cancellation-aware;
- explicit about freshness/coverage/unavailable state.

Future tool growth should prefer useful bounded factual drill-downs over unrestricted database/file access.

## ACT boundary

Harness may understand a state-changing request and prepare a proposal. It is not execution authority.

Canonical relationship for the implemented foundation (not wired to Harness UI):

```text
Harness intent / proposal
→ explicit trusted ACT contract + confirmation
→ bounded executor
→ lifecycle + canonical result/evidence
→ Harness explanation
```

ACT is an execution authority underneath product workflows, not a chat mode the user must select first.

Current public [ACT preparation](ACT_CONTRACT_PREP_001.md) describes the bounded `metrora.action.v1` Core Compatibility executor. Harness/Advisor remains proposal-only; this branch does not add Harness UI or navigation integration.

## Swarm direction

**Swarm** is the name reserved for a future Harness mode that coordinates multiple workers/subagents under explicit policy and action authority.

No Swarm implementation is shipped by this document.

A future `Swarm · Soon` UI can be truthful only when clearly disabled/unavailable and must not imply autonomous repository execution already exists.

## Bench relationship

Harness may read and explain canonical Bench evidence. It may not rescore or reinterpret a Bench family as something it does not measure.

Public Bench evidence families are documented in [Bench evidence families](BENCH_EVIDENCE_FAMILIES.md).

## Privacy

Current public privacy rules remain:

- local use does not require a Metrora account;
- direct BYOK credentials remain on the endpoint and use protected local custody;
- raw prompts/responses/source/patches/secrets/unrestricted paths are outside factual tool outputs;
- hosted BYOK requires explicit evidence-sharing consent;
- conversation state is currently client/session managed;
- no Metrora managed inference gateway exists in the current public foundation.

## Naming compatibility

The product direction is **Metrora Harness**.

Current stable implementation names such as:

- `AdvisorKernel`;
- `AdvisorToolV1`;
- `AdvisorActionProposalV1`;
- current route/file/schema identifiers;

remain valid until a bounded migration demonstrates the compatibility cost is justified.

Do not mass-rename stable public contracts merely for cosmetic consistency.

## Public/private boundary

This public repository contains the reusable Community foundation: canonical facts, generic conversation/tool mechanics, supported runtime/provider adapters, evidence verification and public safety contracts.

It does not publish private commercial algorithms, private evaluation/playbook assets, proprietary routing/recommendation systems or managed-service implementation.

## Ratified public principles

1. Product-facing direction: **Metrora Harness**.
2. Existing `Advisor*` identifiers remain implementation-compatible until bounded migration.
3. Capable runtimes may converse normally; conversation is not limited to Metrora analytics questions.
4. User-specific Metrora facts come from bounded typed tools.
5. Tool results should be explained/synthesized when useful.
6. Observable tool/action activity may be shown; private chain-of-thought is not.
7. Factual authority remains with Metrora evidence.
8. ACT, not the model, owns future state-changing authorization.
9. Swarm is future and not shipped.
10. Local Community remains useful without a managed Metrora AI service.
