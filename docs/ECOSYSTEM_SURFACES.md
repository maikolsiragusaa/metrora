# Metrora ecosystem surfaces

**Status:** historical ecosystem map updated for the OpenCode engine spike
**Decision revision:** 2026-09-04
**Current implementation:** `feat/opencode-harness-engine-001`

Metrora is a local-first control and intelligence system for AI-assisted development. Its product surfaces should compose around shared facts and contracts rather than grow into separate products that each calculate their own version of the truth.

This page distinguishes what exists now from what is being built or remains planned.

## How the ecosystem fits together

```text
Usage · Activity · Models · Capacity · Projects
                  ↓
             Metrora evidence
             ┌─────────┼───────────┐
             ↓         ↓           ↓
          OpenCode    MCP      integrations
       coding engine  read-only

Bench   = methodology-bound test/evidence system
Widgets = shareable presentation of canonical evidence
Wrapped = recap/share experience built on canonical evidence + Widgets
```

Canonical rule:

> **OpenCode owns coding behavior. Metrora owns factual evidence. MCP exposes read-only Metrora projections.**

## Current status

| Surface | Product job | Status |
| --- | --- | --- |
| **Usage / Activity / Models / Capacity** | Factual local evidence, history, economics and provider-reported capacity | **Available** |
| **Projects** | User-controlled context and scope across relevant evidence | **Available** |
| **Tools** | Typed factual access to Metrora evidence | **Available** — canonical registry/contract/evidence/privacy layer for CLI and MCP |
| **OpenCode** | Normal coding/agent sessions over the local Workspace | **Ready for Founder spike test** — pinned upstream server/SDK, thin Electron lifecycle boundary and one read-only Metrora custom tool |
| **Bench** | Performance-first testing plus separate Compatibility / Runtime Health evidence | **Available** — native llama.cpp/`llama-bench` Performance and Core Compatibility are separate bounded paths |
| **MCP** | Standard external access to canonical Metrora Tools | **Available** — local read-only MCP Server V1 |
| **Widgets** | Shareable visual/statistical presentation of canonical evidence | **Foundation exists through Share Card; broader Widgets family planned** |
| **Wrapped** | Periodic recap/share experience using canonical evidence and Widgets | **Planned** |

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

The reusable implementation now lives in `src/tools` for the existing CLI and
local MCP boundary. The OpenCode Desktop integration has one separate
`metrora_usage_snapshot` custom tool; it does not expose the entire Metrora
tool registry to the coding engine.

This keeps factual evidence canonical without making Metrora a second coding
agent or provider runtime.

A tool result remains evidence. A caller or model may explain it, but cannot silently replace Metrora's canonical measurement, scope or unavailable-state semantics.

## OpenCode

OpenCode is the product-facing Desktop coding engine. It owns the normal
session, transcript, provider/model, reasoning, tool, filesystem, shell, git,
permission, plan/build, subagent, retry, cancellation, MCP, ACP, LSP and
formatter behavior.

Metrora launches the exact pinned upstream executable on loopback, forwards
typed renderer-safe projections, and provides one read-only
`metrora_usage_snapshot` custom tool backed by canonical Metrora status. It
does not authorize or execute a second Metrora action runtime.

See [OpenCode Engine Spike 001](OPENCODE_ENGINE_SPIKE_001.md) for the precise
version, packaging, privacy and validation boundary.

## MCP

Metrora adopts the Model Context Protocol as an interoperability direction.

The shipped first product is a **local, read-only Metrora MCP Server V1** that
exposes canonical factual Tools independently of the OpenCode coding engine.

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

The current MCP server remains read-only. Any future mutation path would need
an explicitly reviewed Metrora authority; OpenCode permissions are not reused
as a Metrora accounting or Workspace authorization layer.

## Bench

Metrora Bench remains a separate evidence system rather than becoming a generic “AI score”.

Primary direction:

- **Performance** — how a declared model/runtime/configuration actually runs on declared hardware.

Separate evidence families:

- **Compatibility / Runtime Health** — including the current deterministic `core-v1` checks;
- **Coding Evaluation** — future, separately versioned and methodology/licence gated;
- **Agent Evaluation** — later, with a separately versioned methodology.

Bench remains the canonical owner of Bench evidence/history.

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

- **OpenCode** for the Desktop coding engine;
- **Metrora Bench**;
- **Metrora MCP Server** on first/external mention.

Within an established Metrora context, prefer:

`OpenCode · Tools · MCP · Bench · Projects · Widgets`

rather than repeating “Metrora” before every noun.


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

1. **OpenCode Engine Spike 001** — validate the pinned upstream coding engine through the thin Desktop boundary.
2. **Local MCP Server V1** — keep the canonical Metrora factual tools read-only through MCP.
3. **README / asset refresh** — simplify the repository story and replace stale inherited marketing imagery with original Metrora visuals.
4. **Widgets V1** — evolve Share Card into reusable static, privacy-aware Widgets.
5. Maintain the independent **llama.cpp runtime / Performance Bench** path with focused compatibility, provenance and acceptance work.

See also:

- [`OPENCODE_ENGINE_SPIKE_001.md`](OPENCODE_ENGINE_SPIKE_001.md)
- [`BENCH_EVIDENCE_FAMILIES.md`](BENCH_EVIDENCE_FAMILIES.md)
- [`PRODUCT_PRINCIPLES.md`](PRODUCT_PRINCIPLES.md)
- [`PUBLIC_CONTRACTS_V1.md`](PUBLIC_CONTRACTS_V1.md)
