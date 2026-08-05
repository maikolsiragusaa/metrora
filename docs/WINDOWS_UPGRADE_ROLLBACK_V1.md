# Windows upgrade, repair and rollback v1

**Status:** public unsigned Windows lifecycle-validation contract

## Purpose

This contract proves that a disposable per-user Windows installation can move between a declared earlier source baseline and the current candidate without losing user-owned local state or creating ambiguous application authority.

It is release-engineering validation. It is not a public release, signing claim, automatic updater or guarantee that every future schema downgrade is safe.

## Authorities

### Current candidate

The current candidate is built once by the ordinary Windows candidate workflow.

Its version is read from the current `app/package.json`. The canonical current payload remains `app/release/win-unpacked`, and installer and portable formats derive from it under the accepted source and format contracts.

### Historical compatibility fixture

The historical source baseline is pinned to commit:

```text
169992beef06f1f4cddc5dba6bce3b8991ce9fd4
```

CI checks it out into an isolated directory and changes only the root and desktop package versions to fixture version `0.9.18`.

The fixture exists only to exercise installer ordering against the current `0.9.19` candidate. It is not presented as a previously published release.

Fixture preparation fails on package identity, version, lockfile or semantic-version contradictions.

## Normal lifecycle

The same disposable per-user installation directory is used for these transitions:

1. install and verify the historical fixture;
2. upgrade to and verify the current candidate;
3. reinstall the current candidate as a repair and idempotency check;
4. uninstall the current candidate before rollback;
5. verify application authority is absent while user state remains;
6. install and verify the historical rollback target;
7. upgrade and verify the current candidate again;
8. uninstall cleanly.

Rollback is explicit application removal followed by installation of the selected older payload. It is not an unsupported older-over-newer installation.

## Installed application verification

Every installed stage uses the shared clean-install assertions:

- every canonical payload file exists with identical path, size and SHA-256;
- only declared installer additions are accepted;
- executable product identity and version are correct;
- bundled command-line runtime version matches the expected stage;
- exactly one logical per-user uninstall registration exists;
- registration name, version, publisher and uninstaller are canonical;
- the application shortcut targets the installed executable;
- bounded application launch remains alive until controlled termination.

Windows may expose one physical registration through multiple registry views. Deduplication is allowed only for entries that identify the same physical authority.

## User-owned state preservation

Before installation, CI creates a sentinel inside disposable application state. Its SHA-256 is checked after every install, launch, upgrade, repair, removal, rollback and re-upgrade stage.

The acceptance path does not reset, recreate, inspect, migrate, export or upload real Workspace evidence. It proves preservation of user-owned local state through installer lifecycle operations.

## Build isolation

The historical checkout is built in a dedicated directory. It is not uploaded as a current candidate and cannot replace current source or manifest authority.

The current candidate is not rebuilt for migration testing. The lifecycle consumes the same payload and installer produced by the candidate workflow.

Each format is derived from an isolated copy so packaging additions cannot mutate canonical product bytes.

## Failure model

The gate fails on:

- fixture or source inconsistency;
- invalid version ordering;
- build or installer failure;
- payload drift;
- ambiguous registration or shortcut authority;
- wrong product or version identity;
- early application exit;
- failed application removal;
- deleted or modified user-owned state.

Failure cleanup may target only the disposable test installation and state.

## Limits

This contract does not prove:

- arbitrary power-loss recovery;
- automatic update behavior;
- rollback across incompatible future schemas;
- publisher authenticity or reputation.

Controlled interruption, signing and official publication remain separate accepted boundaries.

## Evolution

The historical commit and fixture version are compatibility fixtures. Replacing either requires a reviewed contract change and evidence that the new fixture remains a meaningful older boundary.

Shared lifecycle assertions remain focused modules. New migration behavior must not be hidden inside oversized product modules or an unreviewable workflow.
