# OpenCode upstream surface

**Status:** accepted public Code foundation.

Metrora Desktop embeds the official upstream [OpenCode](https://github.com/anomalyco/opencode) runtime and Web UI as its **Code** destination.

This is a deliberate product decision: Metrora does not rebuild a second generic coding-agent engine merely to own the UI or session loop.

> **Metrora adds. OpenCode executes.**

## What this means

Inside Code, OpenCode remains responsible for ordinary coding mechanics such as:

- coding Sessions;
- Agents and Subagents;
- provider/model selection and reasoning controls;
- standard Tools;
- files and edits;
- shell/terminal;
- Git;
- ordinary permissions/questions;
- MCP/ACP mechanics supplied by OpenCode.

Metrora owns the surrounding product boundary:

- local usage/accounting evidence;
- Models, Projects, Capacity and Bench context where Metrora has canonical facts;
- bounded Metrora-specific Tool integrations;
- the Electron host/security lifecycle;
- provenance/version pinning;
- persistent project/browser state;
- packaging and clean shutdown.

The result is one coding surface, not two competing session universes.

## Current upstream pin

Metrora currently hosts OpenCode `1.18.27` from `anomalyco/opencode`.

Pinned upstream source commit:

`b04697366f05419e9bd7a92f841813dd976161c9`

The Windows binary is staged from the official release asset, verified against pinned release/binary provenance and packaged with the Desktop candidate.

OpenCode is MIT licensed; the required upstream notice is preserved in [`LICENSES/OPENCODE-MIT.txt`](../LICENSES/OPENCODE-MIT.txt).

Metrora does not automatically follow an unreviewed `latest` OpenCode binary. Future upstream updates require a deliberate provenance/security/packaging regression pass.

## Host architecture

```text
Metrora Desktop
      │
      ├─ Metrora product UI / facts / Tools
      │
      └─ Code
          │
          └─ Electron WebContentsView
                 │
                 └─ 127.0.0.1 only
                     OpenCode serve
                         │
                         └─ upstream Web UI + runtime
```

The sidecar is application-owned and listens on loopback only.

Accepted host properties include:

- `opencode serve` rather than opening an external browser;
- random per-launch Basic Auth credentials;
- credentials retained in Electron main-process authority rather than exposed to the renderer;
- exact-origin navigation restrictions;
- popup denial;
- persistent browser partition/project UI state;
- stable preferred loopback origin where available;
- prewarmed hidden loading so first Code entry does not require a cold white-page start;
- clean process shutdown when Metrora exits;
- deterministic Windows staging/packaging of the pinned runtime.

The Code renderer remains a host/layout surface rather than a custom OpenCode client.

## Project and session continuity

Metrora deliberately avoids creating a second OpenCode project/session database.

OpenCode's standard local session/data store remains OpenCode authority. The Metrora-hosted Web surface preserves its own browser/project UI state and can import the normal OpenCode Desktop project list through a bounded read-only path.

This gives users continuity without synchronizing two independent session engines.

## Metrora accounting

Activity from the embedded coding surface is identified under the canonical collector/provider identity:

`OpenCode`

Metrora being the host does not invent an `OpenCode-Metrora` provider or rewrite the actual model/provider identity contained in the underlying evidence.

Surface metadata can remain separate from provider/accounting identity when needed.

## Metrora-specific factual context

The accepted foundation includes a bounded Metrora custom-tool path inside OpenCode.

The first physically validated proof is:

`metrora_usage_snapshot`

It exposes a small sanitized read-only projection of current Metrora usage so a user can ask a Metrora-specific factual question inside Code and let OpenCode answer from Metrora evidence.

```text
user question in Code
      ↓
OpenCode tool selection
      ↓
bounded Metrora Tool/projection
      ↓
canonical Metrora evidence
      ↓
OpenCode explanation
```

The direction is to expand useful Metrora-specific factual capabilities by reusing the canonical Metrora Tool/evidence registry rather than copying accounting logic into OpenCode adapters.

Prompt/response bodies, source code, credentials and unrestricted local paths remain outside the default Metrora factual Tool boundary.

## MCP is a separate concept

OpenCode can consume MCP servers as part of its own coding environment.

Separately, Metrora exposes a local read-only MCP Server V1 for external access to canonical factual Metrora Tools.

These are different directions:

```text
OpenCode → external MCP tools
```

is not the same as:

```text
external client → Metrora → controlled work
```

Future inbound external control/remote supervision remains separately gated and should use an explicit Metrora-owned control boundary rather than assuming today's read-only MCP is an execution API.

## Physical acceptance

The foundation has been physically exercised through the embedded Code surface, including representative checks for:

- shell/terminal;
- file read/edit/write;
- Git/diff;
- provider/model/reasoning interaction;
- Agent/Subagent behavior;
- permissions/questions;
- MCP tool use;
- Metrora custom-tool use;
- navigation persistence;
- restart persistence;
- project continuity;
- clean OpenCode process shutdown.

The host prewarm/persistent-view behavior was also physically accepted.

These results establish the Code foundation. They do not imply that every future OpenCode version or every new Metrora Tool is automatically accepted without its own regression/physical check.

## Non-goals

This integration intentionally does not create:

- a forked OpenCode frontend;
- a Metrora clone of OpenCode sessions/agents;
- a second filesystem/shell/Git engine;
- a second generic permissions system around ordinary OpenCode actions;
- a browser-automation control plane;
- a fake provider identity for Metrora-hosted OpenCode usage.

## Third-party boundary

OpenCode is third-party upstream software and remains independently maintained. Metrora's use of OpenCode does not imply affiliation with, sponsorship by or endorsement from the OpenCode project.

Required licence/provenance notices remain governed by [`THIRD_PARTY_NOTICES.md`](../THIRD_PARTY_NOTICES.md), [`LICENSES/`](../LICENSES/) and the repository's pinned staging/verification authority.
