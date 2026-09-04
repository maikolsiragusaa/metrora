<div align="center">

<img src="./assets/brand/metrora-lockup.svg" alt="Metrora" width="520" />

### The local-first control center for AI-assisted development

Bring usage, cost, models, projects, provider capacity, Bench and chat-first investigation into one coherent view — without putting a mandatory proxy between you and your AI tools.

[Get Metrora for Windows](https://apps.microsoft.com/detail/9NXSZFQSBBDX) · [Get the Android companion](https://github.com/maikolsiragusaa/metrora/releases/tag/android-v0.1.0-alpha.3) · [Build from source](docs/GETTING_STARTED.md)

[Website](https://metrora.eu) · [Documentation](docs/README.md) · [Supported tools](docs/SUPPORTED_TOOLS.md)

[![Metrora CI](https://github.com/maikolsiragusaa/metrora/actions/workflows/ci.yml/badge.svg)](https://github.com/maikolsiragusaa/metrora/actions/workflows/ci.yml)
[![Microsoft Store](https://img.shields.io/badge/Microsoft%20Store-Download-0078D4?logo=microsoft&logoColor=white)](https://apps.microsoft.com/detail/9NXSZFQSBBDX)
[![Android](https://img.shields.io/badge/Android-0.1.0--alpha.3-3DDC84?logo=android&logoColor=white)](https://github.com/maikolsiragusaa/metrora/releases/tag/android-v0.1.0-alpha.3)
[![Fluxer Community](https://img.shields.io/badge/Fluxer-Community-4641D9?logo=fluxer&logoColor=white)](https://metrora.eu/community)
[![License: MIT](https://img.shields.io/badge/License-MIT-0F1115.svg)](LICENSE)

</div>

> [!IMPORTANT]
> Metrora for Windows is available on the **Microsoft Store**, published by Vensent. The current Store update is the accepted **RC11** Windows line and includes the companion runtime used for local Android pairing. The **Android companion is publicly available now as the production-signed `0.1.0-alpha.3` GitHub pre-release**, with a Google Play release planned within 30 days. Repository builds and historical GitHub Windows pre-releases remain separate development or archival artifacts.

## Observe. Compare. Build. Control.

Metrora brings fragmented AI-development evidence together without requiring a new traffic path or a mandatory cloud account. The current product is organized around four shipped jobs:

| Stage | What Metrora provides today |
| --- | --- |
| **Observe** | Usage, Cost, Models, Projects and Activity from supported local tool evidence, with measured, derived, estimated and unavailable states kept distinct. |
| **Compare** | Side-by-side model and provider views using observed economics, plus controlled local Bench evidence without inventing a universal quality ranking. |
| **Build** | **OpenCode** is the coding engine for real sessions, provider/model selection, reasoning variants, tools, plans, subagents, permissions, workspace edits, git and MCP. Metrora adds one read-only usage snapshot tool and the Desktop lifecycle boundary. |
| **Control** | Provider-reported Capacity/quota, budgets, Project scope, local settings and explicit reversible controls where Metrora has deterministic authority. No autonomous routing or orchestration is implied. |

Metrora is multi-tool and multi-provider by design. A supported collector can contribute useful local evidence without forcing the underlying AI request through Metrora.

## Local-first by design

- **No mandatory account for local use.** Install Metrora, read supported local evidence and use the core product without creating a Metrora account.
- **No mandatory proxy or gateway.** Your AI traffic does not need to pass through Metrora for Metrora to observe supported usage evidence.
- **Local evidence stays authoritative.** Canonical measurements, pricing provenance and evidence states are owned by Metrora's local factual surfaces; the conversational model does not silently rewrite them.
- **Unknown is not zero.** Missing, stale, partial or unavailable provider evidence remains explicit instead of being converted into a reassuring number.
- **Companions consume bounded projections.** Android pairs locally with Desktop and does not become a second collector, pricing engine or accounting authority.

## OpenCode coding engine

The Desktop coding surface is **OpenCode**, bundled at the pinned upstream
release `1.18.27`. OpenCode owns the agent loop, sessions, transcript,
providers/models, reasoning, tools, filesystem and shell behavior, git,
permissions, plans/build flow, subagents, retries, cancellation, MCP and LSP.

Metrora owns only the Electron loopback lifecycle, per-launch authentication,
typed renderer boundary, workspace selection, crash/restart handling and one
read-only `metrora_usage_snapshot` tool backed by the canonical Metrora status
snapshot. It does not fork OpenCode or run a second agent engine.

See [OpenCode Engine Spike 001](docs/OPENCODE_ENGINE_SPIKE_001.md) for the
version pin, packaging, privacy boundary and validation contract.

## Bench: Performance first, evidence families kept separate

Metrora Bench is converging around the practical local question:

> **How does this declared model/runtime/configuration run on this hardware?**

Different Bench questions remain separate evidence families:

- **Performance** — the primary product direction: throughput, latency, TTFT, memory and runtime/hardware configuration where reliably measurable;
- **Compatibility / Runtime Health** — the current `core-v1` deterministic checks;
- **Coding Evaluation** — future, under a separately versioned methodology and sandbox/licence review;
- **Agent Evaluation** — future, separately from the OpenCode coding engine and only once a versioned methodology exists.

Current shipped Bench evidence includes a small Ollama runtime-timing slice, Core Compatibility and the first native llama.cpp `llama-bench` Performance adapter behind a Metrora-owned bounded runner. No current result is presented as a universal model-quality or coding ranking.

See [Bench evidence families](docs/BENCH_EVIDENCE_FAMILIES.md), [BenchRunV1 local Ollama](docs/BENCHRUN_V1_OLLAMA_LOCAL.md) and [Bench Core Compatibility v1](docs/BENCH_TASK_PACK_V1.md).

## Install Metrora

### Windows

Get Metrora from the [Microsoft Store](https://apps.microsoft.com/detail/9NXSZFQSBBDX).

The Store package installs the bundled Metrora desktop and CLI runtime without requiring a separate Node.js installation. Source builds remain available for development, inspection and contribution; see [Getting started](docs/GETTING_STARTED.md).

### Android companion

The current public Android alpha is [`0.1.0-alpha.3`](https://github.com/maikolsiragusaa/metrora/releases/tag/android-v0.1.0-alpha.3), distributed as a production-signed direct APK from GitHub Releases:

- [Download `Metrora-Android-0.1.0-alpha.3.apk`](https://github.com/maikolsiragusaa/metrora/releases/download/android-v0.1.0-alpha.3/Metrora-Android-0.1.0-alpha.3.apk)
- verify the public manifest and `SHA256SUMS` attached to the release;
- for Obtainium, add `https://github.com/maikolsiragusaa/metrora` and track the `android-v*` releases.

`0.1.0-alpha.1` remains an immutable historical release and `0.1.0-alpha.2` was never published. The direct GitHub APK remains available now; Google Play publication is planned within 30 days and remains a separate release channel until it is actually live. The companion pairs locally with the current Microsoft Store Desktop and does not become a second collection or accounting authority. F-Droid remains separately gated.

## What Metrora helps you answer

AI-assisted development is usually split across editors, desktop applications, CLIs, subscriptions, gateways and models. Each tool exposes a different fragment of the picture. Metrora reads supported evidence already available on your machine and lets you investigate questions such as:

- Which tools, models and projects are driving usage and cost?
- What provider Capacity or quota remains, when the provider exposes trustworthy evidence?
- How do models or providers compare on observed economics in the selected scope?
- What does a controlled local Bench run actually measure, and what remains unknown?
- Why did a scoped period, model, Project or provider change, according to the canonical Metrora evidence?
- Which explicit local controls or reversible optimizations are supported by deterministic Metrora authority?

Metrora does not require a wrapper around your AI requests, and it does not claim general model quality or autonomous control from incomplete evidence.

## Try Metrora from source

Use Node.js 22.15 or newer for repository development and validation.

```bash
git clone https://github.com/maikolsiragusaa/metrora.git
cd metrora
npm ci
npm run build:cli
npm run dev -- --help
```

Open the terminal dashboard:

```bash
npm run dev
```

Generate a copy-pasteable overview:

```bash
npm run dev -- overview
npm run dev -- overview --provider codex
npm run dev -- overview --from 2026-08-01 --to 2026-08-05
```

Open the local browser dashboard:

```bash
npm run dev -- web
```

Build and validate the desktop application:

```bash
npm --prefix app ci
npm --prefix app test
npm --prefix app run typecheck
npm --prefix app run build
```

The root npm package is intentionally private and is not an official distribution channel. See the complete [getting-started guide](docs/GETTING_STARTED.md).

## Main commands

| Command | Purpose |
| --- | --- |
| `metrora` | Interactive usage dashboard. |
| `metrora overview` | Plain-text usage summary for a period or exact date range. |
| `metrora web` | Local browser dashboard. |
| `metrora status` | Compact today-and-month status output. |
| `metrora sessions` | Per-session usage report. |
| `metrora models` | Per-model cost, token and task breakdown. |
| `metrora compare` | Side-by-side model comparison. |
| `metrora optimize` | Waste analysis and optional reversible fixes. |
| `metrora budget` | Configure and check spend limits. |
| `metrora plan` | Track subscription-plan usage and projected overage. |
| `metrora audit` | Compare provider evidence with displayed token and cost totals. |
| `metrora doctor` | Diagnose provider discovery and parsing health. |
| `metrora export` | Export usage as CSV or JSON. |
| `metrora bench local --model <model>` | Run bounded synthetic local runtime-timing evidence against an Ollama model; no quality or ranking score. |
| `metrora bench task-pack --model <model>` | Run deterministic Core Compatibility checks against a local Ollama model; private history and factual comparison only. |
| `metrora bench performance --executable <path> --model <path>` | Run bounded native llama.cpp `llama-bench` Performance evidence against existing executable/model files; no quality or universal score. |

Most analytical commands support provider, project and date filters. The [CLI reference](docs/CLI_REFERENCE.md) groups the public commands by task and explains compatibility boundaries.

## Supported tools

Metrora currently registers **39 local collectors**, including Claude, Codex, Gemini, Cursor, GitHub Copilot, OpenCode, Antigravity, Zed, Kiro, Cline, Cline CLI, Roo Code, KiloCode, Qwen, Kimi, Warp and other supported clients and gateways.

Support is reported with three separate facts:

1. whether Metrora can discover and analyze the source locally;
2. what kind of evidence the source exposes, including measured, derived or estimated values;
3. whether a concrete source path is approved for signed Workspace measurements.

This prevents “supported” from implying stronger evidence than a provider actually exposes. See the [user-facing support matrix](docs/SUPPORTED_TOOLS.md) and the generated [collector inventory](docs/COLLECTOR_INVENTORY_V1.md).

## Evidence and pricing

Metrora distinguishes values that are:

- **observed** directly from a source;
- **derived** deterministically from observed values;
- **estimated** using documented assumptions;
- **metered** by a provider or client;
- **explicitly zero** rather than unavailable;
- **unknown or unavailable** when trustworthy attribution does not exist.

Missing evidence is not silently converted to zero.

Historical API-equivalent pricing is date-effective and non-retroactive by default. A later catalog refresh cannot silently rewrite settled historical costs. Provider- or client-metered values remain authoritative, subscription coverage stays separate from API-equivalent valuation, and explicit zero remains different from unavailable pricing. See [Pricing history](docs/PRICING_HISTORY.md).

## Product surfaces

| Surface | Role | Current status |
| --- | --- | --- |
| Desktop | Primary local control center for observation, comparison, OpenCode coding, Capacity and configuration | **Available on Microsoft Store for Windows; RC11 current Store line** |
| CLI | Automation, inspection, export and keyboard-first analysis | Bundled with the Windows Store app; also available from source for development |
| Local web dashboard | Browser view served from the local machine | Available locally |
| Android companion | Read-focused local-network companion for a paired Desktop | **Public GitHub pre-release `0.1.0-alpha.3`; Google Play release planned within 30 days** |
| macOS menubar | Compact local usage view | Development source retained; not an official Metrora distribution |
| GNOME extension | Compact Linux panel view | Development source retained; not an official Metrora distribution |

Windows is the first supported public desktop distribution. Source support for other desktop platforms does not imply that an accepted public package exists for those platforms.

The Android companion is publicly distributed through the [`android-v0.1.0-alpha.3`](https://github.com/maikolsiragusaa/metrora/releases/tag/android-v0.1.0-alpha.3) GitHub pre-release. It pairs with Metrora Desktop on the same LAN, can show a fresh Desktop-generated usage overview or an encrypted offline snapshot, and consumes bounded Project-aware Home, Activity Sessions/Pull Requests, Analyze/Models, Analyze/Spend and capability-driven Workspace projections. Activity uses additive cursor-paged metadata contracts and does not expose prompt/response content. QR pairing, image import, SAS/Desktop approval and mutual-TLS device trust remain the local security boundary. The Android app does not duplicate collection, parsing, pricing, history or evidence authority. The current Microsoft Store RC11 line includes the companion runtime required by this pairing path. Google Play publication is planned within 30 days; until that channel is actually live, GitHub remains the current public Android distribution authority.

## Privacy model

Metrora is local-first by default:

- no account is required for ordinary local use;
- AI traffic does not pass through Metrora;
- prompts, responses, source code, patches, secrets and unrestricted local paths are outside the default sharing boundary;
- analytical claims keep observed, derived, estimated and unavailable evidence distinguishable;
- optional device or Workspace connections require explicit scope and revocable authorization;
- user-owned data remains exportable through documented formats.

Read the [product principles](docs/PRODUCT_PRINCIPLES.md), [public contracts v1](docs/PUBLIC_CONTRACTS_V1.md), [Workspace v1 boundary](docs/WORKSPACE_V1.md) and [security policy](SECURITY.md).

## Origin and independent development

Metrora is independently maintained under its own product identity. Required
third-party notices and licence texts remain in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) and [`LICENSES/`](LICENSES/).

## Documentation

Start from the [documentation index](docs/README.md):

- [Getting started](docs/GETTING_STARTED.md)
- [CLI reference](docs/CLI_REFERENCE.md)
- [OpenCode Engine Spike 001](docs/OPENCODE_ENGINE_SPIKE_001.md)
- [Historical optimization-operation contract 001](docs/ACT_CONTRACT_PREP_001.md)
- [Bench evidence families](docs/BENCH_EVIDENCE_FAMILIES.md)
- [Local runtime and Performance Wave 001](docs/LOCAL_RUNTIME_PERFORMANCE_WAVE_001.md)
- [BenchRunV1 local Ollama](docs/BENCHRUN_V1_OLLAMA_LOCAL.md)
- [Bench Core Compatibility v1](docs/BENCH_TASK_PACK_V1.md)
- [Supported tools](docs/SUPPORTED_TOOLS.md)
- [Product principles](docs/PRODUCT_PRINCIPLES.md)
- [Pricing history](docs/PRICING_HISTORY.md)
- [Workspace v1](docs/WORKSPACE_V1.md)
- [Public contracts v1](docs/PUBLIC_CONTRACTS_V1.md)
- [Android companion foundation](docs/ANDROID_COMPANION_FOUNDATION.md)
- [Android public distribution v1](docs/ANDROID_PUBLIC_DISTRIBUTION_V1.md)
- [Local companion API v1](docs/LOCAL_COMPANION_API.md)
- [Windows distribution boundary](docs/WINDOWS_DISTRIBUTION.md)
- [Community and commercial boundary](docs/COMMERCIAL_BOUNDARY.md)

## Repository map

```text
src/       collection, parsing, canonical records, CLI, analytics and sharing
app/       Electron desktop application
dash/      local React web dashboard
android/   production-signed Android companion and public direct-APK source
mac/       macOS menubar application
gnome/     GNOME extension
tests/     core test suite
docs/      product, user, contract and technical documentation
```

The current package publishes only the `metrora` command. Historical signed
evidence identifiers remain internal protocol details and are not product
facing names for new releases.

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request. Provider and parser changes require fixtures, focused tests, provenance, privacy review and real-session validation where possible.

Security issues must be reported privately according to [SECURITY.md](SECURITY.md).

## Community

<img src="./assets/brand/third-party/fluxer-symbol-color.svg" alt="Fluxer" width="48" />

The public Metrora community is open on **Fluxer** for product discussion, questions, feedback and contributor conversation. Join through [metrora.eu/community](https://metrora.eu/community), the stable Metrora community entry point.

Technical issues and pull requests stay on GitHub. Security reports must continue to follow the private process in [SECURITY.md](SECURITY.md).

## Product identity and licence

Metrora™ is the product and user-facing brand. Signal Grid™ is its canonical visual identity. Vensent™ is the publisher identity used for official Metrora distribution.

Metrora is independently maintained and distributed under the MIT License. Product and repository surfaces use the assets and Graphite + Signal Cyan palette documented in [`assets/brand`](assets/brand/README.md).

See the [project notices](NOTICE.md), [brand policy](BRAND_POLICY.md) and [licence](LICENSE).

Metrora™ — published by Vensent™. Copyright © 2026 Metrora contributors.
