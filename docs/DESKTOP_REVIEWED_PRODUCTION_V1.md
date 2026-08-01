# Desktop reviewed production v1

**Status:** W1.D.C.B.B.B desktop integration.

This checkpoint connects the canonical per-source reviewed-production scanner to the secure desktop Workspace runtime. It gives the user one explicit action to produce reviewed measurements without exposing canonical calls, source paths, provider claims, costs, fingerprints, receipts, or endpoint keys to the renderer.

## Runtime split

The desktop uses two staged main-process bundles:

- `desktop-local-state.js` loads at Workspace runtime initialization and owns the OS-vault-backed endpoint identity, local Workspace state, lifecycle state, receipts, outbox, signed batches, and exports;
- `desktop-reviewed-production.js` contains the canonical parser/cache scanner and is imported lazily only after the explicit production action.

Opening Metrora or the Workspace screen does not load the parser bundle through this path and does not produce evidence.

The existing Overview/CLI runtime remains the authority for ordinary analytics. The Workspace screen still projects its visible totals directly from the current Overview payload.

## Explicit action

The renderer exposes `produceWorkspaceMeasurements()` with no arguments.

Electron main ignores any unexpected IPC arguments and calls the private runtime method with no renderer-owned data. The renderer cannot supply:

- normalized calls;
- collector or model-provider identity;
- source paths or fingerprints;
- historical cost assignments;
- deduplication identities;
- session, repository, project, or account claims;
- receipt IDs, outbox records, keys, or evidence semantics.

The trusted scanner receives only the public endpoint ID and current Metrora adapter version from the private runtime.

## Production flow

When active:

1. the private production-control lease is acquired;
2. the durable lifecycle state is checked;
3. the lazy scanner bundle refreshes the existing canonical parser/cache path;
4. eligible source-present reviewed candidates are derived;
5. the existing one-call producer reuses the protected endpoint identity;
6. private production receipts deduplicate or repair publication;
7. the public Workspace snapshot is refreshed;
8. the renderer receives only bounded counts and public state.

The bounded summary contains:

- paused or completed outcome;
- whether scanning occurred;
- eligible count;
- newly produced count;
- already-existing count;
- withheld count;
- failed-source count.

It contains no calls, tokens, models, providers, paths, fingerprints, sessions, project references, receipts, keys, prompts, responses, code, patches, secrets, or tool arguments.

## Pause and resume

Pause and resume are explicit zero-argument actions.

Pause applies before the canonical scan and affects only future reviewed Workspace production. It does not stop:

- collectors or parser use for ordinary analytics;
- Overview refreshes;
- historical pricing or labels;
- existing outbox records;
- signed-batch creation;
- evidence export.

A pause requested while a production pass is already running waits for that atomic pass to finish. Later passes stop before scanning.

## User sequence

The Workspace view now presents four separate explicit steps:

1. create the local Workspace;
2. produce reviewed measurements;
3. create a signed batch;
4. export independently verifiable evidence.

None of these steps triggers another automatically.

The view also shows pause/resume controls and the latest bounded production summary. Opening the screen performs only a public status read.

## Failure boundary

- canonical cache or provenance contradictions map to a bounded production-scan failure;
- missing or unloadable lazy scanner runtime maps to production unavailable;
- receipt collisions, outbox corruption, Workspace mismatch, quarantine, and other integrity failures remain fail-closed;
- raw exception text, local paths, and private state do not cross IPC.

Ordinary local analytics remain available when reviewed production is unavailable.

## Packaging

The root build emits `desktop-reviewed-production.js` as a separate entry. Desktop staging and portable packaging must include it together with `desktop-local-state.js`.

Blocking validation covers:

- scanner and orchestrator behavior;
- protected identity reuse;
- production, replay, pause, and refreshed evidence state;
- lazy one-time module import;
- zero-argument IPC and bounded failures;
- renderer explicitness and pause semantics;
- desktop typecheck/build;
- staged runtime presence on Ubuntu and Windows.

## Non-goals

- no automatic or background production;
- no automatic batch creation, export, upload, or publication;
- no hosted synchronization, account, team, entitlement, or billing dependency;
- no alternate parser, cache, pricing, or analytics authority;
- no recovery action that deletes or silently resets evidence;
- no Android, Advisor, or Bench behavior.
