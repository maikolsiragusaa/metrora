# Metrora documentation

Metrora is the local-first control center for AI-assisted development: observe local evidence, compare models and providers, code through the upstream OpenCode surface, and control the Metrora-owned context around that workflow.

If you are new to the project, start with the product first. Deep contracts, migration evidence and release mechanics are intentionally kept lower on this page.

## Start here

| I want to… | Read |
| --- | --- |
| install Metrora or build it from source | [Getting started](GETTING_STARTED.md) |
| understand what Metrora is and why it is local-first | [Product principles](PRODUCT_PRINCIPLES.md) |
| understand the system at a glance | [Architecture](architecture.md) |
| see what is shipped versus future direction | [Ecosystem surfaces](ECOSYSTEM_SURFACES.md) |
| understand Code and the OpenCode boundary | [OpenCode upstream surface](OPENCODE_UPSTREAM_SURFACE_001.md) |
| see which AI tools Metrora can inspect | [Supported tools](SUPPORTED_TOOLS.md) |
| use the CLI | [CLI reference](CLI_REFERENCE.md) |
| understand cost/accounting semantics | [Accounting and pricing](ACCOUNTING_AND_PRICING.md) |
| understand Bench | [Bench evidence families](BENCH_EVIDENCE_FAMILIES.md) |
| pair Android with Desktop | [Android companion foundation](ANDROID_COMPANION_FOUNDATION.md) |
| integrate with the local companion API | [Local companion API](LOCAL_COMPANION_API.md) |

## The product in one map

```text
Observe   → Usage · Activity · Sessions · Projects
Compare   → Models · economics · Bench · coverage
Code      → upstream OpenCode inside Metrora Desktop
Control   → Capacity · budgets · Project context · explicit Metrora-owned actions
```

The core architectural split is:

> **Metrora adds. OpenCode executes.**

Metrora owns canonical facts, accounting, provenance, Projects, Capacity, Bench, its Tool contracts and the Desktop host boundary. OpenCode owns commodity coding mechanics inside Code: sessions, agents/subagents, standard tools, files, shell, Git and its ordinary interaction flow.

Metrora does not require a second generic agent engine in order to add value around Code.

## Install and use Metrora

### Desktop and Android

- **Windows:** [Microsoft Store](https://apps.microsoft.com/detail/9NXSZFQSBBDX)
- **Android:** [Google Play](https://play.google.com/store/apps/details?id=eu.metrora.app)
- **Source / development:** [Getting started](GETTING_STARTED.md)

Android is a companion to an explicitly paired Desktop. Desktop/core remains authoritative for collection, normalization, pricing, accounting, history and evidence; Android consumes bounded projections rather than creating a second factual engine.

### CLI and local web

- [CLI reference](CLI_REFERENCE.md) — public commands grouped by task.
- [Provider discovery outcomes](PROVIDER_DISCOVERY_OUTCOMES_V1.md) — success, empty, unavailable, failed, partial and cancelled semantics.
- [Provider documentation](providers/) — source locations, formats and limitations for individual integrations.

The local browser dashboard is served from the user's machine; it is not a hosted Metrora account service.

## Understand the factual layer

Metrora treats evidence quality as product data rather than an implementation detail.

Useful references:

- [Accounting and pricing](ACCOUNTING_AND_PRICING.md) — evidence precedence, pricing identity and durable cost semantics.
- [Cost assignment v1](COST_ASSIGNMENT_V1.md) — immutable per-call cost assignments and provenance.
- [Pricing history](PRICING_HISTORY.md) — reviewed date-effective pricing records.
- [Provider quota authority](provider-quota-authority.md) — provider-reported Capacity semantics and freshness.
- [Collector inventory v1](COLLECTOR_INVENTORY_V1.md) — generated collector inventory and signed-measurement eligibility.
- [Canonical history read projection](CANONICAL_HISTORY_READ_PROJECTION_V1.md) — canonical observation/activity read boundary.
- [Canonical history shadow store](CANONICAL_HISTORY_SHADOW_STORE_V1.md) — removable content-addressed persistence and reconciliation.
- [Canonical history parity observer](CANONICAL_HISTORY_PARITY_OBSERVER_V1.md) — parity validation before publication.
- [CLI status C3 dual-read](CANONICAL_HISTORY_CLI_DUAL_READ_V1.md) — bounded dual-read consumer and fallback boundary.

The rule across these documents is consistent: missing, stale or uninspected evidence must not silently become a confident value.

## Code and integrations

### Code / OpenCode

Metrora Desktop hosts the official upstream OpenCode Web UI/runtime instead of reconstructing it.

Read:

- [OpenCode upstream surface](OPENCODE_UPSTREAM_SURFACE_001.md) — pinned upstream, host lifecycle, security and persistence boundaries.
- [Ecosystem surfaces](ECOSYSTEM_SURFACES.md) — current Code/Tools/MCP/Bench composition and future direction.
- [Architecture](architecture.md) — responsibility map for the public repository.

OpenCode is third-party upstream software and remains independently maintained. Metrora's integration does not imply affiliation with or endorsement by the OpenCode project.

### Metrora Tools and MCP

Metrora's factual Tool contracts are designed to be reused by bounded surfaces instead of copied into each UI or integration.

The shipped local MCP Server V1 is factual/read-only. Stronger future control is intentionally separate from today's MCP authority and must not be inferred from the existence of read-only tools.

See [Ecosystem surfaces](ECOSYSTEM_SURFACES.md) and [CLI reference](CLI_REFERENCE.md).

## Bench

Metrora Bench keeps different questions as different evidence families.

| Family | Current state |
| --- | --- |
| Performance | **Available foundations:** bounded runtime timing and native llama.cpp/`llama-bench` evidence |
| Compatibility / Runtime Health | **Available:** deterministic Core Compatibility |
| Coding Evaluation | **Future / not shipped** |
| Agent Evaluation | **Future / not shipped**; real OpenCode Agent/Subagent execution exists, but a reproducible evaluation methodology remains separate work |

No current Bench result is a universal model-quality ranking.

Read:

- [Bench evidence families](BENCH_EVIDENCE_FAMILIES.md)
- [Local runtime and Performance Wave 001](LOCAL_RUNTIME_PERFORMANCE_WAVE_001.md)
- [BenchRunV1 local Ollama](BENCHRUN_V1_OLLAMA_LOCAL.md)
- [Bench Core Compatibility v1](BENCH_TASK_PACK_V1.md)

## Android and device connectivity

Metrora for Android is live on Google Play and remains a bounded companion to Desktop.

- [Android companion foundation](ANDROID_COMPANION_FOUNDATION.md) — secure pairing and the implemented mobile product foundation.
- [Mobile Product Parity V1](MOBILE_PRODUCT_PARITY_V1.md) — Desktop/core versus Android capability inventory.
- [Local companion API](LOCAL_COMPANION_API.md) — stable local HTTPS endpoints and content-minimal contracts.
- [Android public distribution](ANDROID_PUBLIC_DISTRIBUTION_V1.md) — Google Play/direct-channel identity, signing and release boundaries.

## Workspace and verifiable evidence

The public repository also contains the local Workspace/evidence foundation used for endpoint identity, reviewed measurements, signed batches and user-owned export.

- [Workspace v1](WORKSPACE_V1.md)
- [Local endpoint identity and outbox v1](LOCAL_ENDPOINT_IDENTITY_AND_OUTBOX_V1.md)
- [Workspace production scope v1](WORKSPACE_PRODUCTION_SCOPE_V1.md)
- [Workspace evidence export v1](WORKSPACE_EVIDENCE_EXPORT_V1.md)
- [Workspace recovery v1](WORKSPACE_RECOVERY_V1.md)
- [Reviewed event factory v1](REVIEWED_EVENT_FACTORY_V1.md)
- [Public contracts v1](PUBLIC_CONTRACTS_V1.md)

These documents describe public behavior and compatibility boundaries. They do not publish a private product or commercial execution plan.

## Distribution and release engineering

Ordinary users should start from the Store links above. The documents below exist for reproducible source/artifact identity, contributor validation and release engineering.

### Windows

- [Windows distribution](WINDOWS_DISTRIBUTION.md)
- [Windows Store package identity v1](WINDOWS_STORE_IDENTITY_V1.md)
- [Windows Store local package test](WINDOWS_STORE_LOCAL_TEST_GUIDED.md)
- [Windows release candidate v1](WINDOWS_RELEASE_CANDIDATE_V1.md)
- [Windows format derivation v1](WINDOWS_FORMAT_DERIVATION_V1.md)
- [Windows clean install v1](WINDOWS_CLEAN_INSTALL_V1.md)
- [Windows interrupted upgrade recovery v1](WINDOWS_INTERRUPTED_UPGRADE_RECOVERY_V1.md)
- [Windows GitHub pre-release acceptance v1](WINDOWS_GITHUB_PRE_RELEASE_ACCEPTANCE_V1.md)
- [Windows physical acceptance](WINDOWS_PHYSICAL_ACCEPTANCE_GUIDED.md)

### Android

- [Android public distribution v1](ANDROID_PUBLIC_DISTRIBUTION_V1.md)
- [Versioning](VERSIONING.md)
- [Releasing Metrora](../RELEASING.md)
- [Changelog](../CHANGELOG.md)

Historical acceptance documents remain useful reproducible evidence for the source/artifact they name; they do not override current Store status.

## Compatibility and implementation references

These are useful when changing internals, migrations or public contracts:

- [Technical identity compatibility](TECHNICAL_IDENTITY_COMPATIBILITY.md)
- [ACT contract preparation 001](ACT_CONTRACT_PREP_001.md)
- [Public contracts v1](PUBLIC_CONTRACTS_V1.md)
- [Product principles](PRODUCT_PRINCIPLES.md)

ACT remains a narrow Metrora-owned action authority where explicitly documented; it is not a second universal permission wrapper around ordinary OpenCode operations.

## Public direction

The public directional map lives in [Ecosystem surfaces](ECOSYSTEM_SURFACES.md).

At a high level, Metrora is moving toward:

```text
richer factual Sessions / Activity / Models
                ↓
deeper Projects / Capacity / Bench context
                ↓
more reusable Metrora Tools
                ↓
bounded external control + remote/background supervision
                ↓
smarter evidence-aware assistance and automation
```

That is a public direction, not a delivery promise or publication of private sequencing. Shipped and future capabilities remain explicitly labelled.

## Contribute safely

- [Contributing](../CONTRIBUTING.md) — contribution workflow and validation requirements.
- [Contributing pricing data](CONTRIBUTING_PRICING.md) — evidence and fail-closed rules for reviewed pricing changes.
- [Security policy](../SECURITY.md) — private vulnerability reporting.
- [Third-party notices](../THIRD_PARTY_NOTICES.md) — required licences and component notices.
- [Brand policy](../BRAND_POLICY.md) — product identity and permitted brand use.

## Documentation rule

Public documentation may explain current behavior, stable guarantees, current limitations and clearly labelled future direction. It must not expose private infrastructure, credentials, internal budgets, unpublished commercial packaging, private sequencing or implementation details that are not necessary for users, contributors or interoperability.
