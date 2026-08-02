# Windows interrupted upgrade recovery v1

**Status:** R1.B.C.B implementation contract

## Purpose

Prove that an interrupted Windows installer run cannot silently leave Metrora with ambiguous application authority or damaged user-owned local state.

This contract covers an unsigned, disposable CI fixture. It does not enable an automatic updater, remote recovery service, signing authority, public release or support backdoor.

## Controlled interruption

The interruption test must not depend on arbitrary sleep timing or random deletion of application files.

A dedicated test-only NSIS include inserts a runtime checkpoint into an installer derived from the same current canonical payload used by the ordinary candidate.

The checkpoint:

- exists only in the interruption fixture;
- writes one unique marker below the disposable runner temporary directory;
- waits inside the installer until released or terminated;
- runs only during installation;
- contains no product, Workspace or user-state logic;
- is never copied into the ordinary candidate output;
- is never uploaded or published.

CI terminates the fixture only after observing the expected marker.

## Current candidate authority

The ordinary current candidate remains built once by the existing Windows candidate job.

The interruption fixture may repackage an isolated copy of the same canonical current payload with the test-only NSIS include. It is not a second product build and cannot replace the ordinary candidate manifest or installer.

After interruption, recovery must use the ordinary current installer, not the fixture.

## State classification

The interrupted installation directory is classified independently from installer process exit or registry assumptions.

Allowed classifications are:

- `baseline-complete` — every historical baseline product file matches and the current payload does not;
- `candidate-complete` — every current product file matches and the baseline payload does not;
- `absent` — no product payload or Windows application authority remains;
- `mixed` — files or authorities do not form one accepted complete state.

The classifier compares canonical file paths, sizes and SHA-256 digests. Windows registration and shortcut authority are checked separately by the lifecycle harness.

A mixed state is never treated as a valid installed application.

## Recovery policy

Recovery is local to the disposable test installation.

- `candidate-complete`: validate the current installation and normalize any missing Windows authority through the ordinary current installer if needed;
- `baseline-complete`: retry the ordinary current upgrade;
- `absent`: install the ordinary current candidate;
- `mixed`: remove disposable application authority only, verify its absence, then install the ordinary current candidate.

Recovery must converge to:

- the exact current canonical payload;
- the expected current executable and CLI version;
- one logical HKCU uninstall registration;
- one canonical Start Menu shortcut;
- successful bounded Electron launch;
- no competing baseline or mixed application authority.

## User-owned local state

Before baseline installation, CI creates a sentinel in the disposable equivalent of:

```text
%APPDATA%\metrora-desktop\metrora-local-state
```

The sentinel digest is verified:

- after baseline installation and launch;
- after the interruption checkpoint is reached;
- immediately after installer termination;
- after interrupted-state classification;
- after cleanup where required;
- after current-candidate recovery and launch;
- after final application removal.

The interruption fixture, classifier and recovery harness may not reset, rewrite, inspect, export or upload Workspace evidence.

## Windows authority classification

File classification alone is not enough.

The harness also inventories:

- logical HKCU uninstall registrations;
- registrations outside HKCU;
- canonical Start Menu shortcuts;
- shortcut targets;
- installed executable version where available.

Before recovery, incomplete or conflicting Windows authority is reported as part of the bounded interruption result. It must not be accepted as healthy.

After recovery, exactly one canonical current authority is required.

## Failure model

The gate fails when:

- the test-only installer cannot prove that the checkpoint was reached;
- the fixture appears in ordinary candidate output;
- the installer cannot be terminated deterministically;
- state classification is impossible or contradictory;
- a mixed state is accepted without cleanup;
- cleanup targets anything outside the disposable installation;
- recovery does not converge to the canonical current payload;
- registration, shortcut, executable or CLI authority remains ambiguous;
- the application cannot launch after recovery;
- user-owned local state changes;
- the ordinary candidate no longer passes independent verification.

## Explicit prohibitions

R1.B.C.B must not introduce:

- updater logic in the product runtime;
- network access or remote repair;
- background installer monitoring in Metrora;
- hidden support commands;
- deletion of real user data;
- publication of the interruption fixture;
- a second current payload build;
- relaxed payload, registry or shortcut allowlists;
- changes to Workspace, parser, pricing, provider or evidence semantics.

## Completion criteria

R1.B.C.B completes only when the controlled interruption is observed on Windows, the resulting state is classified, recovery converges to the ordinary current candidate, local state remains byte-identical and every existing release/architecture/brand gate remains green.
