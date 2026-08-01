# Workspace v1

**Status:** active product milestone; local state, reviewed production, signed batches, independent export, the secure desktop runtime boundary, and the focused desktop Workspace view are implemented. Explicit reviewed-production and lifecycle controls remain before the complete W1.D experience is closed.

Workspace v1 is the first usable layer above Metrora's device-centric local analytics. It turns the existing public contracts, endpoint identity, reviewed measurements, outbox, signed batches, and user-owned evidence export into one understandable local workspace experience.

This milestone is deliberately local-first. It does not require a Metrora account, hosted service, subscription, or remote manager console.

## User outcome

A person can:

1. create a personal workspace on the current computer;
2. see that computer enrolled as the first endpoint;
3. understand the local privacy boundary and current reviewed-evidence state;
4. generate durable reviewed measurements through the existing explicit producer and create signed batches without duplicating calls;
5. inspect workspace identity, endpoint status, evidence counts, pricing coverage, and canonical scoped usage in the desktop application;
6. export a verifiable workspace package before any cloud synchronization exists.

The ordinary local analytics experience remains available without creating a workspace.

## Existing foundations reused

Workspace v1 reuses rather than replaces:

- `WorkspaceV1`, membership, endpoint, repository, sharing, measurement, and evidence contracts;
- the canonical parser and normalized usage records;
- reviewed collector provenance profiles;
- historical per-call cost assignments and desktop/CLI pricing authority;
- durable endpoint identity protected by the operating-system vault where supported;
- the append-only reviewed measurement outbox;
- immutable signed measurement batches and acknowledgements;
- current cross-process leases and atomic publication primitives;
- the local companion API where a stable public DTO already exists.

No second collector, pricing engine, workspace schema, signer, or analytics database is introduced.

## Implementation slices

### 1. Local workspace state — implemented

- one personal workspace created explicitly by the user;
- one owner membership bound to the local subject;
- enrollment of the existing endpoint identity;
- atomic, versioned, recoverable local persistence;
- idempotent creation and reload;
- safe reconciliation after endpoint-key rotation;
- no silent conversion of existing local usage into shared workspace data.

### 2. Reviewed measurement production — implemented

- only collector paths already approved by the provenance registry can produce Workspace measurements;
- normalized calls pass through the existing reviewed-event factory;
- immutable historical cost assignments and evidence quality are preserved;
- private rotation-safe production receipts prevent duplication and repair interrupted publication;
- prompts, responses, source code, patches, secrets, tool arguments, and full local paths remain excluded;
- unreviewed or insufficient evidence remains local rather than becoming an invented claim.

### 3. Signed workspace batches and export — implemented

- only workspace-authorized reviewed events enter the signed chain;
- workspace, endpoint, sequence range, previous digest, signer generation, and public batch digest are verified;
- old batches remain independently verifiable after endpoint-key rotation;
- local states expose `empty`, `ready`, `acknowledged`, `quarantined`, and `blocked` honestly;
- the user-owned JSON export is signed by the current endpoint and independently verifies the complete included batch chain;
- private production receipts, acknowledgement receipt IDs, secrets, and local paths never enter the export;
- no network uploader is implemented.

The export and verification contract is documented in `docs/WORKSPACE_EVIDENCE_EXPORT_V1.md`.

### 4. Secure desktop runtime boundary — implemented

- one Electron main-process runtime owns the loaded endpoint signing and event-identity material;
- the existing OS-vault master key is zeroed immediately after initialization;
- private identity buffers are zeroed on runtime disposal;
- unsupported platforms or vault failures disable Workspace actions without opening a plaintext fallback or blocking ordinary analytics;
- strict public DTOs expose only workspace, endpoint, evidence, and privacy state;
- explicit create, batch, and export actions cross an isolated IPC bridge;
- native export paths remain inside the main process and the renderer receives only the filename and verification summary;
- raw exceptions, private paths, and secret material never cross IPC.

### 5. Focused desktop Workspace view — implemented

The first desktop view shows:

- workspace name and local-only status;
- active owner role;
- enrolled endpoint, identity generation, public fingerprint, platform, and software versions;
- reviewed evidence and signed-batch counts, state, quarantine, and blockers;
- usage totals read from the same canonical Overview payload and active period/provider/range/config scope used by the rest of the desktop;
- pricing coverage from that same payload;
- a clear explanation of what is excluded from export;
- explicit workspace creation, status refresh, signed-batch creation, and evidence export actions;
- fail-closed unsupported-platform and unavailable-vault states.

The Workspace runtime does not calculate analytics totals. `workspaceUsageFromOverview()` copies only the existing Overview fields displayed by the screen, so calls, sessions, token dimensions, costs, pricing coverage, filters, and periods reconcile by construction.

Opening the Workspace screen never scans, produces measurements, signs, exports, uploads, or publishes automatically. The view does not show empty enterprise concepts, invite flows, billing, cloud synchronization, Advisor, or Bench.

The runtime and renderer contract is documented in `docs/DESKTOP_WORKSPACE_RUNTIME_V1.md`.

### 6. Explicit production and lifecycle controls — remaining

The focused view does not yet expose the existing reviewed-measurement producer or a complete pause/recovery lifecycle. Those controls must remain explicit, bounded, and main-process owned. They must not create a second scan, analytics, pricing, or persistence path and must not imply hosted synchronization.

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
3. repeated scans cannot duplicate reviewed events or signed batches;
4. unsupported collectors and insufficient evidence fail closed;
5. historical pricing, calls, sessions, token counts, model labels, source labels, and project labels remain unchanged;
6. the desktop view reconciles exactly with CLI/local analytics for the same scope;
7. exported workspace evidence verifies independently and contains no prohibited content;
8. Windows and Ubuntu blocking tests pass, including Windows vault and filesystem behavior;
9. no hosted service is required to complete the flow;
10. the implementation is divided into bounded, reviewable pull requests with rollback points.

## After Workspace v1

The next milestones are a trustworthy signed Windows release and a physical desktop-to-Android validation. Managed synchronization, team workspaces, Advisor, and Bench follow only after this local workspace slice proves the contracts and user experience.
