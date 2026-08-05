# Releasing Metrora

Metrora does not yet have an official stable desktop release. This document defines the current public release boundary.

## Canonical identity

- Product: **Metrora**
- Domain: **metrora.eu**
- Repository: `maikolsiragusaa/metrora`
- Canonical command: `metrora`
- Current development version: `1.0.0-rc.1`
- Current desktop build version: `1.0.0.1`

Temporary compatibility commands are governed by the technical compatibility register. They are not release brands or names for new artifacts.

The root npm package is private and must not be published from this repository.

## Current engineering authority

The active source line is `1.0.0-rc.1`, with desktop build metadata `1.0.0.1`. No artifact at this version is accepted, signed or published merely because the metadata exists.

The accepted Windows 0.9.19 candidate remains bound to reviewed public source, independently verifiable manifests and a sanitized physical-acceptance report.

It passed existing-state, clean-install and migration lifecycle validation. It remains unsigned engineering evidence and is not an official stable release.

Exact accepted source and artifact digests remain recorded in the applicable Windows acceptance contract and GitHub workflow record rather than repeated across general release guidance.

## Release responsibilities

An official desktop release proceeds through separate responsibilities:

1. freeze the public source commit and version;
2. run applicable tests, architecture and security gates;
3. assemble the canonical product payload;
4. derive declared platform formats and manifests;
5. verify artifact inventory and digests independently;
6. run platform and lifecycle acceptance;
7. apply the exact accepted distribution identity and protected signing authority where required;
8. publish artifacts, checksums, provenance and release notes;
9. update `metrora.eu` only after the relevant channel is accepted;
10. retain rollback authority and prior accepted artifacts.

Build, packaging, protected signing, publication and rollback must not be collapsed into one all-purpose workflow.

## Required validation

Run the checks owned by the affected surface, including where applicable:

```bash
npm ci
npm run build:cli
npm test -- --run
npm --prefix app ci
npm --prefix app test
npm --prefix app run typecheck
npm --prefix app run build
```

Platform workflows add their own manifest, payload, installation, update, rollback and state-preservation checks.

## Versioning and notes

Metrora uses semantic versioning. The first independent candidate line is `1.0.0-rc.N`; the first official stable release is `1.0.0`. A release change updates every version-bearing package and generated metadata deliberately. See [`docs/VERSIONING.md`](docs/VERSIONING.md).

Every public release note states:

- version and source commit;
- distribution channel and format;
- signature status;
- supported operating-system scope;
- checksums and provenance location;
- migration or rollback constraints;
- known limitations;
- privacy-impacting changes, if any.

## Rollback

Do not rewrite or replace a broadly distributed release under the same version. Publish a new patch version and retain the previous accepted artifact long enough to support rollback.

Rollback preserves endpoint identity, OS-vault material, analytics, Workspace state, evidence, exports and user-owned local files according to the accepted migration contract.

## Platform boundary

- Windows is the first official desktop distribution target.
- macOS development artifacts remain ad-hoc signed and unnotarized until platform-specific trusted-distribution acceptance passes.
- Linux formats require packaging and support acceptance before official publication.
- Mobile distribution has its own signing and release boundary and does not replace desktop or Workspace authority.

## Prohibitions

- no `npm publish` from the private root package;
- no inherited upstream publication instructions presented as Metrora;
- no protected credentials in untrusted pull requests;
- no publication from an unverified local build;
- no silent replacement of accepted artifacts;
- no claim of an official release before the relevant channel passes acceptance.
