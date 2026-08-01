# Windows portable Workspace acceptance

**Purpose:** final physical/manual acceptance for Workspace v1 after the automated recovery and persisted-flow gates pass.

This checklist validates the packaged Windows portable application against real local tool data. It does not authorize destructive recovery, cloud synchronization, or changes to canonical analytics.

## Preconditions

- Use a clean copy of the current Windows portable artifact produced from the accepted commit.
- Run on a physical supported Windows machine with OS-backed DPAPI available.
- Keep a backup of the existing Metrora user-data directory before the test.
- Ensure at least one supported local source contains a source-present reviewed call with explicit provider identity.
- Do not edit local state, receipts, outbox files, or evidence files during the normal-flow test.

## Record the baseline

Before opening Workspace, record from Overview for one fixed scope:

- period and provider filter;
- calls;
- sessions;
- input/output/cache token dimensions;
- cost;
- pricing coverage;
- visible model, source, and project labels.

These values are the reconciliation baseline. Workspace actions must not alter them.

## 1. Open and create

1. Launch the portable application.
2. Open **Workspace**.
3. Confirm opening the screen does not show a production/recovery result and does not open a save dialog.
4. Create one local personal Workspace.
5. Confirm:
   - local-only status;
   - owner role;
   - endpoint name/platform;
   - endpoint identity generation and public fingerprint;
   - no account or server requirement.

## 2. Produce reviewed measurements

1. Select **Produce reviewed measurements** once.
2. Record produced, existing, withheld, and failed-source counts.
3. Confirm evidence counts refresh.
4. Select Produce again without changing source data.
5. Confirm already-known calls are reported as existing and pending event count does not duplicate.

## 3. Pause and recovery

1. Select **Pause production**.
2. Confirm the lifecycle status becomes paused.
3. Select **Check & recover local state**.
4. Confirm the result is paused before scanning and no evidence count changes.
5. Confirm Overview baseline values and labels remain unchanged.
6. Select **Resume production**.
7. Select recovery again.
8. Confirm the result is healthy or reconciled and no duplicate event is created.

## 4. Sign and export

1. Select **Create signed batch**.
2. Confirm exactly the currently unbatched reviewed events enter the batch.
3. Confirm a second batch action is empty when no new reviewed events exist.
4. Select **Export verifiable evidence**.
5. Choose a local path.
6. Confirm the renderer shows only the filename/summary, not the full path.
7. Verify the exported package using the existing procedure in `WORKSPACE_EVIDENCE_EXPORT_V1.md`.
8. Confirm the export contains no prompts, responses, source code, patches, secrets, unrestricted paths, private receipt IDs, or private keys.

## 5. Close and reopen

1. Close the application completely.
2. Reopen the same portable application.
3. Open Workspace.
4. Confirm:
   - same Workspace ID;
   - same endpoint ID and public fingerprint;
   - same lifecycle mode/revision;
   - same event and batch counts;
   - no invalid/quarantined records;
   - no automatic production or recovery occurred.
5. Select **Check & recover local state**.
6. Confirm no duplicate event or batch is created.
7. Export again and verify the same signed chain remains valid.

## 6. Analytics reconciliation

Return to the same fixed Overview scope and compare against the recorded baseline.

Pass requires no unexpected change to:

- calls or sessions;
- token dimensions;
- API-equivalent cost;
- pricing coverage;
- model/provider/source/project labels;
- filters or period behavior.

Changes caused by genuinely new source activity during the test must be explainable from that source activity, not from Workspace production, recovery, batching, or export.

## 7. Fail-closed checks

Where safe to reproduce with a disposable test profile:

- unavailable DPAPI must disable Workspace actions without plaintext fallback;
- paused state must stop production/recovery before scanning;
- invalid/quarantined state must keep production, signing, and export disabled;
- recovery must report blocked and must not delete/reset the blocker;
- cancelling export must write nothing;
- no Workspace action may require network access.

Do not corrupt a real user profile to perform these checks. Automated tests already cover controlled corruption and interrupted publication.

## Pass criteria

Workspace v1 physical acceptance passes only when:

- the complete flow succeeds without a terminal or server;
- one source call produces at most one reviewed event;
- one set of unbatched events produces at most one new batch;
- pause/resume is reversible and data-preserving;
- recovery is non-destructive and idempotent;
- close/reopen preserves identity, Workspace, lifecycle, receipts, events, batches, and export verification;
- canonical Overview analytics remain authoritative and reconciled;
- the portable artifact contains and can load both desktop runtime bundles;
- no prohibited private content appears in IPC responses or exports.

Record the tested commit SHA, portable artifact checksum, Windows version, Metrora version, observed source/tool versions, and final PASS/FAIL result in the release checkpoint.
