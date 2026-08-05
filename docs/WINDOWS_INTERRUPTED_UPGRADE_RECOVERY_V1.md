# Windows interrupted upgrade recovery v1

**Status:** implemented CI contract for controlled installer interruption and deterministic recovery.

This contract proves that an interrupted Windows installer run cannot silently leave Metrora with ambiguous application authority or damaged user-owned local state.

It uses an unsigned disposable test fixture. It does not add updater logic, network recovery, signing authority, public release behavior or a support backdoor.

## Controlled interruption

The test does not depend on arbitrary sleep timing or random file deletion.

A test-only NSIS include inserts a runtime checkpoint into an installer derived from the same canonical current payload as the ordinary candidate. The checkpoint:

- exists only in the interruption fixture;
- writes one unique marker below the disposable runner directory;
- waits until released or terminated;
- contains no product, Workspace or user-state logic;
- is never copied into ordinary candidate output;
- is never uploaded or published.

CI terminates the fixture only after observing the checkpoint marker.

## Candidate authority

The ordinary current candidate remains the recovery authority.

The interruption fixture repackages an isolated copy of the canonical payload with the test-only include. It is not a second product build and cannot replace the ordinary manifest or installer.

Recovery always uses the ordinary current installer.

## Interrupted-state classification

The installation is classified independently from process exit and registry assumptions:

- `baseline-complete` — historical baseline files are complete and current files are not;
- `candidate-complete` — current files are complete and baseline files are not;
- `absent` — no application payload or Windows authority remains;
- `mixed` — files or authorities do not form one accepted complete state.

Classification compares canonical paths, sizes and SHA-256 digests. Registration and shortcut authority are inventoried separately.

A mixed state is never treated as healthy.

## Recovery policy

Recovery is confined to the disposable test installation:

- `candidate-complete` — validate current installation and normalize missing Windows authority if needed;
- `baseline-complete` — retry the ordinary current upgrade;
- `absent` — install the ordinary current candidate;
- `mixed` — remove disposable application authority only, verify absence and install the ordinary current candidate.

Recovery must converge to:

- the exact canonical current payload;
- the expected executable and CLI version;
- one logical per-user uninstall registration;
- one canonical Start Menu shortcut;
- successful bounded Electron launch;
- no competing baseline or mixed authority.

## User-owned local state

Before baseline installation, CI creates a sentinel in the disposable Metrora local-state directory.

Its digest is checked after baseline launch, interruption, termination, classification, any bounded cleanup, recovery launch and final application removal.

The fixture, classifier and recovery harness may not reset, rewrite, inspect, export or upload Workspace evidence.

## Windows authority checks

File classification alone is insufficient. The harness also inventories:

- logical HKCU uninstall registrations;
- registrations outside HKCU;
- canonical Start Menu shortcuts and targets;
- installed executable version where available.

Incomplete or conflicting authority is reported and cannot pass as healthy. After recovery, exactly one canonical current authority is required.

## Failure model

Validation fails when:

- the checkpoint cannot be proven;
- the fixture enters ordinary candidate output;
- termination is not deterministic;
- state classification is contradictory;
- a mixed state is accepted without bounded cleanup;
- cleanup targets anything outside the disposable application authority;
- recovery does not converge to the canonical candidate;
- registration, shortcut, executable or CLI authority remains ambiguous;
- the application cannot launch after recovery;
- user-owned state changes;
- independent candidate verification fails.

## Explicit prohibitions

The interruption contract must not introduce:

- runtime updater or background installer monitoring;
- network access or remote repair;
- hidden support commands;
- deletion of real user data;
- publication of the interruption fixture;
- a second current product build;
- relaxed payload, registration or shortcut allowlists;
- changes to Workspace, parser, pricing, provider or evidence semantics.

## Completion criteria

The contract passes only when the controlled interruption is observed on Windows, the resulting state is classified, recovery converges to the ordinary candidate, local state remains byte-identical and the candidate still passes independent verification.
