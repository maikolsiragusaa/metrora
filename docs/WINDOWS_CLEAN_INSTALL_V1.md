# Windows clean install and uninstall v1

**Status:** public R1.B.B contract for unsigned NSIS validation

## Purpose

R1.B.B proves that the unsigned NSIS candidate produced by R1.B.A can be installed and removed in a disposable Windows environment without changing Metrora product bytes or deleting user-owned local state.

This is release engineering validation. It is not code signing, publication, updater activation or a claim that the installer is trusted by Windows.

## Installer policy

The current Windows installer is:

- NSIS x64;
- per-user (`perMachine: false`);
- assisted (`oneClick: false`);
- unsigned;
- configured explicitly with `deleteAppDataOnUninstall: false`.

Silent test execution uses the NSIS `/S` option. The disposable installation directory is supplied as the final `/D=<path>` argument.

## Disposable boundary

The CI test uses a unique directory below the Windows runner temporary root for:

- installed application files;
- temporary roaming application data;
- temporary local application data;
- a user-owned local-state sentinel.

The installation directory contains no spaces so the NSIS `/D` argument can remain final and unquoted.

The test restores the original environment and removes its temporary files after verification. It does not inspect or export user content.

## Installed layout

Every canonical product file from `win-unpacked` must exist in the installed application directory with the same path, size and SHA-256.

The only accepted installed-format additions are:

- `Uninstall Metrora.exe`;
- `resources/elevate.exe`.

A changed canonical file, missing canonical file, empty format-specific file or any undeclared extra file fails the gate.

## Identity checks

The installed candidate must expose:

- executable `ProductName` equal to `Metrora`;
- executable file description containing `Metrora`;
- one per-user Windows uninstall entry named `Metrora`;
- an uninstall command targeting `Uninstall Metrora.exe`;
- at least one Start Menu shortcut named `Metrora.lnk` targeting the installed `Metrora.exe`.

The public `appId` remains `eu.metrora.desktop` and is already bound by the R1.A/R1.B.A source and manifest checks.

## Runtime smoke checks

The installed candidate must pass both:

1. installed compatibility CLI `--version` execution;
2. installed Electron application launch, remaining alive for a bounded smoke window before controlled termination.

The launch test does not perform Workspace production, evidence export or network publication.

## User-owned state preservation

Before installation, CI creates a sentinel inside the disposable equivalent of:

```text
%APPDATA%\metrora-desktop\metrora-local-state
```

The sentinel digest is recorded locally for the duration of the test.

The following operations must preserve the sentinel byte-for-byte:

- silent installation;
- first application launch;
- silent uninstall.

Uninstall must remove the application executable, uninstall registry entry and Metrora Start Menu shortcut while leaving the user-owned state sentinel unchanged.

## Failure model

The gate fails on:

- installer non-zero exit;
- missing executable or uninstaller;
- installed payload drift;
- incorrect product identity;
- missing or inconsistent uninstall metadata;
- missing canonical shortcut;
- CLI failure;
- early Electron exit;
- uninstall non-zero exit;
- residual installed executable, registry entry or shortcut;
- deletion or mutation of user-owned local state.

No failure path is allowed to reset or delete real user state.

## What R1.B.B does not prove

R1.B.B does not yet prove:

- upgrade from an earlier candidate;
- interrupted upgrade recovery;
- repair/reinstall behavior;
- rollback compatibility;
- physical-machine SmartScreen behavior;
- publisher authenticity;
- update-channel authenticity.

Those remain R1.B.C, R1.B.D and later signing work.

## Evolution

Any change to accepted installed extras, uninstall data policy, identity rules or smoke behavior requires an explicit contract update. The test must not silently broaden its allowlist to make a new installer pass.
