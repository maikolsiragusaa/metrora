<div align="center">

<img src="./assets/brand/metrora-lockup.svg" alt="Metrora" width="520" />

### Local-first intelligence for AI-assisted development

Understand where AI time, tokens and money go across tools, models, projects and sessions — without routing your work through another service.

[Website](https://metrora.eu) · [Getting started](docs/GETTING_STARTED.md) · [Supported tools](docs/SUPPORTED_TOOLS.md) · [Documentation](docs/README.md)

[![Metrora CI](https://github.com/maikolsiragusaa/metrora/actions/workflows/ci.yml/badge.svg)](https://github.com/maikolsiragusaa/metrora/actions/workflows/ci.yml)
[![Microsoft Store](https://img.shields.io/badge/Microsoft%20Store-Download-0078D4?logo=microsoft&logoColor=white)](https://apps.microsoft.com/detail/9NXSZFQSBBDX)
[![Android](https://img.shields.io/badge/Android-0.1.0--alpha.3-3DDC84?logo=android&logoColor=white)](https://github.com/maikolsiragusaa/metrora/releases/tag/android-v0.1.0-alpha.3)
[![Fluxer Community](https://img.shields.io/badge/Fluxer-Community-4641D9?logo=fluxer&logoColor=white)](https://metrora.eu/community)
[![License: MIT](https://img.shields.io/badge/License-MIT-0F1115.svg)](LICENSE)

</div>

> [!IMPORTANT]
> Metrora for Windows is available on the **Microsoft Store**, published by Vensent. The current Store update is the accepted **RC11** Windows line and includes the companion runtime used for local Android pairing. The **Android companion is publicly available now as the production-signed `0.1.0-alpha.3` GitHub pre-release**, with a Google Play release planned within 30 days. Repository builds and historical GitHub Windows pre-releases remain separate development or archival artifacts.

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

## What Metrora helps you understand

AI-assisted work is usually split across editors, desktop applications, CLIs, subscriptions, gateways and models. Each tool exposes a different fragment of the picture.

Metrora reads supported usage records already stored on your machine and builds one evidence-aware view that can answer questions such as:

- Which tools, models and projects are driving cost and token usage?
- How much usage is covered by cache, subscriptions or local models?
- Which sessions were efficient, retried, abandoned, reverted or unusually expensive?
- Which models work best for the kinds of tasks you actually perform?
- Which optimization findings are supported by observed data, and which values remain estimated or unknown?

No wrapper or proxy is required, and AI traffic does not pass through Metrora.

## What works today

| Capability | What it provides |
| --- | --- |
| **Collect** | Local collection from 39 registered AI-tool and gateway integrations, with provider-specific discovery and parsing. |
| **Understand** | Cost, tokens, cache, projects, sessions, tools, task categories, timing and model breakdowns. |
| **Compare** | Model efficiency and observed working-style comparisons, with missing evidence kept explicit. |
| **Optimize** | Waste findings, reversible configuration changes and realized-versus-estimated savings reporting. |
| **Control** | Budgets, subscription plans, local pricing overrides, model aliases and subscription-covered paths. |
| **Inspect** | Token audit, provider diagnostics, durable history and provenance-aware evidence states. |
| **Export** | CSV and JSON output suitable for inspection, automation and independent tooling. |
| **Connect locally** | Private device pairing and combined usage across machines on the same local network. |
| **Verify** | A local personal Workspace with protected endpoint identity, explicit reviewed production, signed batches and independently verifiable evidence export. |

Local collector support and eligibility for signed Workspace measurements are deliberately separate. A collector can be useful for local analysis before every field and source path has passed the stricter signed-sharing review. See [Supported tools](docs/SUPPORTED_TOOLS.md).

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
| `metrora bench local --model <model>` | Run bounded synthetic runtime evidence against a local Ollama model; no quality or ranking score. |
| `metrora bench task-pack --model <model>` | Run deterministic synthetic assertions against a local Ollama model; private history and factual comparison only. |

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
| Desktop | Primary local analysis and configuration | **Available on Microsoft Store for Windows; RC11 current Store line** |
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
- [BenchRunV1 local Ollama](docs/BENCHRUN_V1_OLLAMA_LOCAL.md)
- [Bench task pack v1](docs/BENCH_TASK_PACK_V1.md)
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
