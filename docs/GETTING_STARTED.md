# Getting started

Metrora for Windows is available on the **Microsoft Store**, published by Vensent. The Store package is the supported public Windows distribution. You can also build Metrora from source for development, inspection and contribution.

[Get Metrora from Microsoft Store](https://apps.microsoft.com/detail/9NXSZFQSBBDX)

Repository source may be newer than the currently published Store package. Source builds must therefore be identified by their exact commit/version and must not be treated as Store-signed packages.

## Requirements

For repository development and source evaluation use:

- Git;
- Node.js 22.15 or newer;
- npm;
- at least one supported AI tool with local usage records.

The package metadata retains a lower CLI engine floor for compatibility, but repository builds and CI use the stricter development runtime. Contributors and evaluators should use Node.js 22.15 or newer.

## Build the CLI

```bash
git clone https://github.com/maikolsiragusaa/metrora.git
cd metrora
npm ci
npm run build:cli
```

Show the canonical command surface through the development runner:

```bash
npm run dev -- --help
```

The root npm package is intentionally private. Do not treat npm publication or an inherited package name as an official Metrora distribution channel.

## Run the first report

Open the interactive terminal dashboard:

```bash
npm run dev
```

Generate a plain-text overview for the current month:

```bash
npm run dev -- overview
```

Filter to one provider:

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

The web dashboard is served from the local machine. It is not a hosted account service.

## Confirm what Metrora found

Run provider diagnostics when a tool is missing or the totals appear incomplete:

```bash
npm run dev -- doctor
npm run dev -- doctor --provider codex
```

Use the token audit for a closer comparison between source evidence and displayed totals:

```bash
npm run dev -- audit --provider codex
```

A provider may expose measured token counts, cumulative counters, derived deltas or only enough content for an estimate. Metrora keeps those evidence classes distinguishable rather than treating every source as equally precise.

See [Supported tools](SUPPORTED_TOOLS.md) and the relevant file under [`docs/providers`](providers/).

## Explore common workflows

### Review sessions

```bash
npm run dev -- sessions
npm run dev -- sessions --provider claude
npm run dev -- sessions --format json
```

### Compare models

```bash
npm run dev -- compare
npm run dev -- compare --provider codex
```

### Find optimization opportunities

```bash
npm run dev -- optimize
npm run dev -- optimize --provider claude
npm run dev -- optimize --format json
```

Configuration-changing optimization actions are opt-in, backed up and journaled. Review a dry run before applying changes:

```bash
npm run dev -- optimize --apply --dry-run
```

### Configure budgets

```bash
npm run dev -- budget --monthly 100
npm run dev -- budget --check
npm run dev -- budget --list
```

### Export data

```bash
npm run dev -- export --format json
npm run dev -- export --format csv --from 2026-08-01 --to 2026-08-05
```

Exports should be reviewed before sharing. Prompts, responses, source code, patches and secrets are outside the default analytical export boundary, but project and environment metadata may still be sensitive in a particular context.

## Build the desktop application

```bash
npm --prefix app ci
npm --prefix app test
npm --prefix app run typecheck
npm --prefix app run build
```

Development builds are not official Store-signed releases. Windows is the first supported public desktop distribution, and the Microsoft Store package is the recommended Windows install path. Repository packaging commands remain development and verification tools rather than alternate public distribution channels.

See [Windows distribution](WINDOWS_DISTRIBUTION.md), [Versioning authority](VERSIONING.md) and [`RELEASING.md`](../RELEASING.md).

## Local files and compatibility

The current package publishes only the `metrora` command. Fresh installations
use canonical Metrora config and cache roots and do not infer retired
pre-release roots, aliases or pointers. Existing canonical analytics and
history are preserved; historical Workspace and signed-evidence identifiers
remain a separate technical boundary documented in
[`TECHNICAL_IDENTITY_COMPATIBILITY.md`](TECHNICAL_IDENTITY_COMPATIBILITY.md).

## Troubleshooting

1. Confirm Node.js and npm versions.
2. Run `npm ci` again from a clean checkout.
3. Run `npm run dev -- doctor`.
4. Open the provider document for the affected tool.
5. Verify the tool has actually written local session or usage data.
6. Use synthetic or sanitized evidence when opening a public issue.

Security vulnerabilities must be reported privately according to [`SECURITY.md`](../SECURITY.md).