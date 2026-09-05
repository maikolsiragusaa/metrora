# Releasing Metrora

Metrora does not yet have an official stable desktop release. Windows is publicly distributed through Microsoft Store, published by Vensent, with RC11 as the current Store authority. Android is publicly distributed through Google Play under package identity `eu.metrora.app`, with a separately documented direct APK channel.

This document defines the public release boundary. Protected credentials, private custody procedures and unpublished operational details do not belong here.

## Canonical identity

- Product: **Metrora**
- Domain: **metrora.eu**
- Repository: `maikolsiragusaa/metrora`
- Canonical command: `metrora`
- Published Windows Store source line: `1.0.0-rc.11`
- Published Windows desktop build version: `1.0.0.11`
- Published Windows Store package version: `1.0.1.0`
- Previous Windows Store line: `1.0.0-rc.10` / Desktop `1.0.0.10` / Store `1.0.0.0`
- Latest published GitHub Windows technical preview: `1.0.0-rc.7`
- Android application ID: `eu.metrora.app`
- Android public channels: Google Play + separately source-bound direct APK releases

Historical protocol/signed-data identifiers are governed by their versioned contracts and are not release brands or names for new artifacts.

The root npm package is private and must not be published from this repository.

## Current public channels

### Windows

`1.0.0-rc.11` is the current published Microsoft Store source line for Windows distribution under publisher Vensent. It was accepted as the Store update with Desktop build `1.0.0.11` and Store package identity `1.0.1.0`.

RC10 remains immutable historical publication evidence. RC9 and earlier candidates remain bound to their own source/acceptance records. Post-RC11 development does not retroactively change the Store artifact; another Store update requires its own candidate, acceptance, submission and publication decision.

`1.0.0-rc.7` remains the latest published GitHub Windows technical preview. That unsigned channel is separate from Microsoft Store signing/certification and remains immutable historical evidence for its accepted source.

### Android

Google Play is a live public Android channel for package `eu.metrora.app`.

A production-signed direct GitHub APK channel is also retained for users who intentionally choose direct installation or Obtainium. The current historical direct release is `0.1.0-alpha.3` under tag `android-v0.1.0-alpha.3`; earlier direct-release history remains immutable evidence.

A GitHub APK release and a Google Play release are separate channel events even when they share application identity and monotonic `versionCode` ordering.

See [`docs/ANDROID_PUBLIC_DISTRIBUTION_V1.md`](docs/ANDROID_PUBLIC_DISTRIBUTION_V1.md) and [`docs/VERSIONING.md`](docs/VERSIONING.md).

## Version authorities

Metrora deliberately separates product/source versions from platform packaging versions.

Windows currently uses:

- product/source SemVer `1.0.0-rc.11`;
- Desktop build version `1.0.0.11`;
- Microsoft Store AppX package identity `1.0.1.0`.

Android uses `versionName` plus strictly increasing integer `versionCode` under `eu.metrora.app`.

A source version is not automatically evidence that a Store channel has published that exact source. Store/listing authority and source/build authority remain separate until the publication gate completes.

See [`docs/VERSIONING.md`](docs/VERSIONING.md).

## Release responsibilities

An official release/update proceeds through separate responsibilities:

1. freeze the reviewed public source/version;
2. run applicable tests, architecture and security gates;
3. assemble the declared product/channel artifact;
4. verify package identity, payload, provenance and digests independently;
5. run platform/lifecycle/physical acceptance where required;
6. apply the protected distribution identity/signing authority;
7. publish through the intended channel as a separate action;
8. update public website/docs only after the channel is actually accepted/live;
9. retain rollback authority and historical release evidence.

Build, packaging, signing, publication and rollback must not collapse into one opaque “release” step.

## Required validation

Run checks owned by the changed surface, including where applicable:

```bash
npm ci
npm run build:cli
npm test -- --run
npm --prefix app ci
npm --prefix app test
npm --prefix app run typecheck
npm --prefix app run build
```

Platform workflows add their own manifest, payload, runtime, installation, update, rollback and state-preservation checks.

A file merely being present in a package is not equivalent to executing the bundled runtime successfully.

## Windows GitHub technical preview

An unsigned Windows GitHub pre-release is a technical-evaluation channel. It is separate from Microsoft Store signing/certification.

The published `v1.0.0-rc.7` pre-release remains bound to its accepted source commit and release evidence. New source changes do not retroactively alter that release.

Any later GitHub pre-release must again come from one exact reviewed source commit and pass the applicable artifact-binding and physical-acceptance boundaries before publication.

See [`docs/WINDOWS_GITHUB_PRE_RELEASE_ACCEPTANCE_V1.md`](docs/WINDOWS_GITHUB_PRE_RELEASE_ACCEPTANCE_V1.md).

## Microsoft Store boundary

The live Windows Store package derives from reviewed source and its accepted Store artifact/identity.

For any future Store candidate:

- exact artifact/workflow provenance must verify;
- Store identity, publisher, architecture, capabilities and package version must match reviewed configuration;
- bundled Metrora runtime must execute from the package without relying on an undeclared external runtime;
- the pinned OpenCode runtime required by the current Code surface must be present and pass its package/runtime validation;
- local physical acceptance must not be confused with Microsoft certification;
- submission/publication requires a separate explicit decision after candidate validation.

## Android channel boundary

Android release variants share application identity but keep validation/signing/publication responsibilities separate.

Public invariants:

- application ID remains `eu.metrora.app`;
- public upgrades use strictly increasing `versionCode` values;
- debug/QA identities are not production identities;
- direct-production signing and Play-upload signing are separate responsibilities;
- private signing material is not repository/issue/PR/log content;
- candidate build success is not publication authority;
- direct APK assets remain source-bound and independently verifiable where documented;
- Google Play status is taken from the live Store channel rather than inferred from a CI artifact.

The current direct-channel contract is documented in [`docs/ANDROID_PUBLIC_DISTRIBUTION_V1.md`](docs/ANDROID_PUBLIC_DISTRIBUTION_V1.md).

## Release notes

Every public release note should state what users need to verify the release without dumping private operational detail:

- version/source identity;
- distribution channel/format;
- signature status where relevant;
- supported platform scope;
- checksums/provenance location where published;
- migration/rollback constraints;
- known limitations;
- privacy-impacting changes, if any.

## Rollback

Do not rewrite or replace a broadly distributed release under the same version.

Rollback/migration must preserve user-owned state according to the accepted platform contract, including relevant endpoint identity, analytics, Workspace state, evidence and exports.

## Platform boundary

- Windows is the first official desktop distribution target.
- Android is an official companion distribution target through Google Play, with a separate direct channel.
- macOS development artifacts remain development source until platform-specific trusted-distribution acceptance exists.
- Linux formats require packaging/support acceptance before official publication.
- mobile distribution does not replace Desktop/core factual authority.

## Prohibitions

- no `npm publish` from the private root package;
- no inherited upstream publication instructions presented as Metrora;
- no protected credentials/private signing material in untrusted pull requests or public documentation;
- no publication from an unverified local build;
- no silent replacement of accepted artifacts;
- no Store/certification claim before the channel is actually live;
- no claim of an official stable desktop release before the relevant stable channel passes acceptance.
