# Desktop reviewed production v1

**Status:** implemented in the secure desktop Workspace runtime and renderer.

This component connects the canonical per-source reviewed-production scanner to the protected Workspace runtime. It gives the user one explicit production action without exposing canonical calls, source paths, provider claims, costs, fingerprints, receipts or endpoint keys to the renderer.

## Runtime split

The desktop uses two main-process bundles:

- `desktop-local-state.js` owns OS-vault-backed endpoint identity, local Workspace state, lifecycle, receipts, outbox, signed batches and exports;
- `desktop-reviewed-production.js` owns the canonical parser/cache scanner and is imported lazily after the explicit production action.

Opening Metrora or the Workspace view does not produce evidence.

Ordinary Overview and CLI analytics remain authoritative for user-facing totals. The Workspace view projects its scoped usage from the existing Overview payload rather than recalculating it.

## Explicit action

The renderer calls `produceWorkspaceMeasurements()` without measurement arguments.

Electron main ignores unexpected arguments and invokes the private runtime. The renderer cannot supply:

- normalized calls;
- collector or AI-provider identity;
- source paths or fingerprints;
- historical cost assignments;
- deduplication identities;
- session, repository, project or account claims;
- receipts, outbox records or keys.

The trusted scanner receives only the public endpoint ID, current adapter version and protected production scope.

## Production flow

When production is active:

1. the private production-control lease is acquired;
2. lifecycle state is checked;
3. the lazy scanner refreshes the canonical parser/cache path;
4. eligible source-present reviewed candidates are derived;
5. the existing producer reuses the protected endpoint identity;
6. private receipts deduplicate or repair publication;
7. the public Workspace snapshot is refreshed;
8. the renderer receives only bounded counts and public state.

The result reports paused or completed outcome, whether scanning occurred, and eligible, produced, existing, withheld and failed counts.

## Lifecycle and recovery

Pause and resume are separate explicit zero-argument actions. Pause stops future production before scanning without changing ordinary analytics, historical pricing or existing evidence.

Recovery is also separate. It may reconcile known interrupted receipt publication and retry the same bounded production path, but it never deletes valid evidence, resets identity or bypasses blocked state.

## User-visible sequence

The Workspace view exposes separate actions to:

1. create the local Workspace;
2. produce reviewed measurements;
3. pause or resume future production;
4. inspect or explicitly recover local evidence state;
5. create a signed batch;
6. export independently verifiable evidence.

No action silently triggers another.

## Failure boundary

- canonical cache or provenance contradictions become bounded production-scan failures;
- missing or unloadable scanner code becomes production unavailable;
- receipt collision, outbox corruption, Workspace mismatch and quarantine remain fail closed;
- raw exception text, local paths and private state never cross IPC.

Ordinary local analytics remain available when reviewed production is unavailable.

## Packaging and validation

Desktop staging and Windows candidate packaging include both runtime bundles. Tests cover scanner/orchestrator behavior, protected identity reuse, production and replay, lifecycle enforcement, recovery, lazy loading, zero-argument IPC, bounded failures, renderer behavior, type checking and packaged bundle presence.

## Non-goals

This component does not add automatic background production, automatic batch creation or export, upload, hosted synchronization, account, team, entitlement, billing or a second parser, pricing or analytics authority.
