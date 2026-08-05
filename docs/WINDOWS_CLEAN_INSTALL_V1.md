# Windows clean install and uninstall v1

**Status:** implemented CI contract for unsigned NSIS installation validation.

This contract proves that the NSIS candidate can be installed, launched and removed in a disposable Windows environment without changing canonical product bytes or deleting user-owned local state.

It is release-engineering validation. It is not code signing, publication, updater activation or a claim that Windows trusts the installer publisher.

## Installer policy

The current installer is:

- NSIS x64;
- per-user;
- assisted rather than one-click;
- unsigned;
- configured with application-data deletion disabled.

CI uses a disposable installation directory and isolated roaming/local application-data roots.

## Installed layout

Every canonical product file from the unpacked payload must exist in the installed directory with the same path, size and SHA-256.

The only accepted installed-format additions are:

- `Uninstall Metrora.exe`;
- `resources/elevate.exe`.

Changed, missing, empty or undeclared files fail validation.

## Identity checks

The installed candidate must expose:

- product name `Metrora`;
- file description containing `Metrora`;
- one logical per-user uninstall registration under HKCU;
- versioned Metrora display name;
- publisher display `Vensent`;
- an uninstall command targeting the local uninstaller;
- a canonical Start Menu shortcut targeting `Metrora.exe`.

The application ID remains `eu.metrora.desktop`.

Historical acceptance reports remain bound to the identity present in their original source and artifact. A later official candidate must pass the current identity contract again.

## Runtime smoke checks

The installed candidate must pass:

1. bundled compatibility CLI version execution;
2. bounded Electron launch without early failure.

The smoke test does not produce Workspace evidence, export data or publish over a network.

## User-owned state preservation

Before installation, CI creates a sentinel in the disposable equivalent of the Metrora local-state directory.

Installation, first launch and uninstall must preserve it byte-for-byte.

Successful uninstall removes application files, registration and shortcuts while leaving user-owned local state intact.

## Failure model

Validation fails on:

- installer or uninstaller failure;
- missing executable or uninstaller;
- installed payload drift;
- incorrect product or publisher identity;
- missing, duplicated or inconsistent registration;
- registration outside the per-user boundary;
- missing or incorrect shortcut;
- CLI or bounded launch failure;
- residual application authority after uninstall;
- deletion or mutation of user-owned state.

No failure path is allowed to reset real user data.

## Scope

This isolated contract proves clean installation, first launch and removal for the candidate under test.

The Windows candidate workflow separately validates:

- same-version reinstall and repair;
- historical upgrade, rollback and re-upgrade;
- controlled interruption and deterministic recovery;
- independent candidate verification.

Physical-machine UX, Store identity, publisher authenticity and official publication remain separate acceptance boundaries.

## Evolution

Any change to installed extras, uninstall data policy, identity rules or smoke behavior requires an explicit contract update. Tests must not silently broaden their allowlists to make a new installer pass.
