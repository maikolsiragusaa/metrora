# Qovrion

**Local-first AI usage intelligence.**

Qovrion is an independent open-source project for understanding AI coding usage and cost across tools, models, projects, tasks, and sessions.

The project was bootstrapped from the CodeBurn 0.9.19 source tree under the MIT License. Original copyright and provenance are preserved in [`LICENSE`](LICENSE), [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md), and [`UPSTREAM.md`](UPSTREAM.md).

## Current status

Qovrion is in an early controlled-rebranding and stabilization phase.

The current source baseline already includes:

- a TypeScript CLI and terminal dashboard;
- local usage and cost collection for many AI coding tools;
- a local React web dashboard;
- an Electron desktop application for Windows, macOS, and Linux;
- breakdowns by tool, model, task, project, activity, and session;
- model comparison, token audit, optimization findings, and budget guards;
- local device pairing and sharing capabilities.

Some runtime commands, package identifiers, application IDs, assets, paths, and documentation still use CodeBurn-era naming. There are **no official Qovrion binaries, npm packages, store listings, hosted services, or mobile releases yet**. Upstream CodeBurn downloads must not be presented as Qovrion releases.

## Privacy

The inherited product is local-first and reads session artifacts already stored on the user's device. Contributions must preserve privacy-safe defaults:

- do not collect or export prompts, source code, secrets, or full local paths by default;
- distinguish exact, observed, estimated, and unknown values;
- retain provenance for analytical claims;
- do not require AI traffic to pass through Qovrion;
- keep device pairing revocable and scoped.

## Development

Requirements:

- Node.js 22.13 or newer
- npm

```bash
npm ci
npm run build:cli
npm test -- --run
```

Main inherited directories:

```text
src/       TypeScript engine, CLI, collectors, caches, and analytics
app/       Electron desktop application
dash/      Local React web dashboard
mac/       macOS menubar application
gnome/     GNOME extension
tests/     Test suite
```

The canonical runtime command is `qovrion`; `codeburn` remains a temporary compatibility alias. There are still no official Qovrion packages or binaries, so do not publish or distribute artifacts without an explicit release change.

## Contributing

Read [`CONTRIBUTING.md`](CONTRIBUTING.md) before opening a pull request. Provider and parser changes require fixtures, targeted tests, provenance, privacy review, and real-session validation where applicable.

Security issues must be reported privately according to [`SECURITY.md`](SECURITY.md).

## License and provenance

Qovrion contains substantial software initially derived from CodeBurn 0.9.19.

- Upstream project: CodeBurn by AgentSeal
- Imported baseline: `146037bfd533edff85cd39f322571b2c5434fcca`
- Qovrion bootstrap commit: `b669bac85e3caa6d7547c08428799473fa255c8d`
- License: MIT

See [`LICENSE`](LICENSE), [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md), and [`UPSTREAM.md`](UPSTREAM.md).