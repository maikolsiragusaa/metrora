# Versioning authority

Metrora uses semantic versioning for public product identity and separate numeric versions where desktop/platform packaging requires them.

## Current line

- Published Store source line: `1.0.0-rc.10`
- Desktop build version: `1.0.0.10`
- Latest published GitHub technical preview: `1.0.0-rc.7`
- First intended stable release: `1.0.0`

Changing metadata does not create an accepted artifact. Candidate identity always consists of the version, exact source commit, payload manifest and checksums, plus the applicable platform acceptance.

## Product and desktop build mapping

For a candidate `MAJOR.MINOR.PATCH-rc.N`, the desktop build version is:

`MAJOR.MINOR.PATCH.N`

Candidate numbers are limited to 1–9999.

For a stable `MAJOR.MINOR.PATCH`, the desktop build version is:

`MAJOR.MINOR.PATCH.10000`

This keeps the stable desktop build numerically above its release candidates while leaving room for later patch versions. Every numeric build-version component remains inside the supported four-part range.

## Microsoft Store package version

The Microsoft Store AppX/MSIX manifest has a separate four-component package identity. For the Windows 10/11 Store package, Metrora uses:

`MAJOR.MINOR.PATCH.0`

The final component is `0` for the Store package contract. The SemVer pre-release suffix (`-rc.N`) is **not** encoded into the AppX identity version, and the desktop build counter (`MAJOR.MINOR.PATCH.N`) must not be presented as the Store package version.

For the current `1.0.0` Store-associated source line:

- source/product candidate: `1.0.0-rc.10`;
- desktop build version: `1.0.0.10`;
- published Store AppX identity version: `1.0.0.0`.

The published Store authority is the frozen RC10 line under Vensent. A local
build with the same identity version is not, by itself, evidence of the live
listing; later Store updates must advance according to the Store's
package-version rules and pass their own acceptance and publication gates.

## Android version authority

Android uses the native `versionName` and integer `versionCode` declared in
`android/app/build.gradle.kts`. The current never-public source value is:

- `versionName = 0.1.0-alpha.1`;
- `versionCode = 1`;
- application ID `eu.metrora.app`.

Because no production-signed Android artifact has been publicly installable,
retaining `versionCode = 1` for the first direct APK is valid. Every later
publicly installable Android upgrade must use a strictly larger `versionCode`.
The human-readable `versionName` is used in the deterministic GitHub identity
`android-v<versionName>` and asset name
`Metrora-Android-<versionName>.apk`. Android's version line is independent of
the frozen Windows Store package version. A future Play path keeps the same
application ID and monotonic package line, subject to its separate signing and
publication gates.

## Ordering

Metrora accepts only stable versions and numbered release candidates in the forms:

- `MAJOR.MINOR.PATCH`
- `MAJOR.MINOR.PATCH-rc.N`

For the same core version, release candidates are ordered by `N` and the stable release sorts after every candidate. Release and migration tooling must use the shared authority in `scripts/version-authority-lib.mjs`; platform-native parsers that reject SemVer prerelease identifiers are not authoritative for Metrora product ordering.

## Material candidate changes

Advance `rc.N` whenever source changes can alter user-visible accounting, historical reconciliation, persisted-state interpretation, security or trust evidence, packaging, installation, migration, rollback or platform behavior.

Parser and provider corrections that can change tokens, costs, calls, projects or other reported usage are material even when their code delta is small. Persisted endpoint-software reconciliation is also material because it changes the interpretation/presentation of stored Workspace state. Accounting-authority presentation changes and packaged-runtime changes are likewise material because they can change what the user sees or whether the distributed application can execute its bundled collector.

Documentation-only clarification, test-only determinism and other changes proven not to alter shipped behavior do not automatically require a new candidate. The applicable validation still follows the changed surface.

## Authorities

The following values must agree where they represent the same authority:

- root `package.json` and root `package-lock.json` — product SemVer;
- desktop `app/package.json` and `app/package-lock.json` — product SemVer;
- desktop `buildVersion` — desktop numeric build mapping;
- Store AppX manifest — Store package-version mapping;
- current-version declarations in `RELEASING.md`;
- current desktop declarations in `app/DISTRIBUTION.md`;
- current release-line declarations in this document and `docs/WINDOWS_DISTRIBUTION.md`.

Run:

`npm run version:check`

CI executes the same check on pull requests and pushes to `main`.

## Historical evidence

Historical version references are immutable evidence, not active version authorities. Published RC7 release records and accepted 0.9.19 candidate reports, manifests, migration fixtures, provenance notices and changelog history retain their original version/source binding.

Never rename an old report or artifact to the current version, and never treat an accepted artifact as evidence for a later source commit.
