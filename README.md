<div align="center">

<img src="./assets/brand/metrora-lockup.svg" alt="Metrora" width="520" />

**Website:** [metrora.eu](https://metrora.eu)

### Local-first intelligence for AI-assisted development

Understand where AI time, tokens, and money go — across tools, models, projects, and sessions — without routing your work through another service.

[![Metrora CI](https://github.com/maikolsiragusaa/metrora/actions/workflows/ci.yml/badge.svg)](https://github.com/maikolsiragusaa/metrora/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-2563EB.svg)](LICENSE)

</div>

> [!IMPORTANT]
> Metrora is under active development. The source and unsigned engineering candidates are usable for development and validation, but there are no official signed Metrora releases yet.

## Why Metrora

AI-assisted work is split across editors, desktop apps, CLIs, providers, subscriptions, and models. Each tool exposes a different fragment of the picture.

Metrora builds one evidence-based view from the usage records already stored on your machine. It helps answer practical questions:

- Which tools and models are driving cost?
- Which models work best for different kinds of tasks?
- How much value comes from cache, subscriptions, and local models?
- Which sessions were efficient, abandoned, reverted, or unusually expensive?
- Where can usage be improved without exposing prompts or source code?

## What works today

- **Multi-tool collection** from supported AI coding clients and local session stores.
- **Desktop application** for Windows, macOS, and Linux development builds.
- **CLI and terminal dashboard** for scripts, exports, and keyboard-first workflows.
- **Session intelligence** across projects, tasks, tools, models, cost, tokens, cache, and timing.
- **Model comparison** across performance, efficiency, working style, task categories, and observed context.
- **Reasoning attribution** when a source exposes a trustworthy effort level, with unknown coverage kept explicit.
- **Historical API-equivalent pricing** with immutable per-call cost assignments, date-effective reviewed rates, explicit free-route handling, metered-cost precedence, and conservative legacy fallback.
- **Optimization findings** for waste, reverts, abandoned work, and actionable savings opportunities.
- **Budgets, plans, pricing overrides, token audit, and CSV/JSON export.**
- **Private device linking** and combined local usage across machines.
- **Local personal Workspace** with protected endpoint identity, explicit reviewed production, pause/resume, deterministic non-destructive recovery, signed batches, and independently verifiable evidence export.
- **Public v1 contracts** for workspaces, endpoints, sharing, normalized measurements, and evidence.

Historical pricing is the default runtime behavior. A later catalog refresh cannot silently rewrite already settled historical costs. Provider- or client-metered values remain authoritative, explicit zero remains different from unavailable pricing, and subscription coverage stays separate from API-equivalent valuation. See [Pricing history](docs/PRICING_HISTORY.md).

## Current product milestone

[Workspace v1](docs/WORKSPACE_V1.md) is implemented and physically accepted on Windows. The active product milestone is a trustworthy Windows distribution: consistent publisher identity, independently verifiable artifacts, protected release authority, authenticated update metadata, rollback, and an official publication boundary.

This milestone does not authorize hosted synchronization, accounts, billing, team administration, enterprise deployment, Advisor, Bench, or prompt/code collection.

A future networked or customer-operated mode must remain optional and reuse the same public measurement, historical-pricing, provenance and evidence authority. No managed service or private deployment is currently available.

## Surfaces

| Surface | Role | Status |
| --- | --- | --- |
| Desktop | Primary local analysis and configuration | Active development; Windows first release target |
| CLI | First-class automation, inspection, and export | Active development |
| Local web dashboard | Browser view served from the local machine | Available |
| Android companion | Read-only local-network companion foundation | Experimental |

Other platforms remain part of the source tree, but official distribution follows only after their release and signing boundaries are proven.

## Privacy model

Metrora is local-first by default:

- no account is required for local use;
- AI traffic does not pass through Metrora;
- prompts, responses, source code, patches, secrets, and full local paths are not exported by default;
- analytical claims distinguish observed, derived, estimated, metered, explicit-zero, legacy-frozen, and unavailable evidence where relevant;
- networked sharing requires explicit scope, revocation, and structured usage data;
- user-owned data remains exportable through open formats;
- service availability or subscription state must not remove access to local user-owned history.

Read the [product principles](docs/PRODUCT_PRINCIPLES.md), [public contracts v1](docs/PUBLIC_CONTRACTS_V1.md), [Workspace v1 boundary](docs/WORKSPACE_V1.md), and [security policy](SECURITY.md).

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
src/       collection, parsing, canonical records, CLI, analytics, and sharing
app/       Electron desktop application
dash/      local React web dashboard
android/   experimental Android companion
mac/       macOS menubar application
gnome/     GNOME extension
tests/     core test suite
docs/      public contracts, principles, and technical documentation
```

The canonical command is `metrora`. The former `qovrion` command and inherited `codeburn` command remain temporary compatibility aliases while local state and integrations migrate safely.

## Product identity

Metrora is the product and user-facing brand. Vensent is the publisher name used for official Metrora distribution where a publisher identity is useful or required.

The canonical visual identity is **Signal Grid**: six measured bars forming an abstract `M`. Product and repository surfaces use the assets and palette documented in [`assets/brand`](assets/brand/README.md). Compatibility names inherited from upstream may remain internally where changing them would break existing state or integrations, but they are not the product-facing brand.

See the [project notices](NOTICE.md) and [brand policy](BRAND_POLICY.md).

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request. Provider and parser changes require fixtures, targeted tests, provenance, privacy review, and real-session validation where possible.

Security issues must be reported privately according to [SECURITY.md](SECURITY.md).

## License and provenance

Metrora is open source under the MIT License and contains substantial software originally derived from CodeBurn 0.9.19.

Original copyright, license, and provenance are preserved in [LICENSE](LICENSE), [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md), and [UPSTREAM.md](UPSTREAM.md). Metrora-originated contributions are identified in [NOTICE.md](NOTICE.md). Metrora is an independent project and does not present upstream CodeBurn packages or releases as Metrora artifacts.
