# Workspace v1

**Status:** implemented and physically accepted on Windows.

Workspace v1 is the local-first evidence layer above Metrora's device analytics. It combines public contracts, endpoint identity, canonical normalized usage, reviewed provenance, private production receipts, signed batches and user-owned evidence export into one local Workspace experience.

It requires no account, remote service, subscription or manager console. Ordinary local analytics remain available without creating a Workspace.

## User outcome

A person can:

1. create a personal Workspace explicitly;
2. enroll the existing desktop endpoint identity;
3. understand the local privacy and evidence boundary;
4. explicitly produce reviewed measurements from source-present canonical usage;
5. pause and resume future production without stopping ordinary analytics;
6. create signed batches without duplicating calls;
7. inspect Workspace, endpoint, evidence, pricing coverage and scoped usage in the desktop application;
8. recover known interrupted local state without destructive reset;
9. export a verifiable evidence package;
10. close and reopen while preserving identity, lifecycle, evidence and signed-batch state.

## Canonical authority reused

Workspace v1 reuses:

- public Workspace, membership, endpoint, repository, sharing, measurement and evidence contracts;
- the canonical parser, per-source cache and normalized usage records;
- reviewed collector provenance profiles;
- historical per-call cost assignments and desktop/CLI pricing authority;
- durable endpoint identity protected by the operating-system vault where supported;
- private rotation-safe production receipts;
- the append-only reviewed measurement outbox;
- immutable signed measurement batches and acknowledgements;
- existing leases and atomic publication primitives;
- stable local companion DTOs.

No second collector, parser, pricing engine, Workspace schema, signer, analytics database or source cache is introduced.

## Local Workspace state

- creation is explicit;
- owner membership binds to the local subject;
- the existing endpoint identity is enrolled rather than replaced;
- persistence is atomic, versioned and recoverable;
- creation and reload are idempotent;
- endpoint-key rotation reconciles safely;
- existing local usage is not silently converted into shared evidence.

## Reviewed measurement production

- only collector paths approved by the executable provenance registry can produce measurements;
- normalized calls pass through the reviewed-event factory;
- immutable historical cost assignments and evidence quality are preserved;
- private receipts prevent duplication and repair interrupted publication;
- prompts, responses, source code, patches, secrets, tool arguments and full local paths remain excluded;
- unreviewed or insufficient evidence remains local instead of becoming an invented claim.

The canonical scanner uses the existing parser/cache authority. Candidates come only from complete per-source cache state whose source still exists. Source-less durable history is withheld rather than promoted into new evidence. Provider contradictions, malformed calls, incomplete cache and empty private identity fail closed.

Detailed contracts:

- [`CANONICAL_REVIEWED_PRODUCTION_ORCHESTRATOR_V1.md`](CANONICAL_REVIEWED_PRODUCTION_ORCHESTRATOR_V1.md)
- [`CANONICAL_REVIEWED_PRODUCTION_SCANNER_V1.md`](CANONICAL_REVIEWED_PRODUCTION_SCANNER_V1.md)

## Signed batches and export

- only Workspace-authorized reviewed events enter the signed chain;
- Workspace, endpoint, sequence range, previous digest, signer generation and public batch digest are verified;
- old batches remain independently verifiable after endpoint-key rotation;
- local states expose `empty`, `ready`, `acknowledged`, `quarantined` and `blocked` honestly;
- the user-owned JSON export verifies the complete included batch chain;
- private receipts, acknowledgement identifiers, secrets and local paths never enter the export;
- no network uploader is required.

See [`WORKSPACE_EVIDENCE_EXPORT_V1.md`](WORKSPACE_EVIDENCE_EXPORT_V1.md).

## Secure desktop runtime

- the Electron main process owns loaded signing and event-identity material;
- vault master-key and private identity buffers are zeroed after use;
- unsupported platforms or vault failures disable Workspace actions without plaintext fallback or blocking ordinary analytics;
- the canonical scanner is loaded lazily after explicit production;
- opening the application or Workspace view does not produce evidence;
- opening performs read-only inspection before counts or actions become authoritative;
- strict public DTOs expose only bounded Workspace, endpoint, lifecycle, evidence, privacy and production state;
- the renderer cannot supply calls, paths, providers, costs, fingerprints or evidence claims;
- pause, resume, production, recovery, batch creation and export remain separate explicit actions;
- native export paths remain inside the main process;
- raw exceptions, private paths, canonical calls and secrets never cross IPC.

The desktop view exposes Workspace and endpoint identity, evidence and batch state, canonical scoped usage, privacy boundaries and explicit lifecycle actions. `workspaceUsageFromOverview()` remains a field-for-field projection of the current Overview payload and does not recalculate analytics.

Detailed contracts:

- [`DESKTOP_WORKSPACE_RUNTIME_V1.md`](DESKTOP_WORKSPACE_RUNTIME_V1.md)
- [`DESKTOP_REVIEWED_PRODUCTION_V1.md`](DESKTOP_REVIEWED_PRODUCTION_V1.md)

## Production lifecycle

- absent lifecycle state means active for compatibility;
- pause and resume use one strict, versioned and atomic private record;
- transitions are serialized, idempotent and revisioned;
- lifecycle state binds the stable Workspace and endpoint and survives key rotation;
- malformed, cross-bound or clock-regressing state fails closed;
- pause is checked before scanning and evidence mutation;
- a pause requested during production waits for the atomic pass to finish;
- pause never stops ordinary analytics, rewrites pricing or labels, or deletes existing evidence;
- resume never deletes lifecycle history or rewrites evidence.

See [`WORKSPACE_PRODUCTION_LIFECYCLE_V1.md`](WORKSPACE_PRODUCTION_LIFECYCLE_V1.md).

## Recovery and physical closure

- recovery is explicit and mutation-capable; opening and inspection remain read-only;
- known interrupted receipt publication is reconciled without replaying historical production;
- malformed, conflicting, invalid, quarantined or blocked state fails closed;
- recovery never deletes valid evidence, resets identity or lifecycle, bypasses quarantine or invents measurements;
- create, produce, pause/resume, recover, batch, export and reopen paths are covered by blocking tests;
- the ordinary Windows candidate was independently verified and accepted on physical profiles;
- portable reopen, clean install/removal, upgrade, repair, rollback, re-upgrade and user-owned state preservation passed;
- public acceptance evidence contains only bounded status, version, platform and integrity information.

## Privacy boundary

Workspace v1 may handle structured metadata needed to explain AI usage, including timestamps, tool identity, model, source-recorded provider, reviewed token dimensions, immutable cost assignment, opaque references and evidence quality.

It does not require or export:

- prompts or assistant responses;
- source code, patches, diffs or file contents;
- credentials, provider keys, cookies or tokens;
- unrestricted local paths;
- raw tool arguments or outputs;
- private production identities or acknowledgement receipts;
- unsupported inferences about people, productivity or causality.

## Non-goals

- mandatory remote synchronization or account creation;
- invitations, organization administration, entitlement or billing;
- remote command execution;
- unrelated product initiatives;
- collector rewrites, model-label cleanup or aggregation redesign;
- automatic publication of private data.

## Acceptance result

Workspace v1 passed its defined gates:

1. local creation and reopen are deterministic and crash-safe;
2. the existing endpoint identity is reused;
3. repeated production cannot duplicate reviewed events or signed batches;
4. unsupported collectors and insufficient evidence fail closed;
5. historical pricing, calls, sessions, tokens and labels remain unchanged;
6. desktop and CLI reconcile for the same scope;
7. exported evidence verifies independently and contains no prohibited content;
8. pause affects only future production and resumes without data loss;
9. recovery is deterministic and non-destructive;
10. Windows and Ubuntu blocking tests pass, including vault, filesystem, lazy-bundle, renderer and packaging behavior;
11. the complete flow works without a server;
12. physical Windows acceptance passed for the bounded unsigned engineering candidate.
