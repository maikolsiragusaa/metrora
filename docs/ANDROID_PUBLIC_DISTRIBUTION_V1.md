# Android public distribution v1

**Status:** direct-APK distribution contract; the current public Android
release is `0.1.0-alpha.3` / `versionCode = 3`. Its GitHub prerelease tag is
`android-v0.1.0-alpha.3`, with accepted artifact
`Metrora-Android-0.1.0-alpha.3.apk` and SHA-256
`e9868958d26b58ffefa3aaa51a687cd64abc5e73219cd2e9cc8f8d0c8561f305`.
`0.1.0-alpha.1` remains historical public-release evidence. The
`0.1.0-alpha.2` / `versionCode = 2` candidate failed production release
acceptance and was never public.

**Historical base audit:** `maikolsiragusaa/metrora@69f0688fea5bb48f37b770e8de590ad20e490d74`

This document records the Founder-gated, direct GitHub APK contract for the
implemented Android companion. The table below preserves historical evidence
for the named audit base; its alpha.1 and no-public-release statements are not
current alpha.3 authority. Google Play and F-Droid remain separate channels
with their own gates.

## Historical audit at the named base

The audit covered the Android Gradle project and source tree, the existing
Android companion workflow, repository release/version authorities, public
brand authority, the read-only commercial strategy at
`metrora-commercial@238ee31b21cd746172d19c9fcfc1e60db6e5720f`, and the
read-only infra release/custody conventions.

| Capability | Actual state at the audit base | Release blocker | Implementable now | Founder/secret gate |
| --- | --- | --- | --- | --- |
| Android product | Mobile Product Foundation V1, bounded Activity, Analyze and Settings surfaces are in the source tree; UX V2 has a final QA APK acceptance authority | Final production-signed physical acceptance is still required | Yes | Production key and final physical stop/go |
| GitHub flavor | `github`, `fdroid` and `play` flavors exist; `eu.metrora.app` is the release application ID and debug uses `.debug` isolation | No canonical public APK asset/metadata contract | Yes | None for validation; production key for release |
| Current CI | `android-companion.yml` runs unit tests, lint, GitHub/F-Droid APK builds and Play AAB build; QA signing is limited to `githubDebug` on trusted runs | Existing release packages are validation artifacts, not public release artifacts | Yes | QA secret only for physical-acceptance validation |
| Production signing | No production key is present in the repository or current CI | A public APK must not be unsigned, debug-signed or QA-signed | Workflow and verifier support | Founder-owned key, passwords and certificate fingerprint |
| Source binding | Existing Windows release conventions are source-bound; Android had no equivalent public-release verifier | An arbitrary checkout must not become a release | Yes | Founder reviews the exact source commit |
| Version authority | `android/app/build.gradle.kts` declares `versionName = 0.1.0-alpha.1` and `versionCode = 1` | Future public upgrades must advance `versionCode` strictly | Yes; retain the never-public initial value | Founder approves each release |
| Release discovery | No changing asset semantics or updater service exists | Obtainium needs a predictable GitHub release and APK asset | Yes | Founder publishes the final release |
| Brand tokens | Android primary cyan was `#0BD5F4`; the public authority is Graphite + Signal Cyan | Primary token drift from the canonical brand authority | Yes | None |
| F-Droid | The flavor builds, but dependency/license/compliance status is not a release claim | CameraX/ZXing and reproducible metadata need a separate review | Characterize only | Separate F-Droid gate |
| Google Play | The Play AAB builds | Listing, Play signing and publication gates are not complete | Preserve buildability only | Separate Play gate |

## Current accepted authority

The direct Android release gate has completed for alpha.3. The public channel is
the GitHub prerelease identified above; it is not a Google Play or F-Droid
publication. The accepted production APK is the canonical direct-install
artifact, and its public manifest and `SHA256SUMS` remain the integrity
references for users.

The Android product remains local-first and read-focused. Desktop/core remains
authoritative for collection, parsing, pricing, accounting, canonical history,
evidence and Workspace semantics.

## Direct distribution contract

The public Android channel is a GitHub Release containing one canonical
APK for ordinary direct installation:

- repository: `maikolsiragusaa/metrora`;
- release tag: `android-v<versionName>`;
- release title: `Metrora Android <versionName>`;
- application ID: `eu.metrora.app`;
- canonical APK asset: `Metrora-Android-<versionName>.apk`;
- manifest asset: `Metrora-Android-<versionName>.manifest.json`;
- integrity asset: `SHA256SUMS`.

The current public release is `0.1.0-alpha.3` with `versionCode = 3` and tag
`android-v0.1.0-alpha.3`. The immutable `0.1.0-alpha.1` release remains
historical evidence. The prior `0.1.0-alpha.2` / `versionCode = 2` candidate is
retained as historical failed, unpublished evidence and must not be
overwritten, reissued or described as a public release.

The following illustrative manifest uses the current alpha.3 public identity;
the certificate value remains a schema placeholder and is not release evidence:

```json
{
  "schemaVersion": 1,
  "product": "Metrora",
  "versionName": "0.1.0-alpha.3",
  "versionCode": 3,
  "distributionChannel": "github",
  "applicationId": "eu.metrora.app",
  "sourceCommit": "<reviewed source commit>",
  "artifactFilename": "Metrora-Android-0.1.0-alpha.3.apk",
  "artifactSha256": "e9868958d26b58ffefa3aaa51a687cd64abc5e73219cd2e9cc8f8d0c8561f305",
  "signingCertificateSha256": "<64-character certificate SHA-256>"
}
```

The placeholder values above are illustrative schema values, not release
evidence. The workflow generates the actual manifest from the verified APK and
does not write secret or private-key material into it.

`SHA256SUMS` contains exactly the APK and manifest filenames. The verifier
rejects additional bundle files, path traversal, checksum mismatches, a wrong
application ID, a wrong version, an unsigned APK/AAB, a certificate mismatch
or a source-commit mismatch.

## Version policy

Android has a platform-native version authority separate from the frozen
Windows Store package version:

- source authority: `android/app/build.gradle.kts`;
- current published direct APK authority: `0.1.0-alpha.3` / `versionCode = 3`;
- current source / Google Play candidate line: `0.1.0-alpha.4` / `versionCode = 4`;
- GitHub identity: `android-v<versionName>`;
- Play and direct APK upgrades use the same `eu.metrora.app` package line and
  the same strictly increasing `versionCode` sequence.

The immutable alpha.1 production-signed artifact consumed `versionCode = 1`.
The historical alpha.2 candidate advanced the same application identity to
`versionCode = 2` but failed production release acceptance and remains
unpublished. The accepted alpha.3 release advances the same identity to
`versionCode = 3`. Every later publicly installable upgrade must use a
strictly larger integer.
`versionName` remains human-readable and may use the existing Metrora
pre-release convention.

Android version identity is not coupled to the Windows Store package version.

## Production signing boundary

The existing QA signing path remains separate and is not reused:

- QA signing is still controlled by `METRORA_QA_SIGNING_ENABLED` and applies
  only to `githubDebug` for physical acceptance;
- the public path is controlled by `METRORA_PRODUCTION_RELEASE=true` and
  configures only `githubRelease`;
- enabling QA and production signing together fails closed;
- debug signing never signs the public APK;
- no keystore is committed;
- production passwords and key material are never printed;
- a production release fails before assembly when any required signing value is
  absent;
- ordinary pull-request validation builds do not require private signing
  secrets.

The trusted release workflow uses these secret names only as transport
identifiers; their values belong in a protected GitHub environment and are not
documented here:

- `METRORA_ANDROID_PRODUCTION_KEYSTORE_B64`;
- `METRORA_ANDROID_PRODUCTION_STORE_PASSWORD`;
- `METRORA_ANDROID_PRODUCTION_KEY_PASSWORD`;
- `METRORA_ANDROID_PRODUCTION_KEY_ALIAS`.

The non-secret expected certificate fingerprint is supplied as the protected
environment/repository variable
`METRORA_ANDROID_PRODUCTION_CERTIFICATE_SHA256`. The workflow fails closed if
it is missing and the verifier compares the APK certificate with it.

The Play candidate path uses a separate upload-key namespace and never reuses
the direct-APK production key as an upload key:

- `METRORA_ANDROID_PLAY_UPLOAD_KEYSTORE_B64`;
- `METRORA_ANDROID_PLAY_UPLOAD_STORE_PASSWORD`;
- `METRORA_ANDROID_PLAY_UPLOAD_KEY_PASSWORD`;
- `METRORA_ANDROID_PLAY_UPLOAD_KEY_ALIAS`.

The existing production certificate remains the intended Android app-signing
identity across the direct APK and Google Play channels through Google's
supported Play App Signing enrollment flow. The distinct Play upload key only
authorizes future AAB uploads. Neither key bytes nor passwords are repository,
issue, PR, log or artifact content.

The keystore is decoded only into the trusted runner's temporary directory and
used inside one protected signing/build step. Signing credentials are scoped
to that step, are not written to `GITHUB_ENV`, and are unset immediately after
the signed APK is assembled. A shell trap and a following `always()` cleanup
step remove the JKS even when signing fails. Metadata verification, artifact
upload and optional draft-release preparation receive only the public
certificate fingerprint and release outputs; they do not receive passwords,
the key alias or private keystore material. The workflow has no push trigger
and cannot publish a release from a push to `main`. Its optional draft-release
job requires an existing tag already bound to the exact source commit and uses
`--draft --verify-tag`; it never creates a tag and never makes a public release.

## Key custody and recovery gate

The production signing key is a Founder-owned gate, not a repository asset.
Before a public release, the owner must complete these external operational
steps:

1. Generate one long-lived Android production signing identity in a JKS
   keystore on a trusted, offline-controlled workstation. Use a stable
   production alias; do not reuse the debug or QA identity.
2. Keep the original keystore and passwords in long-term protected custody,
   with at least one separately protected offline backup and a tested recovery
   procedure. Do not place either in Git, issues, pull requests, workflow
   output or public release metadata.
3. Record the public certificate SHA-256 fingerprint and stable alias in the
   private owner/release record, then configure the protected workflow secret
   names and non-secret fingerprint variable.
4. Preserve alias and certificate continuity for every direct APK upgrade.
   Verify the production-signed candidate on the physical device before
   publication.

If the key is lost, existing direct APK installations cannot accept a normal
upgrade signed by a replacement identity. Recovery requires the original key;
otherwise the owner must make an explicit migration decision, which may require
a new application identity and a reinstall rather than a silent replacement.
The same application ID/versionCode line is required for a later Play path, but
Play's app-signing/upload-key enrollment and migration rules are a separate
Founder-gated decision. This public repository does not provision or recover
the production key.

## Source-bound release workflow

`.github/workflows/android-public-release.yml` is manual-only and is allowed to
run only when dispatched from `main`. The operator supplies a full source
commit. The workflow:

1. checks out that exact commit and verifies it is an ancestor of `origin/main`;
2. sets up Java 17, Gradle 9.6.1 and Android API 36;
3. runs focused Android tests and lint before production secrets are scoped;
4. materializes and validates the production JKS only inside the protected
   signing/build step;
5. requires the production signing Gradle path and assembles `githubRelease`;
6. removes the temporary JKS and unsets signing credentials immediately after
   assembly, including failure paths;
7. verifies package identity, version, signature and certificate;
8. writes the canonical APK name, manifest and `SHA256SUMS`;
9. independently re-verifies the complete release bundle;
10. uploads a short-lived workflow candidate artifact; and
11. keeps signing passwords, alias and private keystore material out of all
    later verification, summary and draft-release steps.

The optional draft preparation step is explicitly requested, requires an
existing `android-v<versionName>` tag bound to the same commit, and creates a
draft GitHub Release only. Final publication remains a separate Founder
action after production-signed physical acceptance.

`.github/workflows/android-play-candidate.yml` is a separate manual-only path.
It also requires a full source commit dispatched from `main`, verifies that
the commit is reachable from current `origin/main`, runs Android tests and
lint before secrets are scoped, materializes the dedicated Play upload JKS
only for `playRelease`, removes it on every exit path, and independently
verifies the signed AAB, package, version, upload certificate, source SHA and
SHA-256 evidence. It uploads only a short-lived candidate artifact and has no
Google Play upload or production-submission step.

## Verification procedure

The deterministic verifier is
`scripts/verify-android-release.mjs`. A trusted release invocation supplies
the Android SDK `aapt2` and `apksigner` paths, the exact source commit, the
expected source version and the recorded production certificate fingerprint.

It verifies:

- `aapt2` package name, `versionName` and `versionCode`;
- `apksigner` verification and exactly one signing certificate;
- expected production certificate SHA-256;
- canonical filename and manifest shape;
- artifact and manifest SHA-256 values;
- exact `SHA256SUMS` membership;
- exact source commit binding.

The verifier has Node tests in
`scripts/verify-android-release.node-test.mjs`. It is intentionally a small
release-boundary tool rather than a new release framework. The direct APK path
uses `aapt2`/`apksigner`. The separate small Play candidate verifier in
`scripts/verify-android-play-candidate.mjs` reuses the same manifest/checksum
primitives and uses `bundletool`, `jarsigner` and `keytool` to verify the AAB
manifest and upload certificate.

## Obtainium compatibility

Obtainium should track the Metrora GitHub repository's Releases page using the
stable `android-v<versionName>` release identity and select the single
`Metrora-Android-<versionName>.apk` asset. The APK asset semantics do not
change between releases, and the manifest/checksum assets remain available for
independent inspection. No Metrora-hosted updater backend or in-app updater is
required for this channel.

Direct APK installation and update are for users who intentionally choose the
technical/early channel. A GitHub release is not a Google Play publication and
does not imply Play review or certification.

## Brand token normalization

The public brand authority is Graphite + Signal Cyan from
`assets/brand/README.md`. Android's product-facing primary token now uses:

- Signal Cyan: `#00D4FF` (was `#0BD5F4`);
- Signal Cyan Deep: `#007A99`;
- Signal Cyan Soft: `#E6F9FD`.

The old Android `cyanSoft` value was a dark-surface muted accent and was not
semantically the public Soft token. It is clarified as `signalCyanDeep` rather
than being silently mapped to a pale fill. The accepted UX structure, density,
typography, layout, official assets, provider/model logos and semantic
success/warning colors are unchanged.

## Physical visual regression plan

The primary color change is small and does not require a complete UX V2
acceptance rerun. After the production key gate is satisfied, run a minimal
S23-class visual comparison against the final production-signed APK:

| Surface | Check |
| --- | --- |
| Connect / pairing | Primary CTA, QR framing accent, approval and success states remain legible and structurally unchanged |
| Home | Chart line/fill, active navigation and active controls use Signal Cyan without layout or density drift |
| Activity | Selection, filters and active control accents remain visible against Graphite surfaces |
| Analyze | Models/Spend selection and emphasis preserve provider/model semantics and contrast |
| Settings | Selected/accent state, device controls and security affordances remain clear |

Record only the physical acceptance result and release facts in the private
owner/release evidence. Do not commit personal S23 screenshots as marketing
evidence.

## Production-release functional smoke

Because `githubRelease` enables minification and resource shrinking, the final
production-signed APK needs one bounded S23-class functional smoke in addition
to the visual matrix above. Use a clean install of the exact
production-signed `eu.metrora.app` APK and verify:

1. launch completes without a startup failure;
2. real QR pairing completes and SAS/Desktop approval succeeds;
3. Home loads and refreshes real data;
4. Activity opens and renders real sessions;
5. Analyze opens and renders accepted factual data;
6. Settings opens and device/security state remains functional;
7. the QR scanner remains functional; and
8. one bounded offline-to-reconnect check completes without breaking the
   local-first state.

This is a production-variant smoke, not a repeat of the complete UX V2
acceptance matrix. Record only the result and release facts in private owner
evidence; do not commit personal screenshots publicly.

## F-Droid characterization

The existing `fdroidRelease` build remains intact, but it is not declared
F-Droid-ready by this milestone. The current Android dependency surface
includes Compose, CameraX, DataStore, coroutines and
ZXing Core. A separate F-Droid tranche must review:

- dependency licenses and complete transitive notices;
- scanner/ZXing availability, repository policy and offline/reproducible build
  behavior;
- metadata, build reproducibility and network/privacy declarations.

The GitHub and Play product paths must not be weakened or made less secure to
avoid these separate compliance questions.

## Google Play boundary

The current direct-install authority remains the published alpha.3 APK and
`versionCode = 3`. Alpha.4 (`versionCode = 4`) is the current Play candidate
line only; it is not a published Google Play release.

The Play candidate uses the same `eu.metrora.app` package and monotonic
versionCode sequence. The existing production app-signing certificate is the
intended cross-store identity and must be supplied to Play App Signing through
the supported enrollment path. A distinct Play upload key signs candidate
AABs. The two identities are deliberately separate concepts, and the
repository does not provision either private key.

The candidate verifier records the exact source SHA, package, version,
upload-certificate verification and AAB SHA-256 in a reviewable artifact. The
Founder must complete Play App Signing enrollment, review the candidate and
make the final Play submission decision. This tranche does not upload to Play,
submit to production, create a tag or claim Google Play availability.

The Android Settings / Privacy surface links to the canonical policy at
`https://metrora.eu/privacy`, which must remain live before any Store listing
or submission.

## Google Play Data Safety evidence map

**Evidence snapshot:** `origin/main` at
`8db16e19a898366647aa6088a07fa32a08db73b4` (refreshed 29 August 2026).
This is a source-backed preparation map, not a Play Console declaration. It
describes the Android app's current behavior; the Founder must still map the
final signed AAB to the exact Play Console questions and review any SDK or
platform disclosures required at submission time.

In this table, "third party" means an intended external recipient or
data-collecting SDK, not an ordinary open-source library linked into the app.
The paired Desktop is the endpoint explicitly selected and approved by the
user; it is not a Metrora cloud relay.

| Data type | Collected/accessed? | Local/transmitted? | Purpose | Third party? | Retention | User control | Source evidence |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Camera frames and selected QR image | Accessed only after the user chooses QR scanning or image import. | Processed locally to extract one bounded QR value. The scanner path does not persist or upload raw frames/images. | Discover the paired Desktop endpoint. | No intended recipient or analytics/advertising SDK. | Transient for the scan/decode operation. | Deny or revoke `CAMERA`, cancel scanning, go back, or choose not to import an image. | `AndroidManifest.xml`, `QrScanner.kt`, `QrImageDecoder.kt`, `QrCodeDecoder.kt` |
| Pairing and connection metadata | Accessed/generated during pairing: user-selected host/port, Desktop name, server/client certificate fingerprints and pairing time. | Stored in the encrypted local store; connection metadata is used for TLS discovery, pairing and later requests to the selected Desktop. | Bind the phone to one Desktop identity and scope authenticated requests. | Sent only to the explicitly paired Desktop endpoint; no Metrora cloud endpoint is implemented. | Remains until the pairing is replaced or local pairing cleanup runs; no cloud retention period exists in the Android flow. | Pair only after the SAS code is compared and confirmed; use `Revoke access on Desktop` or `Forget on this phone`; uninstall also removes app-local state subject to Android behavior. | `PairingBootstrap.kt`, `MetroraApiClient.kt`, `TlsMetroraTransport.kt`, `PairingCredentials.kt`, `MetroraCoordinator.kt` |
| Metrora account/profile data | No Android account-creation, email, phone, contacts or provider-login flow is present; the companion pairs to a Desktop instead. | No Metrora account data is transmitted or stored by this flow. Desktop name and device identity remain covered by the connection/credential rows above. | Avoid a cloud account while enabling the paired companion. | No Metrora identity service or social/advertising provider is configured. | Not applicable to an account; paired local state follows the cleanup behavior above. | No account deletion flow is required; forget/revoke the pairing or uninstall the app. | `MetroraFirstRun.kt`, `MetroraApiClient.kt`, `AndroidManifest.xml`, `strings.xml` |
| Pairing credential and device key material | The Desktop returns a pairing token; the phone creates its client identity. The private key stays in Android Keystore. | The token is encrypted in local DataStore and sent in authenticated TLS requests to the paired Desktop. The private key is not serialized or sent as application data. | Authenticate the paired phone and protect the Desktop API. | No Metrora service or telemetry recipient; the paired Desktop is the intended peer. | Until revoke/forget/uninstall or replacement by a new pairing. | Revoke remotely with Desktop confirmation or forget locally; the app does not expose a credential export action. | `PairingCredentials.kt`, `SecureStore.kt`, `EncryptedStateCodec.kt`, `DeviceIdentity.kt`, `MetroraApiClient.kt` |
| Usage, cost, model, Project, Capacity and Activity projections | Received from the paired Desktop when the user refreshes or opens supported surfaces. The Android app does not collect provider data independently. | Received and cached locally in encrypted bounded snapshots; refresh queries and filters are sent to the paired Desktop over TLS. Ordinary projections exclude prompts, responses, source files, patches, raw tool arguments and raw tool output. | Render the read-focused companion surfaces. | No Metrora cloud relay, ad network or behavioral analytics path. The paired Desktop is the intended data source/peer. | Latest compatible projections remain locally cached until overwritten or pairing cleanup; there is no time-based Android retention promise. | Refresh, use the explicit revoke/forget controls, or uninstall. | `UsageSnapshot.kt`, `MobileFoundationSnapshot.kt`, `CapacitySnapshot.kt`, `ActivitySnapshot.kt`, `ProjectCatalogSnapshot.kt`, `MetroraApiClient.kt`, `SecureStore.kt` |
| Network and transport metadata | Accessed to connect to the endpoint supplied by the user/QR and to build bounded period, Project and Activity requests. | Transport is HTTPS/TLS with certificate-date and Desktop-fingerprint checks; cleartext traffic is disabled. | Secure local Desktop pairing and data refresh. | The app has no configured Metrora relay or remote collection service. | Connection values are part of local pairing state until cleanup; transport response bodies are bounded and used for the current operation/cache. | User chooses whether to pair, can cancel, revoke or forget. | `AndroidManifest.xml`, `network_security_config.xml`, `Protocol.kt`, `TlsMetroraTransport.kt` |
| Demo Mode data | Built-in synthetic data is created locally; no real Desktop, account or pairing state is accessed. | Ephemeral in memory and Activity lifecycle state only; no network request and no write to the normal encrypted real-data caches. | Product exploration and reproducible screenshots/visual QA. | None. | Until the Demo session exits or the Activity lifecycle ends; it is not product evidence. | `Exit demo` returns to the unpaired state; normal paired data remains authoritative. | `MetroraDemoDatasetV1.kt`, `MetroraDemoLaunchSpec.kt`, `MetroraCoordinator.kt`, `MainActivity.kt`, `ANDROID_DEMO_MODE_V1.md` |
| Advertising, behavioral analytics and crash/telemetry data | No Android source or declared dependency currently implements these flows. | No current transmission or local store is defined for them. | Not applicable to the current companion. | No advertising or behavioral-analytics SDK is declared. | Not applicable. | No analytics opt-out is substituted for a feature that does not exist; revisit this map if dependencies or telemetry change. | `android/app/build.gradle.kts`, `android/gradle/libs.versions.toml`, source-wide dependency audit |
| Android backup/device-transfer copy of app state | The app opts out of backup/device-transfer domains for its private state. | No configured cloud/device-transfer copy of the app's local pairing or product caches. | Keep credentials and cached projections on the originating device. | Android platform behavior remains an external platform boundary; no Metrora backup service is configured. | Local app retention only, subject to Android uninstall/storage behavior. | Revoke/forget locally; uninstall. | `backup_rules.xml`, `data_extraction_rules.xml`, `SecureStore.kt` |

The map intentionally does not infer retention or collection behavior for the
user's paired Desktop, provider accounts, operating system logs, or future Play
services. Those are separate authorities and must not be converted into
claims about the current Android artifact without evidence.

## Demo screenshot reproducibility

The existing Demo Mode can launch each relevant shipped surface from a clean
unpaired install. Use a fixed date and the same dataset version for every
capture. The debug application ID is `eu.metrora.app.debug`; a release or Play
candidate uses `eu.metrora.app`.

For a real installed debug build, replace `PACKAGE` with the debug ID below;
for a release/Play artifact, use `eu.metrora.app` instead:

```text
adb shell am force-stop PACKAGE
adb shell am start -n PACKAGE/eu.metrora.app.MainActivity --ez metrora.demo true --es metrora.demo.dataset v1 --es metrora.demo.now 2026-08-29 --es metrora.demo.destination home
```

Replace `home` with `activity`, `analyze`, `workspace` or `settings` to open
the corresponding surface. The launch hint is one-shot and is honored only
when the real local store is empty; a paired or cached real state remains
authoritative. Capture screenshots from the actual running artifact only.
Do not fabricate screens or commit personal-device screenshots as public
marketing evidence.

## Security and privacy regression boundary

The distribution work does not change Android runtime authority or data
boundaries. The existing implementation and tests remain responsible for:

- QR pairing, SAS/Desktop approval, mutual TLS and certificate pinning;
- Android Keystore client identity and encrypted local caches;
- direct local-first behavior and explicit revoke/forget/re-pair controls;
- prompt, response, source code, patch, secret, tool-argument and unrestricted
  path exclusion from Android projections;
- Desktop/core authority for collection, pricing, accounting, history,
  Workspace and evidence semantics.

This milestone adds no account, telemetry, remote service, hosted updater or
infrastructure.

## Founder release checklist

The alpha.3 release completed the following Founder-owned gates. The same
controls remain required before any future direct release changes from
candidate to public:

- production key exists in protected custody and recovery has been checked;
- the protected workflow environment contains the required signing values;
- the recorded certificate fingerprint matches the production key;
- the exact source commit and version are approved;
- the production-signed APK passes the verifier;
- the S23-class physical regression matrix passes;
- the GitHub Release tag is created intentionally and points to the approved
  source commit;
- release notes, checksum and manifest are reviewed;
- only then is a future draft eligible for explicit public publication.

The accepted alpha.3 artifact is the current public Android release.
The historical alpha.2 candidate remains failed and unpublished, and the
immutable alpha.1 artifact remains historical public-release evidence.
