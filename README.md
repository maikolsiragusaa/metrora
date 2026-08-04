<div align="center">

<img src="./assets/brand/metrora-lockup.svg" alt="Metrora" width="520" />

**Website:** [metrora.eu](https://metrora.eu)

### Local-first intelligence for AI-assisted development

Understand where AI time, tokens and money go — across tools, models, projects and sessions — without routing your work through another service.

[![Metrora CI](https://github.com/maikolsiragusaa/metrora/actions/workflows/ci.yml/badge.svg)](https://github.com/maikolsiragusaa/metrora/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-2563EB.svg)](LICENSE)

</div>

> [!IMPORTANT]
> Official desktop distribution is in preparation. Build and evaluate Metrora from this canonical repository; published artifacts will be announced through [metrora.eu](https://metrora.eu) and [GitHub Releases](https://github.com/maikolsiragusaa/metrora/releases).

## Why Metrora

AI-assisted work is split across editors, desktop applications, CLIs, providers, subscriptions and models. Each tool exposes a different fragment of the picture.

Metrora builds one evidence-based view from usage records already stored on your machine. It helps answer practical questions:

- Which tools and models are driving cost?
- Which models work best for different kinds of tasks?
- How much value comes from cache, subscriptions and local models?
- Which sessions were efficient, abandoned, reverted or unusually expensive?
- Where can usage be improved without exposing prompts or source code?

## What works today

- **Multi-tool collection** from supported AI coding clients and local session stores.
- **Desktop application** for Windows, macOS and Linux development builds.
- **CLI and terminal dashboard** for scripts, exports and keyboard-first workflows.
- **Session intelligence** across projects, tasks, tools, models, cost, tokens, cache and timing.
- **Model comparison** across performance, efficiency, working style, task categories and observed context.
- **Reasoning attribution** when a source exposes a trustworthy effort level, with unknown coverage kept explicit.
- **Historical API-equivalent pricing** with immutable per-call cost assignments, date-effective reviewed rates, explicit free-route handling, metered-cost precedence and conservative legacy fallback.
- **Optimization findings** for waste, reverts, abandoned work and actionable savings opportunities.
- **Budgets, plans, pricing overrides, token audit and CSV/JSON export.**
- **Private device linking** and combined local usage across machines.
- **Local personal Workspace** with protected endpoint identity, explicit reviewed production, pause/resume, deterministic non-destructive recovery, signed batches and independently verifiable evidence export.
- **Public v1 contracts** for workspaces, endpoints, sharing, normalized measurements and evidence.

Historical pricing is the default runtime behavior. A later catalog refresh cannot silently rewrite settled historical costs. Provider- or client-metered values remain authoritative, explicit zero remains different from unavailable pricing, and subscription coverage stays separate from API-equivalent valuation. See [Pricing history](docs/PRICING_HISTORY.md).

## Release status

Windows is the first official desktop distribution target. Source support for other platforms remains available, while official packages follow platform-specific validation.

## Surfaces

| Surface | Role | Status |
| --- | --- | --- |
| Desktop | Primary local analysis and configuration | Windows distribution in preparation |
| CLI | First-class automation, inspection and export | Available from source |
| Local web dashboard | Browser view served from the local machine | Available |
| Android companion | Read-only local-network companion foundation | Experimental |

## Privacy model

Metrora is local-first by default:

- no account is required for local use;
- AI traffic does not pass through Metrora;
- prompts, responses, source code, patches, secrets and full local paths are not exported by default;
- analytical claims distinguish observed, derived, estimated, metered, explicit-zero, legacy-frozen and unavailable evidence where relevant;
- optional sharing requires explicit scope, revocation and structured usage data;
- user-owned data remains exportable through open formats.

Read the [product principles](docs/PRODUCT_PRINCIPLES.md), [public contracts v1](docs/PUBLIC_CONTRACTS_V1.md), [Workspace v1 boundary](docs/WORKSPACE_V1.md) and [security policy](SECURITY.md).

## Development

Requirements:

- Node.js 22.15 or newer
- npm

```bash
git clone https://github.com/maikolsiragusaa/metrora.git
cd metrora
npm ci
npm run build:cli
npm test -- --run
```

Run the CLI from source:

```bash
npm run dev -- --help
```

Build and validate the desktop application:

```bash
npm --prefix app ci
npm --prefix app test
npm --prefix app run typecheck
npm --prefix app run build
```

Repository map:

```text
src/       collection, parsing, canonical records, CLI, analytics and sharing
app/       Electron desktop application
dash/      local React web dashboard
android/   experimental Android companion
mac/       macOS menubar application
gnome/     GNOME extension
tests/     core test suite
docs/      public contracts, principles and technical documentation
```

The canonical command is `metrora`. The former `qovrion` command and inherited `codeburn` command remain temporary compatibility aliases while local state and integrations migrate safely.

## Product identity

Metrora™ is the product and user-facing brand. Signal Grid™ is its canonical visual identity. Vensent™ is the publisher identity used for official Metrora distribution.

Product and repository surfaces use the assets and palette documented in [`assets/brand`](assets/brand/README.md). Compatibility identifiers may remain internally where changing them would break existing state or integrations, but they are not the product-facing identity.

See the [project notices](NOTICE.md) and [brand policy](BRAND_POLICY.md).

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request. Provider and parser changes require fixtures, targeted tests, provenance, privacy review and real-session validation where possible.

Security issues must be reported privately according to [SECURITY.md](SECURITY.md).

## License and provenance

Metrora is independently maintained and distributed under the MIT License. It includes MIT-licensed portions originally derived from CodeBurn 0.9.19 and other third-party components.

Required notices and licence texts are preserved in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md), [UPSTREAM.md](UPSTREAM.md) and [`LICENSES/`](LICENSES/).

Metrora™ — published by Vensent™. Copyright © 2026 Metrora contributors.
