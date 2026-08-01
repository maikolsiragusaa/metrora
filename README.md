<div align="center">

# Metrora

**Website:** [metrora.eu](https://metrora.eu)

### Local-first intelligence for AI-assisted development

Understand where AI time, tokens, and money go — across tools, models, projects, and sessions — without routing your work through another service.

[![Metrora CI](https://github.com/maikolsiragusaa/metrora/actions/workflows/ci.yml/badge.svg)](https://github.com/maikolsiragusaa/metrora/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

</div>

> [!IMPORTANT]
> Metrora is under active development. The source is usable for development and validation, but there are no official signed Metrora releases yet.

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
- **Public v1 contracts** for workspaces, endpoints, sharing, normalized measurements, and evidence.
- **Durable local endpoint identity, reviewed measurement outbox, and signed batch foundations** for future workspace synchronization.

Historical pricing is the default runtime behavior. A later catalog refresh cannot silently rewrite already settled historical costs. Provider- or client-metered values remain authoritative, explicit zero remains different from unavailable pricing, and subscription coverage stays separate from API-equivalent valuation. See [Pricing history](docs/PRICING_HISTORY.md).

## Current product milestone

The next vertical slice is [Workspace v1](docs/WORKSPACE_V1.md): a local-first personal workspace that binds the current computer, reviewed measurements, signed batches, and an understandable desktop workspace view without requiring an account or hosted service.

Workspace v1 does not introduce cloud synchronization, billing, team administration, or prompt/code collection. Those capabilities require separate contracts and explicit product work after the local slice is proven.

## Surfaces

| Surface | Role | Status |
| --- | --- | --- |
| Desktop | Primary local analysis and configuration | Active development |
| CLI | First-class automation, inspection, and export | Active development |
| Local web dashboard | Browser view served from the local machine | Available |
| Android companion | Read-only local-network companion foundation | Experimental |

Windows is the first release target. Other platforms remain part of the source tree, but signed distribution will follow only after the release pipeline is ready.

## Privacy model

Metrora is local-first by default:

- no account is required for local use;
- AI traffic does not pass through Metrora;
- prompts, responses, source code, patches, secrets, and full local paths are not exported by default;
- analytical claims distinguish observed, derived, estimated, metered, explicit-zero, legacy-frozen, and unavailable evidence where relevant;
- networked sharing is being built around explicit scope, revocation, and structured usage data;
- user-owned data remains exportable through open formats.

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

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request. Provider and parser changes require fixtures, targeted tests, provenance, privacy review, and real-session validation where possible.

Security issues must be reported privately according to [SECURITY.md](SECURITY.md).

## License and provenance

Metrora is open source under the MIT License and contains substantial software originally derived from CodeBurn 0.9.19.

Original copyright, license, and provenance are preserved in [LICENSE](LICENSE), [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md), and [UPSTREAM.md](UPSTREAM.md). Metrora is an independent project and does not present upstream CodeBurn packages or releases as Metrora artifacts.
