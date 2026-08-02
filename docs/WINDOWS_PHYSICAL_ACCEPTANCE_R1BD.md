# Metrora Windows physical acceptance — R1.B.D

## Status and authority

This contract completes the final unsigned Windows acceptance boundary from issue #63.

Physical acceptance must use:

- an ordinary GitHub Actions candidate produced from the exact accepted public `main` commit under test;
- the complete downloaded ZIP archive and its SHA-256 digest;
- a repository checkout at that same commit;
- the candidate verifier and report verifier from that commit.

Do not use:

- a pull-request artifact bound to a temporary merge ref;
- the historical `0.9.18` fixture as a supported release;
- the interruption fixture from R1.B.C.B;
- a locally rebuilt current candidate as a substitute for the downloaded candidate.

The candidate remains unsigned engineering evidence. It is not an official release and has no update channel.

## Safety split

Use two Windows user profiles:

1. **Existing profile — P1 only.** This is the profile that already contains the accepted Metrora endpoint identity, Workspace and evidence state.
2. **Dedicated acceptance profile — P2 and P3 only.** This profile must not contain the primary accepted Metrora state.

Never run installer, rollback or historical-fixture tests against the existing primary profile.

## Prerequisites

- Windows x64;
- Node.js and npm versions compatible with the repository lockfiles;
- Git with the accepted current commit and historical commit `169992beef06f1f4cddc5dba6bce3b8991ce9fd4` available locally;
- PowerShell capable of running the checked-in scripts;
- the complete ordinary Windows candidate ZIP downloaded from the accepted `main` workflow run;
- the ZIP extracted without changing its directory structure.

Use short working paths without spaces for NSIS acceptance directories.

## Step 1 — prepare the acceptance workspace

From a repository checkout at the exact accepted source commit:

```powershell
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass `
  -File scripts\Prepare-Metrora-Windows-Physical-Acceptance.ps1 `
  -CandidateDirectory C:\MetroraR1BD\candidate `
  -ArtifactArchive C:\MetroraR1BD\metrora-windows-candidate.zip `
  -ExpectedCommit <accepted-main-sha> `
  -OutputDirectory C:\MetroraR1BD\acceptance `
  -RepositoryRoot $PWD
```

Preparation fails closed unless:

- the candidate manifest is bound to the exact expected commit;
- portable and installer formats verify against the public source;
- the canonical payload can be reconstructed only from inventoried portable files;
- the archive, release manifest and format manifest are hashed;
- Windows is x64;
- the acceptance output is outside the downloaded candidate.

The acceptance workspace contains:

- a locally reconstructed canonical payload;
- a random user-owned sentinel;
- a bounded context file;
- a draft report whose three profiles are `not-run`.

The final public report never contains local paths or the sentinel bytes.

## Step 2 — P1 existing-profile portable acceptance

On the existing primary Windows profile:

1. Launch only `portable\Metrora.exe` from the exact prepared candidate.
2. Confirm the existing endpoint identity and Workspace binding are unchanged.
3. Confirm production lifecycle state is unchanged.
4. Confirm the previously accepted signed/exportable evidence state remains available.
5. Close and reopen the application.
6. Run explicit recovery only when the UI reports inspection is required.
7. Confirm no automatic duplicate production or signed batch appears.
8. Confirm invalid and quarantined counts remain zero.
9. Do not create, reset, delete, sign or export anything merely to make the test pass.

Record only the bounded result:

```powershell
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass `
  -File scripts\Record-Metrora-Windows-Physical-Existing-Profile.ps1 `
  -AcceptanceDirectory C:\MetroraR1BD\acceptance
```

The recorder accepts no free-form notes, paths, identifiers or evidence content.

## Step 3 — P2 dedicated-profile clean lifecycle

Switch to the dedicated acceptance Windows user. Use an empty install directory without spaces.

```powershell
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass `
  -File scripts\Test-Metrora-Windows-Physical-Clean.ps1 `
  -AcceptanceDirectory C:\MetroraR1BD\acceptance `
  -CandidateDirectory C:\MetroraR1BD\candidate `
  -InstallDirectory C:\MetroraR1BDInstall `
  -DedicatedProfileAcknowledged `
  -RepositoryRoot $PWD
```

P2 verifies:

- every installed canonical product file;
- Metrora executable identity and exact version;
- one local uninstaller;
- one logical HKCU uninstall registration;
- one or more canonical Start Menu shortcut views resolving to the same executable;
- compatibility CLI version;
- bounded first launch;
- clean uninstall;
- byte-identical sentinel preservation.

No application file, registration or shortcut authority may remain after successful uninstall.

## Step 4 — P3 dedicated-profile migration lifecycle

Remain on the dedicated acceptance profile. The harness creates an isolated Git worktree for the historical source, builds the historical fixture locally, runs the declared lifecycle, and removes the fixture and worktree afterwards.

```powershell
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass `
  -File scripts\Test-Metrora-Windows-Physical-Migration.ps1 `
  -AcceptanceDirectory C:\MetroraR1BD\acceptance `
  -CandidateDirectory C:\MetroraR1BD\candidate `
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

The historical fixture:

- remains local;
- is never uploaded;
- is never copied into the ordinary candidate;
- is removed after the test;
- is not described as a previously published Metrora release.

## Step 5 — finalize the sanitized report

```powershell
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass `
  -File scripts\Complete-Metrora-Windows-Physical-Acceptance.ps1 `
  -AcceptanceDirectory C:\MetroraR1BD\acceptance `
  -RepositoryRoot $PWD
```

The finalizer:

- combines only P1, P2 and P3 bounded result objects;
- rechecks the sentinel;
- writes `METRORA-WINDOWS-PHYSICAL-ACCEPTANCE.json`;
- verifies exact fields, source binding, digests, PASS invariants and privacy declarations;
- reports `pass`, `fail` or `incomplete`.

R1.B.D passes only when all three profiles are `pass`.

## Stop conditions

Stop without destructive repair if:

- the downloaded candidate is not bound to the expected accepted commit;
- candidate or manifest verification fails;
- the existing primary profile changes unexpectedly;
- more than one executable, uninstaller, logical registration or shortcut authority is observed;
- any PASS would require deleting user-owned state;
- the historical fixture cannot remain local and disposable;
- the sentinel changes;
- the report verifier rejects the result.

A failure remains evidence. Do not rewrite it into a PASS and do not add free-form private detail to the repository.

## Public report privacy

The report schema forbids:

- usernames;
- home or application paths;
- prompts or responses;
- session, endpoint or Workspace identifiers;
- keys, receipts or raw evidence;
- arbitrary notes or unknown fields.

Only bounded platform metadata, public artifact names and digests, version identity, fixed transition names, booleans and counts are allowed.

## Boundary after PASS

A PASS closes unsigned R1.B acceptance. It does not authorize:

- Authenticode signing;
- certificate or provider selection;
- release publication;
- an updater or stable channel;
- support claims for arbitrary downgrade paths;
- hosted Workspace, Advisor, Bench or billing behavior.

Protected signing remains a separate infrastructure decision and acceptance boundary.
