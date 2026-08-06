# Windows Store local package test

This guide validates the current AppX candidate on physical Windows before any Partner Center submission.

It does not imitate Microsoft certification. The submission candidate remains unsigned and unchanged. A separate copy is signed with a temporary test certificate only so Windows can install it locally.

## Scope

The local test verifies:

- the downloaded artifact is bound to the expected source commit;
- the AppX manifest matches the reviewed package configuration;
- the package installs for the current Windows user;
- Metrora launches with the expected product presentation;
- local collection works without a separately installed Node.js runtime;
- the package, trusted certificate and private key are removed afterward;
- the final report contains no local paths, usernames, package identity values, keys or certificates.

It does not verify Store signing, certification, publication, Store-managed updates or a package flight.

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

In the launched app, confirm all four observations:

1. Metrora launches normally.
2. Windows and the app present the expected product identity.
3. At least one supported local provider can be collected when test data exists.
4. The packaged app works without a separately installed Node.js runtime.

Do not enter prompts, keys, account data or other private material into the report.

## Complete and clean up

From the same elevated PowerShell session, record each observation as `pass` or `fail`:

```powershell
./scripts/Complete-Metrora-Windows-Store-Local-Test.ps1 `
  -AcceptanceDirectory 'C:\Metrora-Store-Local-Test' `
  -Launch pass `
  -IdentityPresentation pass `
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

A passing local report is one pre-submission input only. It does not authorize:

- uploading or submitting a package;
- Microsoft Store certification or publication claims;
- stable `1.0.0`;
- website changes;
- replacement of the existing portable or NSIS channels;
- claims about Store-managed update behavior.

Store submission and any later publication remain separate decisions.
