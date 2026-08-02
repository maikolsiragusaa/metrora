# Metrora Windows physical acceptance — R1.B.D

## Status and authority

This contract completes the final unsigned Windows acceptance boundary from issue #63.

Physical acceptance must use:

- an ordinary GitHub Actions candidate produced from the exact accepted public `main` commit under test;
- the complete downloaded artifact ZIP and its SHA-256 digest;
- a clean repository checkout at that same commit;
- the candidate, prepared-state and report verifiers from that commit.

Do not use:

- a pull-request artifact bound to a temporary merge ref;
- a manually extracted directory supplied independently from the declared ZIP;
- the historical `0.9.18` fixture as a supported release;
- the interruption fixture from R1.B.C.B;
- a locally rebuilt current candidate as a substitute for the downloaded candidate.

The preparation script copies and hashes the declared ZIP inside the acceptance workspace, extracts that copy itself, rejects traversal, symbolic links, case-colliding entries and bounded-size violations, and makes the resulting extraction the only candidate authority for P1, P2 and P3.

Before every phase, the shared verifier rechecks repository HEAD and tracked-file cleanliness, the preserved ZIP digest, Windows platform, candidate manifests, reconstructed canonical payload and sentinel.

The candidate remains unsigned engineering evidence. It is not an official release and has no update channel.

## Safety split

Use two Windows user profiles:

1. **Existing profile — P1 only.** This profile already contains the accepted Metrora endpoint identity, Workspace and evidence state.
2. **Dedicated acceptance profile — P2 and P3 only.** This profile must not contain the primary accepted Metrora state.

Never run installer, rollback or historical-fixture tests against the existing primary profile.

Use a local shared acceptance directory that both Windows users can access, such as `C:\Users\Public\MetroraR1BD`. Do not expose it as a network share. Use short working and installation paths without spaces for NSIS operations.

## Prerequisites

- Windows x64;
- Node.js and npm versions compatible with the repository lockfiles;
- Git with the accepted current commit and historical commit `169992beef06f1f4cddc5dba6bce3b8991ce9fd4` available locally;
- PowerShell capable of running the checked-in scripts;
- the complete ordinary Windows candidate ZIP downloaded from the accepted `main` workflow run;
- repository HEAD at the exact accepted source commit on each profile executing a stage;
- no modified or staged tracked files in that checkout.

Do not extract or modify the downloaded ZIP manually.

## Step 1 — prepare the acceptance workspace

Run this on the existing profile. The output directory must be absent or empty.

```powershell
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass `
  -File scripts\Prepare-Metrora-Windows-Physical-Acceptance.ps1 `
  -ArtifactArchive C:\Users\Public\MetroraR1BD\metrora-windows-candidate.zip `
  -ExpectedCommit <accepted-main-sha> `
  -OutputDirectory C:\Users\Public\MetroraR1BD\acceptance `
  -RepositoryRoot $PWD
```

Preparation fails closed unless:

- every ZIP entry remains inside the extraction root;
- the copied ZIP digest matches the downloaded ZIP;
- the candidate manifest is bound to the exact expected commit;
- portable and installer formats verify against the public source;
- the canonical payload can be reconstructed only from inventoried portable files;
- release and format manifests are hashed;
- Windows is x64.

The acceptance workspace contains:

- `declared-artifact.zip`, the preserved byte-identical ZIP authority;
- `downloaded-candidate`, extracted only from that preserved ZIP;
- a locally reconstructed canonical payload;
- a random user-owned sentinel;
- a closed context file;
- a draft report whose three profiles are `not-run`.

The final public report never contains local paths or sentinel bytes.

## Step 2 — P1 existing-profile portable acceptance

Close every running Metrora process. On the existing primary Windows profile, launch Metrora only through the checked-in launcher:

```powershell
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass `
  -File scripts\Start-Metrora-Windows-Physical-Existing-Profile.ps1 `
  -AcceptanceDirectory C:\Users\Public\MetroraR1BD\acceptance `
  -RepositoryRoot $PWD
```

The launcher re-verifies the complete prepared state, opens only `downloaded-candidate\portable\Metrora.exe`, waits until Metrora is closed, confirms no Metrora process remains, rechecks the sentinel and writes a bounded launch marker.

During the first launch:

1. Confirm the existing endpoint identity and Workspace binding are unchanged.
2. Confirm production lifecycle state is unchanged.
3. Confirm the previously accepted signed/exportable evidence state remains available.
4. Run explicit recovery only when the UI reports inspection is required.
5. Confirm no automatic duplicate production or signed batch appears.
6. Confirm invalid and quarantined counts remain zero.
7. Do not create, reset, delete, sign or export anything merely to make the test pass.
8. Close Metrora normally so the launcher can finish.

Run the same launcher command a second time. Recheck the accepted state, then close Metrora normally. P1 cannot pass without two launches recorded against the same verified candidate.

Record only the bounded result:

```powershell
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass `
  -File scripts\Record-Metrora-Windows-Physical-Existing-Profile.ps1 `
  -AcceptanceDirectory C:\Users\Public\MetroraR1BD\acceptance `
  -RepositoryRoot $PWD
```

The recorder re-verifies the prepared state and derives portable verification and reopen eligibility from the launcher marker. It accepts no free-form notes, paths, identifiers or evidence content.

## Step 3 — P2 dedicated-profile clean lifecycle

Switch to the dedicated acceptance Windows user. Use an empty install directory without spaces.

```powershell
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass `
  -File scripts\Test-Metrora-Windows-Physical-Clean.ps1 `
  -AcceptanceDirectory C:\Users\Public\MetroraR1BD\acceptance `
  -InstallDirectory C:\MetroraR1BDInstall `
  -DedicatedProfileAcknowledged `
  -RepositoryRoot $PWD
```

P2 re-verifies the prepared state, takes its installer only from the preserved ZIP extraction and verifies:

- every installed canonical product file;
- Metrora executable identity and exact version;
- one local uninstaller;
- one logical HKCU uninstall registration;
- exactly one canonical Start Menu shortcut authority;
- compatibility CLI version;
- bounded first launch;
- clean uninstall;
- byte-identical sentinel preservation.

No application file, registration or shortcut authority may remain after successful uninstall.

## Step 4 — P3 dedicated-profile migration lifecycle

Remain on the dedicated acceptance profile. The harness re-verifies the prepared state, takes the current installer only from the preserved ZIP extraction, creates an isolated Git worktree for the historical source, builds the historical fixture locally, runs the declared lifecycle, and removes the fixture and worktree afterwards.

```powershell
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass `
  -File scripts\Test-Metrora-Windows-Physical-Migration.ps1 `
  -AcceptanceDirectory C:\Users\Public\MetroraR1BD\acceptance `
  -WorkingDirectory C:\MetroraR1BDWork `
  -DedicatedProfileAcknowledged `
  -RepositoryRoot $PWD
```

The required sequence is exactly:

```text
installed-0.9.18
upgraded-0.9.19
reinstalled-0.9.19
uninstalled-for-rollback
rolled-back-0.9.18
re-upgraded-0.9.19
uninstalled
```

The historical fixture remains local, is never uploaded or copied into the ordinary candidate, is removed after the test, and is not described as a previously published Metrora release.

## Step 5 — finalize the sanitized report

```powershell
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass `
  -File scripts\Complete-Metrora-Windows-Physical-Acceptance.ps1 `
  -AcceptanceDirectory C:\Users\Public\MetroraR1BD\acceptance `
  -RepositoryRoot $PWD
```

The finalizer re-verifies the complete prepared state, combines only P1, P2 and P3 bounded result objects, rechecks the sentinel, writes `METRORA-WINDOWS-PHYSICAL-ACCEPTANCE.json`, and verifies exact fields, source binding, digests, PASS invariants and privacy declarations.

R1.B.D passes only when all three profiles are `pass`.

## Stop conditions

Stop without destructive repair if:

- repository HEAD or tracked files differ from the accepted authority;
- the preserved ZIP digest changes;
- ZIP extraction, candidate, manifest or canonical-payload verification fails;
- the test moves to a different Windows platform;
- the existing primary profile changes unexpectedly;
- more than one executable, uninstaller, logical registration or shortcut authority is observed;
- any PASS would require deleting user-owned state;
- the historical fixture cannot remain local and disposable;
- the sentinel changes;
- the report verifier rejects the result.

A failure remains evidence. Do not rewrite it into a PASS and do not add free-form private detail to the repository.

## Public report privacy

The report schema forbids usernames, home or application paths, prompts or responses, session/endpoint/Workspace identifiers, keys, receipts, raw evidence, arbitrary notes and unknown fields.

Only bounded platform metadata, public artifact names and digests, version identity, fixed transition names, booleans and counts are allowed.

## Boundary after PASS

A PASS closes unsigned R1.B acceptance. It does not authorize Authenticode signing, certificate/provider selection, release publication, an updater or stable channel, arbitrary downgrade support, or hosted Workspace, Advisor, Bench or billing behavior.

Protected signing remains a separate infrastructure decision and acceptance boundary.
