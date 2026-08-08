# Contributing to Metrora

Thanks for helping improve Metrora.

Keep changes focused, evidence-based and compatible with existing local data. Some inherited compatibility identifiers remain intentionally stable until a reviewed migration is available.

## Prerequisites

- Node.js 22.15 or newer
- npm
- Optional: Swift toolchain for `mac/`
- Optional: GNOME 45 or newer for `gnome/`
- A supported AI tool with real local session data when validating a collector

## Setup

```bash
git clone https://github.com/maikolsiragusaa/metrora.git
cd metrora
npm ci
npm run build:cli
```

## Repository layout

```text
src/       TypeScript engine, CLI, collectors, caches and analytics
app/       Electron desktop application
dash/      local React web dashboard
mac/       macOS menubar application
gnome/     GNOME extension
tests/     test suite
docs/      public contracts and technical documentation
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

## Contribution principles

- Keep each pull request bounded to one primary concern.
- Separate product copy, structural changes, parser changes and feature changes.
- Preserve raw values, provenance, confidence and unknown states.
- Do not infer model, provider, billing route or reasoning configuration without evidence.
- Do not collect or export prompts, code, secrets or full local paths by default.
- Treat Windows as a first-class target.
- Preserve compatibility or provide migration for persisted local data.
- Retain attribution for upstream-derived code and fixes.
- Never claim real-data, real-device or store validation without performing it.

## Public repository hygiene

Issues, pull requests, commits and documentation are public product surfaces. Include only information needed to understand, review, validate or maintain the public change.

Do not publish:

- personal usage records, device details or local identifiers;
- credentials, verification material or private administrative documents;
- names or locations of non-public repositories and internal systems;
- unpublished commercial plans, budgets or internal prioritization;
- unrelated future product initiatives;
- raw logs, paths or evidence that may identify a person or customer.

Describe unavailable or unrelated work generically when its exact internal identity is not required for review. Product, publisher and provenance language must follow [`README.md`](README.md), [`NOTICE.md`](NOTICE.md) and [`BRAND_POLICY.md`](BRAND_POLICY.md).

## Pricing data

Reviewed historical pricing is intentionally contributor-editable, but it has a higher evidence bar than a current-price lookup table. The source of truth, unit conversions, provenance rules, append-only history model, supported modifiers and validation commands are documented in [`docs/CONTRIBUTING_PRICING.md`](docs/CONTRIBUTING_PRICING.md).

Do not hand-edit the generated `docs/PRICING_HISTORY.md`, backdate a current price without evidence, or encode unknown pricing as zero.

## Provider and collector changes

Collectors silently affect totals and therefore have a high evidence bar. A provider change should include:

1. fixtures representing the observed format;
2. targeted parser tests;
3. cache/parser version review;
4. validation against real sessions generated with the tool;
5. comparison with authoritative counters or source records when available;
6. explicit handling of ambiguous and estimated values;
7. privacy review for new captured fields.

Online documentation or AI-generated assumptions are not sufficient evidence for storage paths, schemas, token semantics or pricing.

## Pull requests

Use the pull-request template and report only validation actually performed. Include screenshots for visible changes, migration impact where applicable, known risks and rollback information.

Squash merge is preferred for bounded feature branches unless preserving a structured series is materially useful.

## Security issues

Do not file vulnerabilities in the public tracker. Follow [`SECURITY.md`](SECURITY.md).

## License

Metrora is distributed under the MIT License. Upstream-derived portions retain their original notices and licence terms. Contributions are licensed under the repository's MIT terms. See [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md), [`UPSTREAM.md`](UPSTREAM.md) and [`LICENSES/`](LICENSES/).
