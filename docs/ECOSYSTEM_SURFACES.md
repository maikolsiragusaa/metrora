# Metrora ecosystem surfaces

**Status:** public product direction and implementation-status guide  
**Decision revision:** 2026-08-30  
**Authority reviewed:** `maikolsiragusaa/metrora@7aef30742153a190a59bcec2b13d8635feb5b9db`
**Productization slice:** `feat/harness-productization-v2-tools-boundary`

Metrora is a local-first control and intelligence system for AI-assisted development. Its product surfaces should compose around shared facts and contracts rather than grow into separate products that each calculate their own version of the truth.

This page distinguishes what exists now from what is being built or remains planned.

## How the ecosystem fits together

```text
Usage · Activity · Models · Capacity · Projects
                  ↓
             Metrora Tools
        ┌─────────┼───────────┐
        ↓         ↓           ↓
     Harness     MCP      integrations
        │
        └─ state-changing request
                  ↓
             proposal only
                  ↓
                 ACT
                  ↓
          bounded execution

Bench   = methodology-bound test/evidence system
Widgets = shareable presentation of canonical evidence
Wrapped = recap/share experience built on canonical evidence + Widgets
Swarm   = future coordinated Harness capability behind trusted authority
```

Canonical rule:

> **Tools expose capability. Harness and MCP consume capability. ACT grants execution authority.**

ACT is not a chat mode and an MCP client is not trusted execution authority simply because it can discover a Metrora tool.

## Current status

| Surface | Product job | Status |
| --- | --- | --- |
| **Usage / Activity / Models / Capacity** | Factual local evidence, history, economics and provider-reported capacity | **Available** |
| **Projects** | User-controlled context and scope across relevant evidence | **Available** |
| **Tools** | Typed factual access to Metrora evidence | **Available** — canonical registry/contract/evidence/privacy layer mounted directly in the Harness Tool registry |
| **Harness** | Coding-agent work, reasoning and Metrora-aware Tool use | **Available** — product-facing Desktop surface with one DSH Agent/Session path, Workspace, modes, approvals and bounded Tool activity |
| **Bench** | Performance-first testing plus separate Compatibility / Runtime Health evidence | **Available** — native llama.cpp/`llama-bench` Performance and Core Compatibility are separate bounded paths |
| **ACT** | Trusted authorization/lifecycle for bounded state-changing operations | **Available** — `metrora.action.v1`, `run-core-compatibility`, and the trusted Desktop bridge; not a user-facing mode |
| **MCP** | Standard external access to canonical Metrora Tools | **Available** — local read-only MCP Server V1 |
| **Widgets** | Shareable visual/statistical presentation of canonical evidence | **Foundation exists through Share Card; broader Widgets family planned** |
| **Wrapped** | Periodic recap/share experience using canonical evidence and Widgets | **Planned** |
| **Swarm** | Coordinated multi-agent Harness capability | **Planned** |

Status labels are intentionally conservative. A public direction is not presented as shipped until working product authority exists.

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

The reusable implementation lives in `src/tools`. Harness mounts the canonical
registry directly; the factual registry is not owned by one UI.

This matters because the same factual capability is reused by Harness, the Local MCP Server V1 and other bounded Metrora integrations without implementing parallel evidence paths.

A tool result remains evidence. A caller or model may explain it, but cannot silently replace Metrora's canonical measurement, scope or unavailable-state semantics.

## Harness

**Metrora Harness** is the product-facing conversational and operational AI surface.

The shipped Harness slice is a capable normal chat experience. Metrora-specific facts are read through typed Tools only when needed. Observable Tool activity is compact and bounded without exposing private chain-of-thought, prompts, secrets or paths.

For state-changing requests, the conversational layer may understand the request and prepare a bounded proposal, but it does not authorize itself. The only accepted operation in this slice is Core Compatibility; confirmation is canonicalized and executed by the trusted host/ACT path.

```text
conversation
→ optional factual Tools
→ explanation
→ action proposal when requested
→ explicit trusted approval
→ ACT
```

The former conversational implementation has been retired. Product/runtime
responsibilities now live in Harness, the canonical Tools registry, provider
adapters, Workspace authority and evidence modules.

## MCP

Metrora adopts the Model Context Protocol as an interoperability direction.

The shipped first product is a **local, read-only Metrora MCP Server V1** that exposes the same canonical factual Tools used by Harness.

A compatible external AI client could then ask a question such as:

> “How much did I spend today?”

and use Metrora's factual evidence instead of guessing or requiring a new Metrora-specific model integration.

Local MCP V1 principles:

- local-first and account-optional;
- public Community interoperability;
- read-only first;
- no duplicate MCP-specific accounting/evidence engine;
- no arbitrary shell, filesystem, repository or secret access;
- no ability to bypass Metrora privacy/scope contracts;
- failure of MCP cannot corrupt canonical Metrora history.

A future hosted MCP surface may be offered separately for managed remote access or other hosted capabilities. Local MCP remains a local read authority and is not a hosted metering product.

### Future actions through MCP

External AI clients may later be able to **propose** bounded Metrora actions. They do not gain direct ACT or Swarm authority.

```text
external AI
→ MCP
→ bounded proposal
→ Metrora trusted authority
→ explicit user approval
→ ACT
→ bounded execution
```

Any future Swarm capability follows the same authority rule.

## Bench

Metrora Bench remains a separate evidence system rather than becoming a generic “AI score”.

Primary direction:

- **Performance** — how a declared model/runtime/configuration actually runs on declared hardware.

Separate evidence families:

- **Compatibility / Runtime Health** — including the current deterministic `core-v1` checks;
- **Coding Evaluation** — future, separately versioned and methodology/licence gated;
- **Agent / Harness Evaluation** — later, once real coordinated execution exists.

ACT may invoke a supported Bench operation, but Bench remains the canonical owner of Bench evidence/history.

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

`Usage · Activity · Models · Capacity · Projects · Settings`

Systems with an independent interaction model or authority can carry a branded name when useful:

- **Metrora Harness**;
- **Metrora Bench**;
- **Metrora MCP Server** on first/external mention.

Within an established Metrora context, prefer:

`Harness · Tools · MCP · Bench · Projects · Widgets`

rather than repeating “Metrora” before every noun.

`ACT` remains an execution authority, not a primary navigation item. `Swarm` remains future functionality until it actually ships.

## Public README direction

The repository README should become easier for both users and future contributors to understand at a glance.

The ratified direction is:

- immediate download/install actions near the top;
- a concise product thesis;
- an original visual ecosystem map;
- large visual feature sections instead of long walls of documentation;
- clear `Available`, `Building` and `Planned` labels;
- local-first/privacy positioning;
- supported-tools credibility;
- obvious routes into documentation and contribution.

Modern visual OSS READMEs such as LobeHub are useful composition references, but Metrora should create original artwork and copy rather than clone another project's images or page pixel-for-pixel.

Conceptual branded illustrations are preferable to screenshots that would immediately become stale while the target Desktop UX is still moving.

## Visual-asset provenance

Metrora contains historical visual material inherited from the incorporated upstream snapshot. A 2026-08-30 audit confirmed that multiple old top-level repository marketing/screenshots in `assets/` are byte-identical to material from that incorporated upstream source.

Those files should be audited before the README visual redesign:

- remove obsolete inherited screenshots when proven unused;
- do not use inherited marketing imagery as new Metrora brand artwork;
- do not delete runtime/package assets without proving they are unused;
- review provider logos/icons separately because trademark/asset rights are independent from repository code licensing;
- replace README/marketing visuals progressively with original Metrora artwork or current truthful screenshots.

Required upstream provenance and licence notices remain governed by `THIRD_PARTY_NOTICES.md` and `LICENSES/`.

## Near-term progression

This is a dependency-oriented direction, not a rigid roadmap gate:

1. **Harness Productization** — establish Harness as the product identity, extract canonical Tools and connect action requests only through proposal → ACT.
2. **Local MCP Server V1** — shipped in Interoperability Foundation Wave 001; expose the same factual Tools read-only through MCP.
3. **README / asset refresh** — simplify the repository story and replace stale inherited marketing imagery with original Metrora visuals.
4. **Widgets V1** — evolve Share Card into reusable static, privacy-aware Widgets.
5. Maintain the independent **llama.cpp runtime / Performance Bench** path with focused compatibility, provenance and acceptance work.
6. External action proposals and **Swarm** remain later, separately authorized capability work.

See also:

- [`HARNESS_PUBLIC_FOUNDATION.md`](HARNESS_PUBLIC_FOUNDATION.md)
- [`BENCH_EVIDENCE_FAMILIES.md`](BENCH_EVIDENCE_FAMILIES.md)
- [`PRODUCT_PRINCIPLES.md`](PRODUCT_PRINCIPLES.md)
- [`PUBLIC_CONTRACTS_V1.md`](PUBLIC_CONTRACTS_V1.md)
