# Desktop Workspace runtime v1

**Status:** implemented, tested and physically accepted for the local Workspace v1 milestone.

The desktop runtime exposes Workspace identity, reviewed production, evidence state, lifecycle controls, signed batches, export and recovery without creating a second analytics engine or exposing endpoint secrets and canonical source records to the renderer.

## Authority split

The desktop keeps three explicit authorities:

- the existing Overview payload remains authoritative for calls, sessions, tokens, costs, pricing coverage, labels, filters and periods;
- the canonical parser/cache scanner is authoritative only for source-present reviewed-production candidates and bounded withheld or failed counts;
- the private Workspace runtime is authoritative for local identity, lifecycle policy, receipts, outbox publication, evidence state, recovery, batch creation and signed export.

The renderer combines public read models. It never recalculates analytics totals, reconstructs canonical calls or derives evidence from outbox events and batches.

## Main-process secret boundary

At Electron bootstrap:

1. the Workspace runtime promise is installed before the inherited desktop main module loads;
2. the OS-vault master-key envelope is opened through Electron `safeStorage`;
3. the existing endpoint identity is loaded once;
4. the master key is immediately zeroed;
5. signing and event-identity keys remain owned by the private main-process runtime;
6. runtime disposal zeroes private buffers;
7. unsupported platforms or vault failures disable Workspace actions without plaintext fallback or blocking ordinary analytics.

The parser/cache production bundle is loaded lazily only after the explicit production action. Opening Metrora or the Workspace view does not load it through this path.

The runtime object never crosses `contextBridge`. Only strict public DTOs and bounded zero-argument actions cross IPC.

## Public snapshot

`DesktopWorkspaceSnapshotV1` contains only:

- local-only status;
- public endpoint identity, generation and public-key fingerprint;
- optional personal Workspace display data and owner role;
- enrolled endpoint display, platform, software and capability data;
- honest evidence state and counts;
- optional production lifecycle summary;
- explicit privacy flags.

It contains no normalized calls, private deduplication identities, source paths, renderer-supplied provider claims, immutable cost assignments, receipts or keys.

## Explicit actions

The renderer may request:

- current Workspace status;
- personal Workspace creation;
- reviewed-measurement production;
- pause or resume of future production;
- bounded check and recovery;
- creation of the next authorized signed batch;
- export of independently verifiable evidence.

No action triggers another automatically. Unexpected IPC arguments are ignored.

The renderer cannot supply calls, token values, collector or provider identity, source paths, fingerprints, costs, project claims, deduplication identities, receipts, outbox records or keys.

## Reviewed production

The lazy scanner receives only the public endpoint ID and current adapter version. It refreshes the existing canonical parser/cache path, requires complete trusted state, emits only source-present reviewed candidates and withholds unsupported or source-less history.

The private runtime reuses the loaded endpoint identity, reviewed event factory, production receipts and outbox. Repeated production is idempotent and interrupted publication remains repairable through the receipt protocol.

The public production result contains only paused or completed outcome, scan state, eligible, produced, existing, withheld and failed counts, plus the refreshed public snapshot.

Detailed contracts:

- [`CANONICAL_REVIEWED_PRODUCTION_SCANNER_V1.md`](CANONICAL_REVIEWED_PRODUCTION_SCANNER_V1.md)
- [`DESKTOP_REVIEWED_PRODUCTION_V1.md`](DESKTOP_REVIEWED_PRODUCTION_V1.md)

## Production lifecycle

The durable active or paused policy is revisioned, idempotent, serialized and bound to the stable Workspace and endpoint.

Pause is enforced before the canonical scan. A pause requested during an active pass waits for that atomic pass to finish; later passes stop before scanning.

Pause does not affect ordinary collectors, Overview analytics, historical pricing, labels, existing events, batches or exports. Resume never deletes lifecycle state or rewrites evidence.

## Deterministic recovery

Recovery is explicit and never triggered by opening the application or Workspace view.

The runtime may reconcile known interrupted receipt or publication state while preserving valid identity, lifecycle, events, batches and exports. It fails closed on malformed, conflicting, foreign, invalid, quarantined or unsupported state.

Recovery never:

- deletes valid evidence;
- resets Workspace or endpoint identity;
- bypasses lifecycle state or quarantine;
- fabricates measurements, acknowledgements or batches;
- weakens scanner, receipt or signature checks.

A successful recovery returns only bounded public outcome counts and a refreshed snapshot. Private receipts, paths and recovery internals remain inside the main process.

## Export privacy

Electron main opens the native save dialog and passes the selected absolute path only to the private runtime. The renderer receives cancellation or the exported filename, verification summary and refreshed public snapshot.

The complete local path never crosses IPC and is never embedded in the evidence artifact.

## Failure boundary

All handlers return structured envelopes rather than raw exceptions.

- scanner and cache integrity failures map to a bounded production-scan error;
- missing or unloadable lazy runtime maps to production unavailable;
- lifecycle, Workspace, receipt, outbox, recovery, quarantine and evidence failures remain fail closed;
- raw exception text, local paths, canonical calls and private state never cross IPC.

Ordinary local analytics remain usable when Workspace production or recovery is unavailable.

## Packaging and validation

The root build emits:

- `desktop-local-state.js`;
- `desktop-reviewed-production.js`.

Desktop staging and portable packaging include both. Ubuntu and Windows gates verify production, recovery, lazy import, staged bundle presence, IPC, renderer behavior, typecheck and build.

The create, produce, pause/resume, recover, batch, export and reopen flow passed the Workspace v1 blocking tests and physical Windows portable acceptance. Existing-state, clean-install, upgrade, repair, rollback and re-upgrade validation preserved user-owned local state for the accepted candidate.

## Non-goals

- no alternate analytics calculation or total store;
- no automatic background production;
- no automatic recovery, batch creation, export, upload or publication;
- no destructive reset or invented recovery;
- no mandatory remote, account, team, entitlement, billing or retention dependency;
- no mobile or unrelated product behavior;
- no collector, parser, pricing, label, session-cache or aggregation redesign.

## Closure

The local Workspace v1 desktop runtime is closed for this milestone. The complete explicit journey is implemented and accepted, recovery is non-destructive, valid local evidence remains user-owned and Overview continues to use the existing canonical analytics authority.
