# Desktop Workspace runtime v1

**Status:** Workspace v1 desktop runtime implemented and accepted. Secure main-process isolation, focused desktop view, durable production lifecycle, trusted orchestration, canonical scanning, explicit production, deterministic non-destructive recovery, signed batching, local export, reopen persistence, and final physical/portable validation are complete for this milestone.

The desktop Workspace runtime exposes local Workspace identity, reviewed production, evidence state, signed batches, export, recovery, and production policy to Electron without creating a second analytics engine or exposing endpoint secrets or canonical source records to the renderer.

## Authority split

The desktop keeps three explicit authorities:

- the existing CLI/menubar Overview payload remains authoritative for calls, sessions, token dimensions, costs, pricing coverage, model labels, source labels, project labels, filters, and periods;
- the canonical parser/cache scanner is authoritative only for source-present reviewed-production candidates and bounded withheld/failed counts;
- the private Workspace runtime is authoritative for local identity, lifecycle policy, receipts, outbox publication, evidence state, recovery, batch creation, and signed export.

The Workspace renderer combines public read models. It never recalculates analytics totals, reconstructs canonical calls, or derives evidence from outbox events or signed batches.

## Main-process secret boundary

At Electron bootstrap:

1. one promise for the Workspace runtime is installed before the inherited desktop main module is loaded;
2. the existing OS-vault master-key envelope is opened through Electron `safeStorage`;
3. the existing endpoint identity is loaded once;
4. the master key is immediately zeroed;
5. the loaded signing key and event-identity key remain owned by the private main-process runtime;
6. `dispose()` zeroes both private buffers;
7. unsupported platforms or vault failures keep Workspace actions disabled without opening a plaintext fallback or blocking ordinary local analytics.

The parser/cache production bundle is separate from the local-state bundle and is loaded lazily only after the explicit production action. Opening Metrora or the Workspace screen does not load it through this path.

The runtime object is never exposed through `contextBridge`. Only strict public DTOs and bounded zero-argument actions cross IPC.

## Public snapshot and production summary

`DesktopWorkspaceSnapshotV1` contains only:

- local-only status;
- public endpoint ID, identity generation, and public-key fingerprint;
- optional personal Workspace display data and active owner role;
- enrolled endpoint display/platform/software/capability data;
- honest evidence state and counts;
- optional production lifecycle mode, revision, persistence flag, and update timestamp;
- explicit privacy flags.

The lifecycle field remains optional inside the v1 snapshot so older staged runtimes and preload consumers stay compatible. The current runtime emits `null` before Workspace creation and a strict summary after creation.

The reviewed-production result adds only:

- paused or completed outcome;
- whether scanning occurred;
- eligible count;
- newly produced count;
- already-existing count;
- withheld count;
- failed-source count;
- the refreshed public Workspace snapshot.

Neither DTO contains analytics totals, normalized calls, private deduplication identities, source paths, provider claims supplied by the renderer, cost assignments, receipts, or keys.

## Focused desktop view

The Workspace section preserves exact Overview reconciliation and presents separate explicit actions for:

1. creating the local Workspace;
2. producing reviewed measurements;
3. pausing or resuming future production;
4. checking and recovering known interrupted local state;
5. creating a signed batch;
6. exporting independently verifiable evidence.

No step triggers another automatically.

`workspaceUsageFromOverview()` remains a field-for-field projection of the current Overview payload. It performs no aggregation, repricing, relabeling, event reconstruction, or batch reconstruction.

Opening the view performs only a public Workspace-status read. It does not scan, produce, recover, sign, export, upload, or publish.

## Explicit reviewed production

The renderer calls `produceWorkspaceMeasurements()` with no arguments. Electron main ignores unexpected IPC arguments and invokes the private runtime without renderer-owned evidence input.

The renderer cannot supply:

- calls or token values;
- collector or model-provider identity;
- source paths or fingerprints;
- cost assignments;
- session, repository, project, or account claims;
- deduplication identities, receipt IDs, outbox records, or keys.

The lazy canonical scanner receives only the public endpoint ID and current Metrora adapter version. It refreshes the existing canonical parser/cache path, requires a complete cache, emits only source-present reviewed candidates, and withholds source-less history or unsupported evidence.

The private runtime then reuses the loaded endpoint identity, existing reviewed factory, production receipts, and outbox. Repeated production is idempotent and interrupted publication remains repairable through the existing receipt protocol.

The detailed scanner and desktop contracts are documented in:

- `docs/CANONICAL_REVIEWED_PRODUCTION_SCANNER_V1.md`;
- `docs/DESKTOP_REVIEWED_PRODUCTION_V1.md`.

## Production lifecycle policy

The durable `active` / `paused` policy is revisioned, idempotent, cross-process serialized, and bound to the stable Workspace and endpoint.

Pause is enforced before the canonical scan. A pause requested during an active pass waits for that complete atomic pass; later passes stop before scanning.

Pause has no effect on collectors, ordinary parser use, Overview analytics, historical pricing, labels, existing outbox events, batches, or exports. Resume never deletes state or rewrites existing evidence.

## Deterministic non-destructive recovery

Recovery is an explicit local action and is never triggered by opening the application or Workspace view.

The runtime may reconcile known interrupted receipt or publication state while preserving valid identity, lifecycle, events, batches and exports. It fails closed on malformed, conflicting, foreign, invalid, quarantined or unsupported state.

Recovery must never:

- delete valid evidence;
- silently reset Workspace or endpoint identity;
- reset or bypass the production lifecycle;
- bypass quarantine;
- fabricate measurements, acknowledgements or batches;
- weaken canonical scanner, receipt or signature checks.

A successful recovery returns only bounded public outcome counts and a refreshed Workspace snapshot. Private receipts, paths and recovery internals remain in the main-process boundary.

## Evidence actions

The renderer may explicitly request:

- current Workspace status;
- creation of the personal Workspace;
- reviewed-measurement production;
- pause or resume of future production;
- deterministic check and recovery;
- creation of the next workspace-authorized signed batch;
- export of the independently verifiable Workspace evidence package.

Production, recovery, batching, and export remain separate actions. Blocked or quarantined evidence disables unsafe actions. Pausing production does not disable valid existing recovery, batch or export operations where their own preconditions are satisfied.

## Export path privacy

Electron main opens the native save dialog and passes the selected absolute path only to the private runtime. The renderer receives only cancellation or the exported filename, verification summary, and refreshed public snapshot.

The full local path never crosses IPC and is never embedded in the evidence artifact.

## Failure boundary

All handlers return structured envelopes rather than raw exceptions.

- scanner/cache integrity failures map to a bounded production-scan error;
- missing or unloadable lazy production runtime maps to production unavailable;
- lifecycle, Workspace, receipt, outbox, recovery, quarantine, and evidence failures remain fail-closed;
- raw exception text, local paths, canonical calls, and private state never cross IPC.

Ordinary local analytics remain usable when Workspace production or recovery is unavailable.

## Packaging and validation

The root build emits:

- `desktop-local-state.js`;
- `desktop-reviewed-production.js`.

Desktop staging and portable packaging include both. Blocking Ubuntu and Windows gates verify core production, recovery, lazy import, staged bundle presence, IPC, renderer behavior, desktop typecheck, and desktop build.

The complete create → produce → pause/resume → recover → batch → export → close/reopen flow passed the Workspace v1 blocking tests and final physical Windows portable acceptance. Existing-profile, clean-install, upgrade, repair, rollback and re-upgrade validation preserved user-owned local state for the bounded accepted candidate.

## Non-goals

- no alternate analytics calculation or total store;
- no automatic/background production;
- no automatic recovery, batch creation, export, upload, or publication;
- no destructive reset or invented recovery;
- no uploader, synchronization, network, account, team, invitation, entitlement, billing, or retention service;
- no Android, Advisor, or Bench behavior;
- no collector, parser, pricing, label, session-cache, or aggregation redesign.

## Workspace v1 closure

Workspace v1 desktop runtime is closed for the accepted local milestone.

The explicit create → produce → pause/resume → recover → batch → export → reopen journey is implemented, tested and physically accepted on the Windows portable boundary. Deterministic recovery is non-destructive, valid local evidence remains user-owned, and Overview analytics continue to use the existing canonical authority.

Hosted synchronization, network upload, server acknowledgements, accounts, teams, billing, remote lifecycle control and cloud recovery remain outside Workspace v1 and require separate future gates.
