# Windows Store local package test

This guide documents the physical-Windows test used for Store candidates. It is a procedure for candidate acceptance and does not authorize changing a submitted artifact or making certification, publication or availability claims.

It does not imitate Microsoft certification. The submission candidate remains unsigned and unchanged. A separate copy is signed with a temporary test certificate only so Windows can install it locally.

## Scope

The local test verifies:

- the downloaded artifact is bound to the expected source commit;
- the AppX manifest matches the reviewed package configuration;
- the candidate carries an importable companion runtime at `app/resources/cli.asar/dist/desktop-share-runtime.js`;
- the package installs for the current Windows user;
- Metrora launches with the expected product presentation;
- the production Android `0.1.0-alpha.3` APK can complete the bounded companion flow;
- local collection works without a separately installed Node.js runtime;
- the package, trusted certificate and private key are removed afterward;
- the final report contains no local paths, usernames, package identity values, keys or certificates.

It does not verify Store signing, certification, publication, Store-managed
updates or a package flight. The automated workflow's companion smoke is
import-only and never starts a listener, creates pairing state or claims a
physical Android pairing.

## Prerequisites

Use a dedicated Windows x64 test user with:

- an elevated PowerShell session;
- a clean checkout at the exact accepted source commit;
- the complete `metrora-windows-store-<commit>.zip` artifact from the matching workflow run;
- Windows SDK SignTool installed;
- no package with the Metrora Store identity already installed for that user;
- every running Metrora process closed.

Do not use this path on a profile that already has a real Store-delivered Metrora package.

## Prepare and launch

From elevated PowerShell in the repository root:

```powershell
./scripts/Prepare-Metrora-Windows-Store-Local-Test.ps1 `
  -ArtifactArchive 'C:\path\to\metrora-windows-store-<commit>.zip' `
  -ExpectedCommit '<full-commit>' `
  -OutputDirectory 'C:\Metrora-Store-Local-Test'
```

The script:

1. requires a clean repository at the exact expected commit;
2. preserves and hashes the downloaded artifact;
3. performs bounded extraction;
4. verifies the workflow manifest and exact package configuration;
5. rejects an already installed package with the same identity;
6. creates a seven-day local test certificate with its private key in the current-user personal store;
7. signs only a copied package;
8. trusts only the public certificate in the machine TrustedPeople store;
9. installs and launches the copied package;
10. writes a local cleanup context.

Temporary PFX and CER files are deleted before the script exits. The trusted public certificate and current-user private key remain only until completion so the installed test package can run.

## Manual observations

In the launched app, confirm every observation below with the current production
Android APK published as `android-v0.1.0-alpha.3`:

1. Metrora launches normally.
2. Windows and the app present the expected product identity.
3. The Connect phone surface opens.
4. The production Android APK scans the displayed QR.
5. The SAS shown by both sides matches.
6. Desktop explicit approval succeeds.
7. Android Home receives real data.
8. Activity receives real sessions.
9. Analyze receives accepted factual data.
10. Settings/device/security state remains coherent.
11. Disconnect/offline followed by reconnect works.
12. At least one supported local provider can be collected when test data exists.
13. The packaged app works without a separately installed Node.js runtime.

Record only `pass` or `fail`; do not enter prompts, responses, usernames,
filesystem paths, local IP addresses, account data, pairing certificates,
private keys, bearer tokens, SAS values, device secrets or other private
material into the report. Omitting a companion observation defaults the report
to FAIL, so a PASS cannot hide an unperformed step.

## Complete and clean up

From the same elevated PowerShell session, record each observation as `pass` or `fail`:

```powershell
./scripts/Complete-Metrora-Windows-Store-Local-Test.ps1 `
  -AcceptanceDirectory 'C:\Metrora-Store-Local-Test' `
  -Launch pass `
  -IdentityPresentation pass `
  -ConnectPhoneSurface pass `
  -ProductionAndroidQrScan pass `
  -SasMatch pass `
  -DesktopApproval pass `
  -AndroidHomeData pass `
  -AndroidActivitySessions pass `
  -AndroidAnalyzeFacts pass `
  -SettingsDeviceSecurity pass `
  -DisconnectReconnect pass `
  -LocalCollection pass `
  -NoExternalNode pass
```

Completion removes:

- the installed local test package;
- the trusted public certificate from the machine store;
- the certificate and private key from the current-user personal store;
- the test-signed package and local identity context.

It preserves:

```text
METRORA-WINDOWS-STORE-LOCAL-TEST.json
```

A failed observation still triggers cleanup and produces a sanitized FAIL report. It must not be reinterpreted as a PASS.

When cleanup is incomplete, the local context is deliberately preserved. Do not delete the acceptance directory until the package, trusted certificate and private key have all been removed.

## Boundaries

A passing local report is one submission input only. It does not authorize:

- uploading or submitting a package;
- Microsoft Store certification or publication claims;
- stable `1.0.0`;
- website changes;
- replacement of the existing portable or NSIS channels;
- claims about Store-managed update behavior.

The RC10-to-RC11 update/profile-preservation sequence is deliberately deferred
to a separate Founder-run controlled test profile. No automation in this path
installs over the real Store package or claims Microsoft Store-managed update
certification. The machine-verifiable candidate ordering check is covered by
the version authority and Store identity tests.

Submission, certification, publication and availability remain separate gates; this guide does not authorize a publication action or a Store-availability claim.

## Deferred controlled update acceptance

**Status: STOPPED/DEFERRED — Founder-run physical step, not automated.**

The safe update test must use a dedicated Windows test profile and never the
real Store-installed Metrora package:

1. Prepare a frozen RC10-equivalent baseline package with Store identity
   version `1.0.0.0` and the same temporary local-test signing identity that
   will be used for the candidate.
2. Prepare the RC11 candidate with Store identity version `1.0.1.0`; verify
   both packages are test-signed copies and neither is Microsoft Store-signed.
3. Install the baseline, create only bounded user-owned test state, and record
   sanitized pre-update status for endpoint identity, Workspace state, a
   user-owned file, and companion-state coherence.
4. Install the candidate as the version increase and verify endpoint identity,
   Workspace state, the user-owned file, fail-safe/coherent companion state,
   launch, and local collection.
5. Exercise the candidate's disconnect/offline -> reconnect path, then remove
   the candidate, baseline, temporary certificate, private key and all test
   state.
6. Preserve only a sanitized PASS/FAIL record containing package versions,
   source/digest references and boolean observations. Do not record usernames,
   paths, addresses, certificates, keys, tokens, SAS values or private data.

This is deferred because the repository's current local Store tooling is
designed for clean install/launch acceptance and does not provide a reliable,
isolated same-certificate upgrade harness. Building a fragile updater or
running a test-signed AppX over the real Store installation would risk the
published package. The version authority and identity tests prove only that
`1.0.1.0` is greater than the frozen `1.0.0.0` baseline; they do not claim
Microsoft Store-managed update certification.
