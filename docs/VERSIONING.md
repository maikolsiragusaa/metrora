# Versioning authority

Metrora uses semantic versioning for public product identity and a separate numeric build version where platform metadata requires one.

## Current line

- Public development version: `1.0.0-rc.1`
- Desktop build version: `1.0.0.1`
- First intended stable release: `1.0.0`

Changing metadata does not create an accepted artifact. Candidate identity always consists of the version, exact source commit, payload manifest and checksums, plus the applicable platform acceptance.

## Mapping

For a candidate `MAJOR.MINOR.PATCH-rc.N`, the desktop build version is:

`MAJOR.MINOR.PATCH.N`

Candidate numbers are limited to 1–9999.

For a stable `MAJOR.MINOR.PATCH`, the desktop build version is:

`MAJOR.MINOR.PATCH.10000`

This keeps the stable build numerically above its release candidates while leaving room for later patch versions. Every numeric build-version component is limited to the Windows four-part version range.

## Ordering

Metrora accepts only stable versions and numbered release candidates in the forms:

- `MAJOR.MINOR.PATCH`
- `MAJOR.MINOR.PATCH-rc.N`

For the same core version, release candidates are ordered by `N` and the stable release sorts after every candidate. Release and migration tooling must use the shared authority in `scripts/version-authority-lib.mjs`; platform-native parsers that reject SemVer prerelease identifiers are not authoritative.

## Authorities

The following values must agree:

- root `package.json`;
- root `package-lock.json`;
- desktop `app/package.json`;
- desktop `app/package-lock.json`;
- desktop `buildVersion` mapping;
- current-version declarations in `RELEASING.md`;
- current desktop declarations in `app/DISTRIBUTION.md`;
- current release-line declarations in this document and `docs/WINDOWS_DISTRIBUTION.md`.

Run:

`npm run version:check`

CI executes the same check on pull requests and pushes to `main`.

## Historical evidence

Historical version references are immutable evidence, not active version authorities. In particular, accepted 0.9.19 candidate reports, manifests, migration fixtures, provenance notices and changelog history must retain their original version and source binding.

Never rename an old report or artifact to the current version, and never treat an accepted artifact as evidence for a later source commit.
