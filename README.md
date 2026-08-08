<div align="center">

<img src="./assets/brand/metrora-lockup.svg" alt="Metrora" width="520" />

### Local-first intelligence for AI-assisted development

Understand where AI time, tokens and money go across tools, models, projects and sessions — without routing your work through another service.

[Website](https://metrora.eu) · [Windows preview](https://github.com/maikolsiragusaa/metrora/releases/tag/v1.0.0-rc.7) · [Getting started](docs/GETTING_STARTED.md) · [Supported tools](docs/SUPPORTED_TOOLS.md) · [Documentation](docs/README.md)

[![Metrora CI](https://github.com/maikolsiragusaa/metrora/actions/workflows/ci.yml/badge.svg)](https://github.com/maikolsiragusaa/metrora/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-E8590C.svg)](LICENSE)

</div>

> [!IMPORTANT]
> Metrora `1.0.0-rc.7` is available as an **unsigned Windows x64 technical preview**. It is not the stable `1.0.0` release, a signed package, a Microsoft Store package or an automatic update channel. Windows SmartScreen may show a warning. Verify `SHA256SUMS.txt` before running downloaded binaries.

## Download the Windows technical preview

Download the accepted installer or portable bundle from the [Metrora 1.0.0-rc.7 GitHub pre-release](https://github.com/maikolsiragusaa/metrora/releases/tag/v1.0.0-rc.7):

- `Metrora-Setup-1.0.0-rc.7.exe` — unsigned Windows installer;
- `Metrora-1.0.0-rc.7-Windows-x64-portable.zip` — portable Windows bundle;
- `SHA256SUMS.txt` — checksums for the published payload assets.

The published binaries were derived from one accepted candidate at commit `e158ee34e570161c778162be77629b3a4dbb74fe`, passed the documented automated and physical Windows acceptance, and remain subject to the limitations above. See the [version-scoped publication record](release/1.0.0-rc.7/GITHUB_PRE_RELEASE.md).

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
| Desktop | Primary local analysis and configuration | Unsigned Windows x64 technical preview available; stable and Microsoft Store distributions are not yet available |
| CLI | Automation, inspection, export and keyboard-first analysis | Available from source |
| Local web dashboard | Browser view served from the local machine | Available from source |
| Android companion | Read-only local-network companion foundation | Experimental |
| macOS menubar | Compact local usage view | Development source retained; not an official Metrora distribution |
| GNOME extension | Compact Linux panel view | Development source retained; not an official Metrora distribution |

Windows is the first official desktop distribution target. Source support for other platforms does not imply that an accepted signed package exists for those platforms.

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

Metrora is independently maintained from a reviewed upstream MIT-licensed source baseline and preserves the required copyright and licence notices.

The inherited baseline provided substantial local collection, reporting and interface foundations. Metrora independently maintains that code while introducing its own product identity, evidence model, durable-history rules, historical-pricing authority, Windows release discipline, local Workspace contracts and other material changes.

See [Product lineage](docs/PRODUCT_LINEAGE.md) for the functional boundary and [Upstream provenance](UPSTREAM.md) for the exact imported source authority. Required notices remain in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) and [`LICENSES/`](LICENSES/).

## Documentation

Start from the [documentation index](docs/README.md):

- [Getting started](docs/GETTING_STARTED.md)
- [CLI reference](docs/CLI_REFERENCE.md)
- [Supported tools](docs/SUPPORTED_TOOLS.md)
- [Product lineage](docs/PRODUCT_LINEAGE.md)
- [Product principles](docs/PRODUCT_PRINCIPLES.md)
- [Pricing history](docs/PRICING_HISTORY.md)
- [Workspace v1](docs/WORKSPACE_V1.md)
- [Public contracts v1](docs/PUBLIC_CONTRACTS_V1.md)
- [Windows distribution boundary](docs/WINDOWS_DISTRIBUTION.md)

## Repository map

```text
src/       collection, parsing, canonical records, CLI, analytics and sharing
app/       Electron desktop application
dash/      local React web dashboard
android/   experimental Android companion
mac/       macOS menubar application
gnome/     GNOME extension
tests/     core test suite
docs/      product, user, contract and technical documentation
```

The canonical command is `metrora`. Compatibility aliases are retained only at narrowly scoped runtime boundaries while local state and integrations migrate safely. They are not product-facing names for new releases.

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request. Provider and parser changes require fixtures, focused tests, provenance, privacy review and real-session validation where possible.

Security issues must be reported privately according to [SECURITY.md](SECURITY.md).

## Product identity and licence

Metrora™ is the product and user-facing brand. Signal Grid™ is its canonical visual identity. Vensent™ is the publisher identity used for official Metrora distribution.

Metrora is independently maintained and distributed under the MIT License. Product and repository surfaces use the assets and Graphite + Signal Orange palette documented in [`assets/brand`](assets/brand/README.md).

See the [project notices](NOTICE.md), [brand policy](BRAND_POLICY.md) and [licence](LICENSE).

Metrora™ — published by Vensent™. Copyright © 2026 Metrora contributors.
