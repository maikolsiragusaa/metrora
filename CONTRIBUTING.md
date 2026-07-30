# Contributing to Qovrion

Thanks for helping improve Qovrion.

Qovrion is early in its independent development and still contains CodeBurn-era runtime names. Keep changes focused, evidence-based, and compatible with existing local data.

## Prerequisites

- Node.js 22.13 or newer
- npm
- Optional: Swift toolchain for `mac/`
- Optional: GNOME 45 or newer for `gnome/`
- A supported AI tool with real local session data when validating a collector

## Setup

```bash
git clone https://github.com/maikolsiragusaa/qovrion.git
cd qovrion
npm ci
npm run build:cli
```

## Repository layout

```text
src/       TypeScript engine, CLI, collectors, caches, and analytics
app/       Electron desktop application
dash/      Local React web dashboard
mac/       macOS menubar application
gnome/     GNOME extension
tests/     Test suite
docs/      Upstream and public implementation documentation
```

## Common commands

```bash
npm run build:cli
npm test -- --run
npm test -- tests/<target>.test.ts
npm --prefix app ci --no-audit --no-fund
npm --prefix app run typecheck
npm --prefix app run build
```

The imported CodeBurn 0.9.19 suite includes platform-sensitive failures on Ubuntu. New or changed behavior still requires targeted blocking tests and must not add regressions.

## Contribution principles

- Keep each pull request bounded to one primary concern.
- Separate rebranding, structural changes, parser changes, and feature changes.
- Preserve raw values, provenance, confidence, and unknown states.
- Do not infer model, provider, billing route, or reasoning configuration without evidence.
- Do not collect or export prompts, code, secrets, or full local paths by default.
- Treat Windows as a first-class target.
- Preserve compatibility or provide migration for persisted local data.
- Retain attribution for upstream-derived code and fixes.
- Never claim real-data, real-device, or store validation without performing it.

## Provider and collector changes

Collectors silently affect totals and therefore have a high evidence bar. A provider change should include:

1. fixtures representing the observed format;
2. targeted parser tests;
3. cache/parser version review;
4. validation against real sessions generated with the tool;
5. comparison with authoritative counters or source records when available;
6. explicit handling of ambiguous and estimated values;
7. privacy review for new captured fields.

Online documentation or AI-generated assumptions are not sufficient evidence for storage paths, schemas, token semantics, or pricing.

## Pull requests

Use the pull-request template and report only validation actually performed. Include screenshots for visible changes, migration impact where applicable, known risks, and rollback information.

Squash merge is preferred for bounded feature branches unless preserving a structured series is materially useful.

## Security issues

Do not file vulnerabilities in the public tracker. Follow [`SECURITY.md`](SECURITY.md).

## License

Qovrion is distributed under the MIT License and contains software initially derived from CodeBurn 0.9.19. Contributions are licensed under the repository's MIT terms. See [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md) and [`UPSTREAM.md`](UPSTREAM.md).