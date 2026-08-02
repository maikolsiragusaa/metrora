# Windows upgrade, repair, and rollback v1

**Status:** public R1.B.C.A contract for unsigned Windows lifecycle validation

## Purpose

R1.B.C.A proves that a Metrora per-user Windows installation can move between a real earlier source baseline and the current candidate without losing user-owned local state or creating ambiguous application authority.

This is release-engineering validation. It is not a public release, code-signing claim, automatic updater, hosted service, or guarantee that every future schema downgrade is safe.

## Authorities

The lifecycle has two deliberately different authorities.

### Current candidate

The current candidate is built once by the normal Windows candidate job.

Its version is read from the current `app/package.json`. It is not duplicated or hardcoded in the migration workflow.

The canonical current payload remains `app/release/win-unpacked`, and the installer and portable formats continue to derive from it under the R1.A and R1.B.A contracts.

### Historical baseline fixture

The historical source baseline is pinned to commit:

```text
169992beef06f1f4cddc5dba6bce3b8991ce9fd4
```

That commit represents the first Signal Grid main with the accepted local Workspace, before the Windows release-pipeline hardening.

CI checks out the commit into an isolated directory and changes only the root and desktop package versions to the test fixture version `0.9.18`.

The fixture version exists only to exercise NSIS upgrade ordering against the current `0.9.19` candidate. It is not a claim that `0.9.18` was publicly distributed.

The fixture preparation fails if:

- any package has an unexpected name;
- root and desktop source versions disagree;
- a package-lock root disagrees with its package version;
- the requested fixture version is not strict semantic versioning.

## Normal lifecycle

The same disposable per-user installation directory is used for these transitions:

1. install the historical baseline;
2. verify and launch the historical baseline;
3. upgrade in place to the current candidate;
4. verify and launch the current candidate;
5. reinstall the current candidate as a repair/idempotency check;
6. uninstall the current candidate before rollback;
7. verify application registration and shortcuts are absent while user state remains;
8. install the historical baseline as the rollback target;
9. verify and launch the historical baseline;
10. upgrade again to the current candidate;
11. verify and launch the current candidate;
12. uninstall the current candidate cleanly.

A rollback is therefore **not** an unsupported older installer written directly over a newer installation. It is an explicit removal of application files followed by installation of the selected rollback payload.

## Installed application verification

Every installed stage must pass the same shared assertions used by clean-install acceptance:

- every canonical payload file exists with identical path, size, and SHA-256;
- only the declared NSIS additions are accepted;
- executable `ProductName` and description are Metrora;
- executable file version matches the expected stage;
- compatibility CLI version matches the expected stage;
- exactly one logical uninstall registration exists in HKCU;
- registration display name, display version, publisher, and uninstaller are canonical;
- a Start Menu shortcut targets the installed executable;
- bounded Electron launch remains alive until controlled termination.

Windows may expose the same physical HKCU uninstall key through registry views 32 and 64. The test deduplicates only entries with the same hive, key name, uninstall command, and quiet uninstall command. Distinct registrations remain a failure.

## User-owned state preservation

Before the first install, CI creates a sentinel inside the disposable equivalent of:

```text
%APPDATA%\metrora-desktop\metrora-local-state
```

Its SHA-256 is checked after every stage:

- baseline installation and launch;
- upgrade and launch;
- current-version reinstall;
- pre-rollback uninstall;
- rollback installation and launch;
- re-upgrade and launch;
- final uninstall.

No stage may delete or modify the sentinel.

The acceptance script does not reset, recreate, migrate, inspect, export, or upload Workspace evidence. It proves preservation of user-owned local state across installer lifecycle operations.

## Build isolation

The historical checkout is built in a dedicated subdirectory. It is not uploaded as a current candidate and cannot replace the current manifest authority.

The current candidate is not rebuilt for migration testing. The lifecycle test consumes the same payload and installer already produced by the Windows candidate job.

Historical and current NSIS packaging each use an isolated copy of their corresponding unpacked payload so packager-specific additions cannot mutate canonical product bytes.

## Failure model

The gate fails on:

- baseline source or fixture inconsistency;
- candidate version not newer than the fixture baseline;
- build or installer failure;
- payload drift at any installed stage;
- ambiguous registry authority;
- wrong product, CLI, or executable version;
- missing or incorrect shortcut;
- early Electron exit;
- failed application removal before rollback;
- failed final uninstall;
- deleted or modified user-owned state.

Failure cleanup may attempt to uninstall the disposable application. It must never target a real user installation or real user state.

## What R1.B.C.A does not prove

This contract does not yet prove:

- interruption during installer replacement;
- process termination during upgrade;
- power-loss recovery;
- automatic updater behavior;
- rollback of incompatible future data schemas;
- publisher authenticity or SmartScreen reputation.

Controlled interruption and deterministic recovery remain R1.B.C.B. Signing, publication, and update-channel authenticity remain later release milestones.

## Evolution

The historical commit and fixture version are compatibility fixtures. Replacing either requires a reviewed contract change and evidence that the new fixture still represents a meaningful older product boundary.

Shared lifecycle assertions must remain focused modules. New migration behavior must not be added to product GOD FILES or hidden inside an unreviewable workflow script.
