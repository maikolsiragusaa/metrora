# Android public distribution v1

**Status:** Google Play is a live public Android channel for Metrora under application ID `eu.metrora.app`. A production-signed direct GitHub APK channel is also retained for intentional direct installation and Obtainium use.

This document records the public distribution, identity, integrity and signing boundaries that matter to users and contributors. Historical direct-release evidence is preserved without treating old release-gate state as current Store authority.

## Current distribution

| Channel | Status | Authority |
| --- | --- | --- |
| **Google Play** | **Live** | Google Play listing for package `eu.metrora.app` |
| **Direct GitHub APK** | **Available** | source-bound production-signed release assets under `android-v<versionName>` |
| **F-Droid** | Not claimed as published | separate reproducibility/compliance gate |

Recommended ordinary Android install path:

[Get Metrora on Google Play](https://play.google.com/store/apps/details?id=eu.metrora.app)

The direct APK path remains useful for users who deliberately prefer direct installation, release-manifest verification or Obtainium.

## Product authority

The Android application is a companion to an explicitly paired Metrora Desktop.

Desktop/core remains authoritative for:

- collection and provider parsing;
- canonical usage/history;
- pricing and accounting;
- Projects and evidence semantics;
- provider Capacity projections;
- Workspace authority where applicable.

Android consumes bounded projections from that authority. It does not become a second collection, pricing or evidence engine merely because it is distributed through Google Play.

## Package and version identity

Canonical Android application ID:

`eu.metrora.app`

Android uses the native `versionName` and strictly increasing integer `versionCode` declared in `android/app/build.gradle.kts`.

Current repository source line:

- `versionName = 0.1.0-alpha.4`;
- `versionCode = 4`;
- application ID `eu.metrora.app`.

Historical direct-channel evidence:

- `0.1.0-alpha.1` / `versionCode = 1` — immutable historical public release;
- `0.1.0-alpha.2` / `versionCode = 2` — failed candidate, never published;
- `0.1.0-alpha.3` / `versionCode = 3` — accepted production-signed GitHub direct release.

Google Play and direct APK releases share the same package identity and monotonic `versionCode` line. A later installable build must not reuse or decrease a previously public version code.

The exact version currently served by Google Play is Store-channel authority. A repository source version or historical direct APK version must not be described as the current Play version without a corresponding published Play release.

See [Versioning authority](VERSIONING.md).

## Direct APK contract

The direct channel uses predictable source-bound GitHub release identity:

- repository: `maikolsiragusaa/metrora`;
- tag: `android-v<versionName>`;
- application ID: `eu.metrora.app`;
- APK: `Metrora-Android-<versionName>.apk`;
- manifest: `Metrora-Android-<versionName>.manifest.json`;
- integrity file: `SHA256SUMS`.

The current historical direct-release authority documented here is `0.1.0-alpha.3` / `versionCode = 3`.

Accepted artifact:

`Metrora-Android-0.1.0-alpha.3.apk`

SHA-256:

`e9868958d26b58ffefa3aaa51a687cd64abc5e73219cd2e9cc8f8d0c8561f305`

The direct manifest/checksum bundle remains independently verifiable and must remain bound to the reviewed source commit, package/version identity and signing certificate used for that release.

A GitHub APK release and a Google Play release are different channel events even when they share the same application identity.

## Google Play boundary

Google Play publication uses the `play` Android flavor and Play App Signing/upload-key workflow defined by the repository release process.

Public invariants:

- Play keeps application ID `eu.metrora.app`;
- Play uses the same monotonic `versionCode` sequence as the direct package line;
- release/upload credentials are not repository content;
- candidate validation is separate from final Store publication;
- a successfully built AAB is not evidence that Google Play published it;
- current Store status must be taken from the live listing/release authority, not inferred from CI alone.

The public repository intentionally documents these invariants without publishing private signing material or operational custody details.

## Signing boundary

Debug, QA, direct-production and Play-upload identities are distinct responsibilities.

Required principles:

- no private keystore is committed;
- no signing password/private key is printed into logs, issues, PRs or artifacts;
- QA identity is not a production release identity;
- direct production signing does not silently substitute for Play upload signing;
- release jobs fail closed when required protected signing material is absent;
- ordinary pull-request validation does not require private production credentials;
- signing material is scoped to protected release execution and removed from temporary runner state after use.

Public certificate fingerprints and source/artifact hashes may be used as non-secret verification evidence. Private key custody remains outside the public repository.

## Source binding and verification

Android release tooling verifies the relevant package/channel artifact against reviewed source and expected public identity.

Direct APK verification covers, as applicable:

- application ID;
- `versionName` / `versionCode`;
- APK signature and expected public certificate fingerprint;
- canonical artifact/manifest names;
- artifact SHA-256;
- `SHA256SUMS` membership;
- exact source commit binding.

Play candidate verification additionally checks AAB/package/upload-signing identity using the repository's bounded Play verification tooling.

The important release invariant is simple:

```text
reviewed source
     ↓
validated channel artifact
     ↓
identity + signature + digest checks
     ↓
physical/product acceptance where required
     ↓
separate publication action
```

A build does not become an official release merely because it passed CI.

## Obtainium and direct installation

Obtainium users can track the repository's `android-v*` releases and select the canonical `Metrora-Android-<versionName>.apk` asset.

The direct channel keeps stable naming plus manifest/checksum evidence so users can inspect what they install without requiring a Metrora-hosted updater backend.

Google Play remains the simpler ordinary install/update path for most Android users.

## Privacy and pairing

Distribution channel does not change the local-first companion model.

Android pairing uses encrypted transport and explicitly approved Desktop identity. Ordinary companion flows are designed around bounded factual projections and do not intentionally export unrestricted work content such as:

- prompt or assistant-response bodies;
- source files, source code, patches or diffs;
- provider credentials or API keys;
- unrestricted local filesystem paths.

The current Android companion contains no advertising SDK or behavioral-analytics SDK according to the current source/dependency authority. See the current [Metrora privacy policy](https://metrora.eu/privacy) and [Local companion API](LOCAL_COMPANION_API.md).

## Brand authority

Android uses the current Metrora Graphite + Signal Cyan product identity documented under `assets/brand`.

Historical visual acceptance material may remain evidence for the artifact it tested, but should not be reused as current marketing if the product surface has materially changed.

This is especially relevant now that Metrora is positioned as a broader control center rather than only a usage-tracking companion.

## Contributor validation

For ordinary Android repository work, use the project-supported Java/Gradle/Android SDK versions and run focused unit/lint/build validation appropriate to the changed surface.

Typical checks include:

```bash
gradle -p android --no-daemon :app:testGithubDebugUnitTest :app:lint :app:assembleGithubDebug
```

Distribution variants can be built for validation without implying publication:

```bash
gradle -p android --no-daemon :app:assembleGithubRelease :app:assembleFdroidRelease :app:bundlePlayRelease
```

Production signing and final publication remain protected release operations.

## Historical evidence rule

Historical direct releases, failed candidates, manifests, checksums and physical acceptance records remain immutable evidence for the source/artifact they name.

Do not rewrite an old release into a new one, do not reuse a consumed version code, and do not treat a historical GitHub release as proof of the version currently served by Google Play.

## Related documents

- [Getting started](GETTING_STARTED.md)
- [Android companion foundation](ANDROID_COMPANION_FOUNDATION.md)
- [Local companion API](LOCAL_COMPANION_API.md)
- [Mobile Product Parity V1](MOBILE_PRODUCT_PARITY_V1.md)
- [Versioning authority](VERSIONING.md)
- [Releasing Metrora](../RELEASING.md)
