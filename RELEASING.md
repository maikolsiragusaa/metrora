# Releasing Metrora

Metrora does not yet have an official stable desktop release. This document defines the current release boundary and replaces inherited upstream publication instructions.

## Canonical identity

- Product: **Metrora**
- Domain: **metrora.eu**
- Repository: `maikolsiragusaa/metrora`
- Canonical command: `metrora`
- Current development version: `0.9.19`

The `qovrion` and `codeburn` commands are temporary compatibility aliases. They are not release brands, package names to advertise or names for new artifacts.

The root npm package is private and must not be published from this repository.

## Current release authority

The accepted Windows development authority is the R1.B candidate bound to:

- source commit `28095e7f4cea5df5a3f87d34defcd8d2789252e5`;
- candidate ZIP SHA-256 `8c72bb317321a5a78db9ca3245660084d726577a5de239500adfc6e9b9fcaa77`;
- exact physical-acceptance report SHA-256 `aa1e8c16d1a12e1f24bf360a047e75c692d7ab858d8134ef9c61f4f6132ed85d`.

That candidate passed the existing-profile, clean-profile and migration physical checks. It remains unsigned and is not an official stable release.

## Windows distribution model

Metrora uses two parallel channels.

### Microsoft Store

The recommended ordinary-user channel will be an AppX/MSIX package:

- built separately on Windows from reviewed public source;
- left unsigned before Partner Center submission;
- signed, hosted and updated by Microsoft after certification;
- configured with exact Metrora product identity values issued by Partner Center;
- physically accepted under a Store-specific install/update/uninstall matrix.

Store identity values must never be guessed or copied from another application.

### GitHub Releases and metrora.eu

The technical-user channel may publish:

- a verified portable ZIP;
- an explicitly unsigned NSIS installer;
- SHA-256 checksums;
- release and format manifests;
- provenance and clear SmartScreen instructions.

Unsigned GitHub artifacts must never be described as Microsoft-signed or equivalent to the Store package.

## Release sequence

A Windows release proceeds through separate responsibilities:

1. freeze the public source commit and version;
2. run public tests, architecture gates and security checks;
3. assemble the canonical unsigned Windows payload;
4. derive portable and NSIS formats and emit manifests;
5. verify artifact inventory and digests independently;
6. run the required physical acceptance;
7. build and verify the Store package as a separate format;
8. submit manually to Partner Center only after explicit approval;
9. publish GitHub artifacts, checksums and notes separately;
10. update `metrora.eu` only after the relevant channel is accepted;
11. preserve rollback authority and prior accepted artifacts.

Build, packaging, Store submission, GitHub publication and rollback must not be collapsed into one all-purpose workflow.

## Required validation

Before publication, run the checks owned by the affected surface, including:

```bash
npm ci
npm run build:cli
npm test -- --run
npm --prefix app ci
npm --prefix app test
npm --prefix app run typecheck
npm --prefix app run build
```

Windows candidate and Store-package workflows add their own manifest, payload, installation, update, rollback and state-preservation checks.

## Versioning and notes

Metrora uses semantic versioning. A release change must update all version-bearing packages and generated metadata deliberately; do not assume one package file is the only authority.

Every public release note must state:

- version and source commit;
- distribution channel and format;
- signed/unsigned status;
- supported operating-system scope;
- checksums and provenance location;
- migration or rollback constraints;
- known limitations;
- privacy-impacting changes, if any.

## Rollback

Do not rewrite or replace a broadly distributed release under the same version. Publish a new patch version and retain the previous accepted artifact long enough to support rollback.

Rollback must preserve endpoint identity, OS-vault material, analytics, Workspace state, evidence, exports and user-owned local files according to the accepted migration contract.

## macOS, Linux and Android

- macOS development builds remain ad-hoc signed and unnotarized until a separate trusted-distribution tranche is approved.
- Linux formats require their own packaging and support acceptance before official publication.
- Android uses a separate mobile-store signing and release boundary and remains a companion to desktop/Workspace authority.

## Prohibitions

- no `npm publish` from the private root package;
- no inherited upstream package, tap or release instructions presented as Metrora;
- no paid Windows signing purchase under the current zero-cost decision;
- no secrets or Store credentials in untrusted pull requests;
- no publication from an unverified local build;
- no silent replacement of accepted artifacts;
- no claim of an official release before the relevant channel passes acceptance.
