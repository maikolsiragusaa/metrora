# Metrora Windows physical acceptance — guided path

This guide is a convenience layer over the authoritative R1.B.D protocol in `WINDOWS_PHYSICAL_ACCEPTANCE_R1BD.md`. It does not replace or weaken any candidate, repository, profile, sentinel, lifecycle or report verification.

## What remains manual

One safety boundary cannot be automated away:

1. P1 runs on the existing Windows profile that contains the accepted Metrora state.
2. P2 and P3 run on a different local Windows user dedicated to destructive installer and migration testing.

The guide fingerprints the local Windows profile without writing the username or SID into the final report. It refuses to run P2/P3 from the profile that completed P1.

## Before starting

- use a clean repository checkout at the exact accepted `main` commit;
- download the complete `metrora-windows-candidate-<commit>.zip` artifact produced from that same commit;
- leave the ZIP intact, preferably in `Downloads`;
- close every running Metrora process;
- ensure the repository path can also be read by the dedicated Windows user.

Do not manually extract or launch anything from the artifact.

## Existing profile — one double click

From the repository root, double-click:

```text
AVVIA-TEST-FISICO-METRORA.cmd
```

The guide:

- finds the only matching ZIP in `Downloads`, or opens a file selector;
- uses the current full Git commit as the expected authority;
- calls the authoritative preparation script;
- preserves and hashes the ZIP before bounded extraction;
- reconstructs and verifies the canonical payload;
- creates the sentinel and closed draft report;
- launches the verified portable twice;
- records P1 through the existing bounded recorder;
- writes a continuation launcher inside the shared acceptance directory.

During each portable launch, inspect only the previously accepted state. Do not create, sign, export, delete or reset anything merely to make the test pass.

## Dedicated profile — second double click

Sign out of the primary Windows user and enter a separate local user dedicated to acceptance testing.

Open the shared directory shown by the first stage and double-click:

```text
CONTINUA-TEST-METRORA.cmd
```

The guide refuses to continue when it detects the same profile used for P1. On the dedicated profile it invokes the unchanged authoritative scripts for:

- P2 clean install, first launch, exact layout and identity checks, uninstall and sentinel preservation;
- P3 local historical fixture build, upgrade, reinstall, explicit rollback, re-upgrade, uninstall, fixture removal and sentinel preservation;
- final closed-schema report generation and verification.

The historical fixture remains local and is never uploaded or presented as a supported release.

## Result

A successful run opens the directory containing:

```text
METRORA-WINDOWS-PHYSICAL-ACCEPTANCE.json
```

The report contains no usernames, local paths, prompts, Workspace identifiers, keys, receipts or evidence contents.

A failure stops the guide. It does not clean unknown state destructively, reinterpret a failed observation or convert a FAIL into PASS.

## Manual fallback

The command-by-command protocol remains available in `WINDOWS_PHYSICAL_ACCEPTANCE_R1BD.md`. Both paths invoke the same underlying scripts and verifiers; the guided path only chooses the correct next stage and supplies validated paths.
