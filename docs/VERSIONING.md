# Versioning authority

Metrora uses semantic versioning for public product identity and separate numeric versions where desktop/platform packaging requires them.

## Current line

- Published Store source line: `1.0.0-rc.11`
- Published Desktop build version: `1.0.0.11`
- Published Store package version: `1.0.1.0`
- Previous published Store source line: `1.0.0-rc.10`
- Previous published Desktop build version: `1.0.0.10`
- Previous published Store package version: `1.0.0.0`
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

The current and previous published authorities are:

- current RC11 source/product line: `1.0.0-rc.11`;
- current RC11 Desktop build version: `1.0.0.11`;
- current Store AppX identity version: `1.0.1.0`;
- previous RC10 source/product line: `1.0.0-rc.10`;
- previous RC10 Desktop build version: `1.0.0.10`;
- previous Store AppX identity version: `1.0.0.0`.

The machine-readable Store package authority is
`release/windows-store-package-version.v1.json`. Its current values encode the
RC10-to-RC11 package transition that produced the now-published RC11 update.
Before another Store candidate is derived, that authority must be advanced by a
separate reviewed release decision so the published baseline reflects
`1.0.1.0` and any next candidate remains strictly greater. A local build with a
known identity version is not, by itself, evidence of a live listing; later
Store updates must pass their own acceptance and publication gates.

## Android version authority

Android uses the native `versionName` and integer `versionCode` declared in
`android/app/build.gradle.kts` under application ID `eu.metrora.app`.

Historical/direct-channel authority includes:

- immutable historical public release `0.1.0-alpha.1` / `versionCode = 1`;
- failed, never-published candidate `0.1.0-alpha.2` / `versionCode = 2`;
- production-signed direct GitHub release `0.1.0-alpha.3` / `versionCode = 3`.

The current repository source line is:

- `versionName = 0.1.0-alpha.4`;
- `versionCode = 4`;
- application ID `eu.metrora.app`.

**Google Play is now a live Android distribution channel** for the same
`eu.metrora.app` package identity. The Play channel and direct APK channel share
the same monotonic `versionCode` line so a later public upgrade must always use
a strictly larger integer.

The exact version currently served by Google Play is Store-channel authority;
do not infer it merely from a historical direct GitHub release document. The
repository source version is likewise not automatically evidence that Google
Play has published that exact source until the corresponding Play release gate
has completed.

The human-readable `versionName` continues to be used for deterministic direct
GitHub identities such as `android-v<versionName>` and
`Metrora-Android-<versionName>.apk`. Android versioning remains independent of
the Windows Store package version.

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
- `release/windows-store-package-version.v1.json` — Store package transition authority for candidate derivation;
- Store AppX manifest — candidate Store package-version mapping after the hook;
- `android/app/build.gradle.kts` — Android source `versionName` / `versionCode` / application ID;
- current-version declarations in `RELEASING.md`;
- current desktop declarations in `app/DISTRIBUTION.md`;
- current release-line declarations in this document and `docs/WINDOWS_DISTRIBUTION.md`.

Run:

`npm run version:check`

CI executes the same check on pull requests and pushes to `main`.

## Historical evidence

Historical version references are immutable evidence, not active version authorities. Published RC7, RC10, Android direct releases and earlier accepted candidate reports, manifests, migration fixtures, provenance notices and changelog history retain their original version/source binding.

Never rename an old report or artifact to the current version, and never treat an accepted artifact as evidence for a later source commit.
