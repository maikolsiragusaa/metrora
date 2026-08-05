# Metrora Windows UX acceptance — guided path

This procedure is the physical completion gate for UX1.G. It validates keyboard operation, Windows scaling, themes, reduced motion and Narrator on the exact source-bound Windows candidate.

It does **not** repeat or replace the R1.B.D lifecycle protocol. Installation, migration, rollback, recovery and persisted-state preservation remain owned by `WINDOWS_PHYSICAL_ACCEPTANCE_R1BD.md`.

## Before starting

- use a clean checkout at the exact `main` commit being accepted;
- download the complete `metrora-windows-candidate-<commit>.zip` artifact produced from that commit;
- leave the ZIP intact, preferably in `Downloads`;
- close every running Metrora process;
- reserve enough time to test four Windows display scales and Narrator.

## Start

From the repository root, double-click:

```text
AVVIA-COLLAUDO-UX-METRORA.cmd
```

The launcher finds the only matching candidate ZIP in `Downloads`, or opens a file selector. It then:

1. binds the procedure to the current full Git commit;
2. reuses the existing bounded candidate preparation and verification authority;
3. copies and hashes the ZIP before extraction;
4. reconstructs and verifies the canonical payload;
5. launches only the verified portable executable;
6. records only bounded yes/no observations;
7. writes and verifies a closed-schema sanitized report.

## Physical phases

### 1. Keyboard

Check Tab, Shift+Tab, Enter, Space, Escape, Ctrl+1…9, Ctrl+, and Ctrl+R. Focus must remain visible and must not disappear behind clipping or scrolling.

### 2. Display scaling

The guide asks you to set Windows scaling to 100%, 125%, 150% and 200%. At every scale, verify:

- Home remains understandable in the first viewport;
- all navigation groups and destinations remain reachable;
- Sessions, Models, Compare, Spend and Optimize preserve row identity and numeric meaning;
- Workspace guidance, blockers and safe actions remain visible;
- dropdowns, banners, tooltips and dialogs remain inside the usable viewport;
- a narrow ordinary desktop window remains operable.

### 3. Themes

Check both light and dark themes. Focus and semantic states must remain understandable. Signal Orange may reinforce activity and selection, but must never be the only carrier of meaning.

### 4. Reduced motion

Turn off **Animation effects** in Windows Accessibility settings before the guided launch. Non-essential motion must be suppressed while loading and state changes remain understandable.

### 5. Narrator

Start Narrator with `Ctrl+Windows+Enter`. Verify navigation groups, active page, shortcuts, dense tables, unavailable states, Compare winners, Workspace guidance and dialogs.

## Result

A successful run produces:

```text
METRORA-WINDOWS-UX-ACCEPTANCE.json
```

The report is bound to the exact commit and candidate digest. It contains no usernames, local paths, prompts, Workspace identifiers, keys, receipts or evidence contents.

The verifier rejects:

- missing observations;
- a PASS containing any false observation;
- incomplete or reordered scaling matrices;
- a report from another commit;
- unknown fields or private-data declarations.

A failed observation remains a failure. Remediate it in a separate reviewable PR and repeat the affected physical observation on the new source-bound candidate.
