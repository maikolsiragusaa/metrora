# Getting started

Metrora does not yet have an official stable desktop distribution. You can evaluate it from source, or use the published **unsigned Windows x64 technical preview `v1.0.0-rc.7`** from GitHub Releases. RC7 is not signed, Microsoft Store certified, automatically updated or the stable `1.0.0` release.

The repository's active source/pre-submission line may be newer than the latest published technical preview. Source builds must therefore be identified by their exact commit/version rather than treated as RC7 release assets.

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

Development builds are not official signed releases. Windows is the first official desktop distribution target. Metrora has an assigned Microsoft Store identity and a non-publishing AppX pre-submission path, but no Store certification/publication is claimed until Microsoft accepts a submission.

See [Windows distribution](WINDOWS_DISTRIBUTION.md), [Versioning authority](VERSIONING.md) and [`RELEASING.md`](../RELEASING.md).

## Local files and compatibility

The canonical command is `metrora`. Temporary inherited command aliases may
continue to invoke the same implementation so existing local state, scripts
and integrations can migrate without abrupt breakage. They are compatibility
entry points only, not current product names.

Fresh configuration paths use Metrora identity. Existing legacy roots remain
readable where required to avoid stranding user state. Some frozen v1 protocol
fields, environment aliases and platform-specific integration identifiers also
retain historical values; they are compatibility details, not current product
names or distribution channels.

Do not rename or delete compatibility state manually unless the relevant migration documentation explicitly instructs you to do so.

## Troubleshooting

1. Confirm Node.js and npm versions.
2. Run `npm ci` again from a clean checkout.
3. Run `npm run dev -- doctor`.
4. Open the provider document for the affected tool.
5. Verify the tool has actually written local session or usage data.
6. Use synthetic or sanitized evidence when opening a public issue.

Security vulnerabilities must be reported privately according to [`SECURITY.md`](../SECURITY.md).
