# Getting started

Metrora is available through official Store channels and can also be built from source for development, inspection and contribution.

- **Windows:** [Microsoft Store](https://apps.microsoft.com/detail/9NXSZFQSBBDX)
- **Android:** [Google Play](https://play.google.com/store/apps/details?id=eu.metrora.app)
- **Source:** this repository

Ordinary local use does not require a Metrora account or a mandatory AI-request proxy.

## Install on Windows

The Microsoft Store package is the supported public Windows distribution, published by Vensent.

[Get Metrora from Microsoft Store](https://apps.microsoft.com/detail/9NXSZFQSBBDX)

The current live Store line is RC11 (`1.0.0-rc.11`, Desktop `1.0.0.11`, Store package `1.0.1.0`). The package contains the Desktop application and bundled Metrora CLI runtime; ordinary users do not need a separate Node.js installation.

Repository source may be newer than the currently published Store package. A source checkout or locally generated package must therefore be identified by its exact commit/version and must not be presented as Store-signed authority.

## Install the Android companion

Metrora for Android is live on Google Play under application ID `eu.metrora.app`.

[Get Metrora on Google Play](https://play.google.com/store/apps/details?id=eu.metrora.app)

Android is a companion to an explicitly paired Metrora Desktop. It consumes bounded Desktop-generated projections and does not independently become the collector, pricing engine, accounting authority or canonical history source.

The production-signed direct GitHub APK channel also remains available for users who intentionally choose direct installation or Obtainium. The current documented direct release is [`0.1.0-alpha.3`](https://github.com/maikolsiragusaa/metrora/releases/tag/android-v0.1.0-alpha.3); direct-channel release history and integrity details are documented separately rather than making this getting-started guide a release ledger.

See [Android public distribution](ANDROID_PUBLIC_DISTRIBUTION_V1.md), [Android companion foundation](ANDROID_COMPANION_FOUNDATION.md) and [Local companion API](LOCAL_COMPANION_API.md).

## First look at Metrora Desktop

The product is organized around four jobs:

```text
Observe  → Usage · Activity · Sessions · Projects
Compare  → Models · economics · Bench · coverage
Code     → upstream OpenCode hosted inside Metrora
Control  → Capacity · budgets · Project context · explicit local controls
```

The **Code** destination embeds the upstream OpenCode runtime/Web UI. OpenCode owns ordinary coding sessions, agents, tools, files, shell and Git mechanics; Metrora owns the surrounding host, facts, evidence and product context.

See [Architecture](architecture.md), [OpenCode upstream surface](OPENCODE_UPSTREAM_SURFACE_001.md) and [Ecosystem surfaces](ECOSYSTEM_SURFACES.md).

## Build from source

For repository development and source evaluation use:

- Git;
- Node.js 22.15 or newer;
- npm;
- at least one supported AI tool with local usage records for meaningful collector output.

Clone and build the CLI:

```bash
git clone https://github.com/maikolsiragusaa/metrora.git
cd metrora
npm ci
npm run build:cli
```

Show the canonical command surface:

```bash
npm run dev -- --help
```

The root npm package is intentionally private. npm publication or an inherited package identity is not an official Metrora distribution channel.

## Run the first report

Open the interactive terminal dashboard:

```bash
npm run dev
```

Generate an overview:

```bash
npm run dev -- overview
```

Filter to a provider:

```bash
npm run dev -- overview --provider codex
```

Use an exact date range:

```bash
npm run dev -- overview --from 2026-08-01 --to 2026-08-05
```

Open the local browser dashboard:

```bash
npm run dev -- web
```

The browser dashboard is served from the local machine. It is not a hosted Metrora account service.

## Confirm what Metrora found

If a tool is missing or totals look incomplete, inspect discovery and evidence before assuming zero:

```bash
npm run dev -- doctor
npm run dev -- doctor --provider codex
```

For a closer comparison between source evidence and displayed totals:

```bash
npm run dev -- audit --provider codex
```

A provider may expose measured token counts, cumulative counters, derived deltas or only enough content for an estimate. Metrora keeps these evidence classes distinguishable.

See [Supported tools](SUPPORTED_TOOLS.md) and [`docs/providers`](providers/).

## Common CLI workflows

### Sessions

```bash
npm run dev -- sessions
npm run dev -- sessions --provider claude
npm run dev -- sessions --format json
```

### Models and comparison

```bash
npm run dev -- models
npm run dev -- compare
npm run dev -- compare --provider codex
```

### Diagnostics and optimization

```bash
npm run dev -- doctor
npm run dev -- optimize
npm run dev -- optimize --provider claude
```

Configuration-changing optimization actions are explicit. Review a dry run before applying a supported change:

```bash
npm run dev -- optimize --apply --dry-run
```

### Budgets

```bash
npm run dev -- budget --monthly 100
npm run dev -- budget --check
npm run dev -- budget --list
```

### Export

```bash
npm run dev -- export --format json
npm run dev -- export --format csv --from 2026-08-01 --to 2026-08-05
```

Review exports before sharing. Ordinary analytical exports exclude prompt/response bodies, source code, patches and secrets, but Project/environment metadata can still be sensitive in context.

The complete command surface is in [CLI reference](CLI_REFERENCE.md).

## Build the Desktop application

```bash
npm --prefix app ci
npm --prefix app test
npm --prefix app run typecheck
npm --prefix app run build
```

Development builds are not official Store-signed releases. Repository packaging commands remain development/verification tools rather than alternate public Store authority.

The Desktop build also stages the pinned upstream OpenCode runtime used by the Code surface. Future OpenCode updates are reviewed/pinned deliberately rather than following an unverified `latest` binary.

See [Windows distribution](WINDOWS_DISTRIBUTION.md), [Versioning](VERSIONING.md) and [`RELEASING.md`](../RELEASING.md).

## Android development

For repository Android development use:

- Java 17;
- Gradle 9.6.1, or the project-supported equivalent;
- Android SDK Platform 36.

Canonical contributor checks include:

```bash
gradle -p android --no-daemon :app:testGithubDebugUnitTest :app:lint :app:assembleGithubDebug
```

To validate repository distribution variants:

```bash
gradle -p android --no-daemon :app:assembleGithubRelease :app:assembleFdroidRelease :app:bundlePlayRelease
```

Production, QA, direct, F-Droid and Play signing boundaries remain separate. No private signing material belongs in Git, public issues, pull requests or ordinary logs.

## Local files and compatibility

The current package publishes only the `metrora` command. Fresh installations use canonical Metrora config/cache roots and do not infer retired pre-release roots, aliases or pointers.

Historical Workspace/signed-evidence identifiers may remain where changing them would break installed state. They are compatibility details, not current product branding. See [Technical identity compatibility](TECHNICAL_IDENTITY_COMPATIBILITY.md).

## Troubleshooting

1. Confirm the relevant Store/source version first.
2. For source builds, confirm Node.js/npm versions and run `npm ci` from a clean checkout.
3. Run `npm run dev -- doctor`.
4. Open the provider document for the affected tool.
5. Confirm the provider/client actually wrote local evidence in the selected period.
6. Keep missing/unavailable evidence distinct from zero.
7. Use synthetic or sanitized evidence when opening a public issue.

Security vulnerabilities must be reported privately according to [`SECURITY.md`](../SECURITY.md).
