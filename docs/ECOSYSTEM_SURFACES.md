# Metrora ecosystem surfaces

**Status:** public product direction and implementation-status guide  
**Decision revision:** 2026-09-05  
**Authority reviewed:** `maikolsiragusaa/metrora@c960183820467c73ce92c8ccc606a6dd3552c80c`

Metrora is a local-first control and intelligence system for AI-assisted development. Product surfaces compose around shared facts/contracts instead of growing into parallel engines that each invent their own truth or execution mechanics.

This page distinguishes what exists now from what remains future work.

## How the ecosystem fits together

```text
Usage · Activity · Models · Capacity · Projects
                  ↓
             Metrora Tools
         ┌─────────┼───────────┐
         ↓         ↓           ↓
        MCP   integrations   Desktop
                                  │
                                  └─ Code
                                     ↓
                                  OpenCode
                         Sessions · Agents · Tools
                         files · shell · Git · MCP/ACP

Bench   = methodology-bound test/evidence system
Widgets = shareable presentation of canonical evidence
Wrapped = recap/share experience built on canonical evidence + Widgets
```

Canonical rule for the Code surface:

> **Metrora adds. OpenCode executes.**

Metrora owns the host boundary, canonical evidence/accounting and Metrora-specific Tools/context. OpenCode owns the commodity coding surface and its Sessions, Agents/Subagents, provider/model controls, standard Tools, filesystem/shell/Git mechanics and ordinary permissions/questions.

## Current status

| Surface | Product job | Status |
| --- | --- | --- |
| **Usage / Activity / Models / Capacity** | Factual local evidence, history, economics and provider-reported capacity | **Available** |
| **Projects** | User-controlled Metrora context and scope across relevant evidence | **Available** |
| **Tools** | Typed factual access to Metrora evidence | **Available** — canonical registry, contract, evidence and privacy layer |
| **Code** | Coding/agent work through official upstream OpenCode hosted by Desktop | **Available** — accepted OpenCode `1.18.27` runtime/Web UI with Metrora host lifecycle, security, packaging and accounting integration |
| **Bench** | Performance-first testing plus separate Compatibility / Runtime Health evidence | **Available** — native llama.cpp/`llama-bench` Performance and Core Compatibility are separate bounded paths |
| **ACT / ActionContract** | Trusted lifecycle for the bounded Metrora-owned Core Compatibility action | **Available for that narrow operation** — not a user-facing mode and not a universal wrapper around Code |
| **MCP** | Standard external access to canonical Metrora Tools | **Available** — local read-only MCP Server V1 |
| **Widgets** | Shareable visual/statistical presentation of canonical evidence | **Foundation exists through Share Card; broader Widgets family planned** |
| **Wrapped** | Periodic recap/share experience using canonical evidence and Widgets | **Planned** |
| **Durable Jobs / remote control** | Future Metrora-owned work/status/result control above local sessions when needed | **Future / separately gated** |

Status labels are intentionally conservative. A direction is not presented as shipped until working product authority exists.

## Code

The Desktop **Code** destination hosts the real official upstream OpenCode Web UI/runtime rather than a Metrora reconstruction of it.

Current accepted host boundary includes:

- pinned OpenCode `1.18.27`;
- deterministic staged binary/provenance checks;
- loopback-only embedded server;
- random per-launch authentication held by the Electron main process;
- exact-origin navigation restrictions and popup denial;
- persistent upstream browser/project UI state;
- clean sidecar shutdown;
- Windows packaging paths that include the pinned OpenCode runtime.

OpenCode remains upstream authority for its own coding Sessions and agent mechanics. Metrora does not create a second conversation/session universe for the same work.

Metrora accounting continues to identify this source as **OpenCode**. Being launched inside Metrora does not invent a new provider identity.

## Metrora Tools inside Code

Metrora-specific intelligence is added to the upstream Code surface through bounded Metrora Tools rather than through a parallel coding-agent engine.

The first accepted end-to-end proof is `metrora_usage_snapshot`:

```text
user asks a Metrora-specific question in Code
→ OpenCode selects metrora_usage_snapshot
→ Metrora returns bounded canonical evidence
→ OpenCode explains the result
```

Future factual Tool expansion should reuse the same canonical Metrora registries/contracts used elsewhere rather than implement Code-specific accounting or evidence paths.

A Tool result remains evidence. A caller or model may explain it, but cannot silently replace Metrora's canonical measurement, scope or unavailable-state semantics.

## Tools

Metrora already has typed read-only capabilities for questions such as:

- spend/Usage snapshots;
- model-efficiency evidence;
- provider Capacity/quota snapshots;
- overview evidence;
- Project drivers;
- Session highlights;
- coverage information;
- Bench evidence.

The reusable implementation lives in `src/tools`; the factual registry is not owned by one UI.

The same factual capability can therefore be consumed by Local MCP, Code integrations and other bounded surfaces without implementing parallel evidence engines.

## MCP

Metrora adopts the Model Context Protocol as an interoperability direction.

The shipped first product is a **local, read-only Metrora MCP Server V1** that exposes canonical factual Tools.

A compatible external AI client can use Metrora facts without requiring AI traffic to pass through a Metrora proxy.

Local MCP V1 principles:

- local-first and account-optional;
- public Community interoperability;
- read-only first;
- no duplicate MCP-specific accounting/evidence engine;
- no arbitrary shell, filesystem, repository or secret access;
- no ability to bypass Metrora privacy/scope contracts;
- failure of MCP cannot corrupt canonical Metrora history.

A future hosted or state-changing control surface is separate work. OpenCode's ability to consume MCP servers is also distinct from exposing Metrora for inbound external control.

### Future control through external clients

Future external control should use an explicit bounded Metrora-owned control object rather than grant a client generic execution authority.

Conceptually:

```text
external AI client
→ Metrora MCP or bounded control API
→ Metrora facts / Project / optional durable Job
→ authorized execution through an accepted runtime where needed
→ status / result / evidence
```

The exact Job/control schema, authorization and remote lifecycle are future work. Local MCP V1 remains read-only until such a contract exists.

Browser/UI automation is not part of the public architecture described here.

## ACT / ActionContract

The current public ActionContract foundation is intentionally narrow.

Today it binds `metrora.action.v1` to the bounded `run-core-compatibility` workflow and its confirmation/lifecycle/evidence semantics.

It remains useful for that Metrora-owned operation, but it should not be interpreted as a requirement that every ordinary OpenCode file edit, shell command or Git action pass through a second Metrora permission engine. Those everyday coding mechanics belong to the accepted upstream Code surface.

If Metrora later introduces stronger Metrora-owned effects — for example remote/background Jobs or other explicitly authorized product workflows — they require their own bounded trust/control contracts.

## Bench

Metrora Bench remains a separate evidence system rather than becoming a generic “AI score”.

Primary direction:

- **Performance** — how a declared model/runtime/configuration actually runs on declared hardware.

Separate evidence families:

- **Compatibility / Runtime Health** — including the current deterministic `core-v1` checks;
- **Coding Evaluation** — future, separately versioned and methodology/licence/sandbox gated;
- **Agent Evaluation** — future, separately versioned and methodology/isolation gated.

The existence of real OpenCode Agent/Subagent execution does not by itself define an Agent Evaluation methodology.

A supported ActionContract may invoke a specific Bench workflow, but Bench remains the canonical owner of Bench evidence/history.

## Widgets and Wrapped

Metrora already has a local **Share Card** foundation. The broader direction is to evolve this into **Widgets**: reusable, privacy-aware visual presentations of canonical Metrora evidence.

Possible future Widgets include:

- Usage/cost cards;
- model/provider mix;
- Project or Activity summaries;
- Bench Performance results;
- Compatibility results;
- methodology-labelled comparisons.

Local static sharing should remain useful without requiring an account. Any future hosted/live sharing is a separate service decision.

**Wrapped** is not a second analytics engine. It is a recap/share experience — for example monthly or annual — built from canonical Metrora evidence and Widget presentation primitives.

## Naming

Ordinary pages stay concise:

`Usage · Activity · Models · Capacity · Projects · Code · Bench · Settings`

Systems with an independent interaction/protocol identity can carry a fuller name on first/external mention, for example:

- **Metrora Bench**;
- **Metrora MCP Server**.

Within an established Metrora context, prefer:

`Code · Tools · MCP · Bench · Projects · Widgets`

rather than repeating “Metrora” before every noun.

`ACT` remains an internal/bounded action authority, not a primary navigation item. There is no current separate `Swarm` product surface.

## Public README direction

The repository README should remain easy for users and contributors to understand at a glance:

- immediate download/install actions near the top;
- concise `Observe · Compare · Code · Control` thesis;
- truthful current Code/OpenCode boundary;
- clear current/future labels;
- local-first/privacy positioning;
- supported-tools credibility;
- obvious routes into documentation and contribution.

Original Metrora visuals/copy are preferred over cloning another project's branded imagery.

## Visual-asset provenance

Metrora contains historical visual material inherited from the incorporated upstream snapshot. A 2026-08-30 audit confirmed that multiple old top-level repository marketing/screenshots in `assets/` are byte-identical to material from that incorporated upstream source.

Before using assets for current Metrora marketing:

- remove obsolete inherited screenshots when proven unused;
- do not present inherited marketing imagery as new Metrora brand artwork;
- do not delete runtime/package assets without proving they are unused;
- review provider logos/icons separately because trademark/asset rights are independent from repository code licensing;
- replace README/marketing visuals progressively with original Metrora artwork or current truthful screenshots.

Required upstream provenance/licence notices remain governed by `THIRD_PARTY_NOTICES.md` and `LICENSES/`.

## Near-term progression

This is dependency-oriented direction, not a rigid roadmap gate:

1. **Code/OpenCode** — keep the accepted pinned upstream surface, host/security/persistence/accounting and packaging boundary healthy.
2. **Code host UX** — reduce first-entry latency/blank loading at the host layer without reconstructing the upstream UI.
3. **Metrora Tools in Code** — add the highest-value bounded factual capabilities through canonical Tool contracts.
4. **Local MCP V1** — keep factual/read-only interoperability stable; stronger control remains separately gated.
5. **README / asset truthfulness** — keep the public story aligned with the shipped product.
6. **Widgets** — evolve Share Card into reusable static/privacy-aware presentations when useful.
7. Maintain independent **llama.cpp / Performance Bench** reliability/provenance work.
8. Durable Job/external-control work remains later and separately authorized.

See also:

- [`BENCH_EVIDENCE_FAMILIES.md`](BENCH_EVIDENCE_FAMILIES.md)
- [`ACT_CONTRACT_PREP_001.md`](ACT_CONTRACT_PREP_001.md)
- [`PRODUCT_PRINCIPLES.md`](PRODUCT_PRINCIPLES.md)
- [`PUBLIC_CONTRACTS_V1.md`](PUBLIC_CONTRACTS_V1.md)
