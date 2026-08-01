# Workspace v1

**Status:** active product milestone; local state, canonical reviewed production, signed batches, independent export, the secure desktop runtime, focused Workspace view, and durable pause/resume controls are implemented in this checkpoint. Deterministic non-destructive recovery and final physical/portable validation remain before W1.D and Workspace v1 are closed.

Workspace v1 is the first usable layer above Metrora's device-centric local analytics. It turns public contracts, endpoint identity, canonical normalized usage, reviewed provenance, private receipts, outbox records, signed batches, and user-owned evidence export into one understandable local workspace experience.

This milestone is deliberately local-first. It does not require a Metrora account, hosted service, subscription, or remote manager console.

## User outcome

A person can:

1. create a personal workspace on the current computer;
2. see that computer enrolled as the first endpoint;
3. understand the local privacy boundary and current reviewed-evidence state;
4. explicitly produce reviewed measurements from source-present canonical local usage;
5. pause and resume future production without stopping ordinary analytics or changing existing evidence;
6. create signed batches without duplicating calls;
7. inspect workspace identity, endpoint status, evidence counts, pricing coverage, and canonical scoped usage in the desktop application;
8. export a verifiable workspace package before any cloud synchronization exists.

The ordinary local analytics experience remains available without creating a workspace.

## Existing foundations reused

Workspace v1 reuses rather than replaces:

- `WorkspaceV1`, membership, endpoint, repository, sharing, measurement, and evidence contracts;
- the canonical parser, per-source cache, and normalized usage records;
- reviewed collector provenance profiles;
- historical per-call cost assignments and desktop/CLI pricing authority;
- durable endpoint identity protected by the operating-system vault where supported;
- private rotation-safe production receipts;
- the append-only reviewed measurement outbox;
- immutable signed measurement batches and acknowledgements;
- current cross-process leases and atomic publication primitives;
- the local companion API where a stable public DTO already exists.

No second collector, parser, pricing engine, workspace schema, signer, analytics database, or source cache is introduced.

## Implementation slices

### 1. Local workspace state — implemented

- one personal workspace created explicitly by the user;
- one owner membership bound to the local subject;
- enrollment of the existing endpoint identity;
- atomic, versioned, recoverable local persistence;
- idempotent creation and reload;
- safe reconciliation after endpoint-key rotation;
- no silent conversion of existing local usage into shared workspace data.

### 2. Reviewed measurement production primitives — implemented

- only collector paths approved by the executable provenance registry can produce Workspace measurements;
- normalized calls pass through the existing reviewed-event factory;
- immutable historical cost assignments and evidence quality are preserved;
- private rotation-safe receipts prevent duplication and repair interrupted publication;
- prompts, responses, source code, patches, secrets, tool arguments, and full local paths remain excluded;
- unreviewed or insufficient evidence remains local rather than becoming an invented claim.

### 3. Canonical production scanner and orchestrator — implemented

- the existing `parseAllSessions()` path remains the only discovery, parse, reconciliation, settlement, and cache-publication authority;
- candidates are derived only from complete per-source cache state whose source still exists;
- source-less durable analytics history is withheld rather than promoted into new evidence;
- exact cached calls and immutable assignments are reconstructed through the existing cache conversion;
- explicit source-recorded model/API provider identity is required;
- reviewed eligibility comes from the executable provenance registry;
- source identities are endpoint-scoped digests over provider and private deduplication identity, with no local-path input;
- provider-section mismatch, malformed cached calls, incomplete cache, or empty private identity fail closed;
- one production-control lease serializes production, pause, and resume;
- repeated or concurrent production deduplicates through existing private receipts.

The detailed contracts are documented in:

- `docs/CANONICAL_REVIEWED_PRODUCTION_ORCHESTRATOR_V1.md`;
- `docs/CANONICAL_REVIEWED_PRODUCTION_SCANNER_V1.md`.

### 4. Signed workspace batches and export — implemented

- only workspace-authorized reviewed events enter the signed chain;
- workspace, endpoint, sequence range, previous digest, signer generation, and public batch digest are verified;
- old batches remain independently verifiable after endpoint-key rotation;
- local states expose `empty`, `ready`, `acknowledged`, `quarantined`, and `blocked` honestly;
- the user-owned JSON export is signed by the current endpoint and independently verifies the complete included batch chain;
- private production receipts, acknowledgement receipt IDs, secrets, and local paths never enter the export;
- no network uploader is implemented.

The export and verification contract is documented in `docs/WORKSPACE_EVIDENCE_EXPORT_V1.md`.

### 5. Secure desktop runtime and explicit controls — implemented

- one Electron main-process runtime owns loaded signing and event-identity material;
- the OS-vault master key is zeroed immediately after initialization;
- private identity buffers are zeroed on runtime disposal;
- unsupported platforms or vault failures disable Workspace actions without plaintext fallback or blocking ordinary analytics;
- the canonical scanner lives in a separate bundle loaded lazily only after explicit production;
- opening the app or Workspace screen does not trigger scanner loading or evidence production;
- strict public DTOs expose only Workspace, endpoint, lifecycle, evidence, privacy, and bounded production counts;
- one zero-argument production action ignores renderer-supplied calls, paths, providers, costs, fingerprints, or evidence claims;
- pause, resume, production, batch, and export remain separate explicit actions;
- native export paths remain inside the main process;
- raw exceptions, private paths, canonical calls, and secret material never cross IPC.

The view shows:

- workspace identity and local-only status;
- endpoint identity, generation, platform, and software versions;
- reviewed evidence and signed-batch counts, quarantine, invalid records, and blockers;
- exact Overview usage and pricing coverage for the active scope;
- explicit Produce, Pause/Resume, Create signed batch, and Export actions;
- the latest bounded production counts;
- fail-closed unsupported-platform and unavailable-vault states.

`workspaceUsageFromOverview()` remains a field-for-field projection of the current Overview payload. Workspace evidence never recalculates calls, sessions, token dimensions, costs, pricing coverage, filters, or periods.

The runtime and renderer contracts are documented in:

- `docs/DESKTOP_WORKSPACE_RUNTIME_V1.md`;
- `docs/DESKTOP_REVIEWED_PRODUCTION_V1.md`.

### 6. Durable production lifecycle policy — implemented

- absent lifecycle state means production is active without creating a file;
- pause and resume use one strict, versioned, atomic private record;
- transitions are cross-process serialized, idempotent, and revisioned;
- state binds the stable Workspace and endpoint and survives endpoint-key rotation;
- malformed, cross-bound, or clock-regressing state fails closed;
- pause is checked before canonical scanning and evidence mutation;
- a pause requested during production waits for that complete atomic pass;
- pause never stops ordinary collectors/parsing, alters Overview analytics, changes pricing or labels, or deletes/signs/exports existing evidence;
- resume never deletes lifecycle history or rewrites evidence.

The detailed contract is documented in `docs/WORKSPACE_PRODUCTION_LIFECYCLE_V1.md`.

### 7. Deterministic recovery and closure — remaining

The remaining tranche must expose bounded, non-destructive recovery for known local failure states and validate the complete create → produce → pause/resume → batch → export → reopen path on the portable Windows artifact.

Recovery may reconcile or retry known state. It must never mean deletion, silent identity/lifecycle reset, quarantine bypass, invented evidence, or weakening of fail-closed checks.

## Privacy boundary

Workspace v1 may handle structured metadata needed to explain AI usage, such as:

- timestamp and period;
- tool/collector identity;
- model and source-recorded model provider when available;
- token dimensions and reasoning attribution where reviewed;
- API-equivalent or provider-metered cost with its immutable assignment;
- opaque event, endpoint, workspace, session, repository, or project references when explicitly permitted;
- evidence quality, version, coverage, and freshness.

It must not require or export:

- prompts or assistant responses;
- source code, patches, diffs, or file contents;
- credentials, provider keys, cookies, or tokens;
- unrestricted local paths;
- raw tool arguments or outputs;
- private production identities or acknowledgement receipts;
- unsupported inferences about people, productivity, or causality.

## Non-goals

- hosted synchronization or account creation;
- invitations, team roles, organization administration, or browser manager console;
- entitlement, billing, licensing, or commercial packaging;
- Android-side collection or pricing;
- remote command execution;
- Advisor or Bench implementation;
- collector rewrites, model-label cleanup, or aggregation redesign;
- automatic publication of private data.

## Acceptance gates

Workspace v1 is complete only when:

1. creating and reopening the local workspace is deterministic and crash-safe;
2. the existing endpoint identity is enrolled without generating a competing identity;
3. repeated production cannot duplicate reviewed events or signed batches;
4. unsupported collectors and insufficient evidence fail closed;
5. historical pricing, calls, sessions, token counts, model labels, source labels, and project labels remain unchanged;
6. the desktop view reconciles exactly with CLI/local analytics for the same scope;
7. exported workspace evidence verifies independently and contains no prohibited content;
8. pause affects only future Workspace production and resumes without data loss;
9. deterministic recovery never discards valid evidence or bypasses quarantine;
10. Windows and Ubuntu blocking tests pass, including Windows vault, filesystem, lazy bundle, renderer, and packaging behavior;
11. no hosted service is required to complete the flow;
12. the implementation remains divided into bounded, reviewable pull requests with rollback points.

## After Workspace v1

The next milestones are a trustworthy signed Windows release and physical desktop-to-Android validation. Managed synchronization, team workspaces, Advisor, and Bench follow only after this local workspace slice proves the contracts and user experience.
