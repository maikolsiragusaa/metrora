# Metrora architecture

A responsibility map for the public Metrora codebase. Read this before opening a non-trivial pull request.

## Product authority

The public repository is authoritative for local collection, parsing, normalization, pricing, analytics, evidence, Workspace contracts and user-owned export.

Metrora is local-first:

- AI traffic does not pass through Metrora;
- ordinary local use requires no account or remote service;
- prompts, responses, source code, patches, secrets and unrestricted local paths are not exported by default;
- settled historical cost assignments remain immutable;
- unavailable or uninspected evidence remains explicit rather than becoming a false zero.

## Data flow

```text
local AI-tool session stores
            ↓
collectors and provider parsers
            ↓
canonical normalized records, cache and pricing
            ↓
analytics, evidence and Workspace runtime
            ↓
CLI / Electron desktop / local web dashboard
            ↓
optional native companions and explicit exports
```

## Surfaces

### CLI — `src/`

The canonical command is `metrora`.

The CLI owns command routing and invokes shared domain modules for:

- provider discovery and parsing;
- canonical aggregation and date filtering;
- historical pricing and evidence classification;
- reports, exports and optimization findings;
- MCP stdio tools;
- endpoint, Workspace, batching and verification operations where applicable.

Temporary inherited command aliases remain compatibility entry points only. New documentation, artifacts and user-facing text use Metrora.

### Electron desktop — `app/`

The desktop application is the primary local graphical surface.

The Electron main process owns privileged work:

- execution of the bundled Metrora runtime;
- local filesystem and OS-vault access;
- endpoint and Workspace runtime authority;
- bounded inspection, production, recovery, batching and export actions;
- validation of external URLs and export destinations.

The preload bridge exposes a narrow typed API. The renderer runs with context isolation and no Node integration, consumes public DTOs and must not implement its own parser, pricing engine or evidence authority.

State orchestration, domain formatting and presentation are extracted into focused modules before a component or main-process module becomes oversized.

### Local web dashboard — `dash/`

The dashboard renders canonical local analytical payloads in a browser surface served from the user's machine. It does not own a separate data model.

### Native companions — `mac/`, `gnome/`, `android/`

- macOS and GNOME surfaces are lightweight local companions over the canonical CLI/runtime;
- Android is a companion foundation and does not own collection, pricing or evidence authority;
- inherited module names, UUIDs and storage paths may remain where migration would otherwise break installed state.

Compatibility identifiers are governed by [`TECHNICAL_IDENTITY_COMPATIBILITY.md`](TECHNICAL_IDENTITY_COMPATIBILITY.md), not treated as product branding.

## Collection and parsing

Provider adapters discover source records and emit normalized calls through shared parser contracts.

Key rules:

- source-present provider and model metadata is preferred over inference;
- deduplication uses canonical identities shared across providers;
- parser caches accelerate repeated reads but do not become independent truth;
- cache reconciliation preserves provenance and fails closed on contradictory records;
- provider-specific parsing remains isolated from product presentation.

New or changed provider adapters require fixtures, focused tests, provenance review and validation against representative records where possible.

## Pricing authority

Historical API-equivalent pricing is date-effective and evidence-aware.

- provider or client metered values are authoritative when available;
- explicit zero is distinct from unavailable pricing;
- subscription or proxy coverage is an overlay, not a rewrite of historical API-equivalent value;
- a later catalog update cannot silently change an already settled call;
- fallback behavior remains explicit and conservative.

Pricing logic belongs in shared domain modules, never in renderer components or packaging configuration.

## Local Workspace and evidence

Workspace v1 is endpoint-owned and works without a remote service.

The local runtime owns:

- protected endpoint identity and OS-vault material;
- local personal Workspace state and membership;
- reviewed measurement production;
- private receipts and append-only outbox publication;
- active and paused production lifecycle;
- truthful read-only evidence inspection;
- deterministic non-destructive recovery;
- Workspace-authorized signed batches;
- independently verifiable user-owned exports.

Opening the application may inspect evidence automatically, but recovery remains explicit and mutation-capable only when reconciliation is needed.

## Public contracts

Versioned contracts under `src/contracts/` define stable boundaries for endpoints, Workspaces, repositories, sharing, measurements and evidence.

Contract evolution requires:

- explicit versioning or compatible extension;
- validation at trust boundaries;
- migration and rollback analysis;
- privacy review;
- fixtures and conformance tests;
- no silent reinterpretation by another surface.

## Distribution integrity

Official desktop distribution is in preparation. Technical candidates remain engineering artifacts until an accepted official channel publishes them.

Distribution work preserves these boundaries:

- every artifact traces to reviewed public source;
- portable and installer formats derive from one canonical product payload where applicable;
- publisher and channel identity are exact rather than guessed;
- checksums, manifests and provenance are independently verifiable;
- installation, update and rollback preserve user-owned local state;
- technical validation artifacts remain visibly distinct from official releases;
- build, verification, publication and rollback remain separate responsibilities.

See [`WINDOWS_DISTRIBUTION.md`](WINDOWS_DISTRIBUTION.md), [`WINDOWS_FORMAT_DERIVATION_V1.md`](WINDOWS_FORMAT_DERIVATION_V1.md) and the Windows acceptance contracts.

## Security boundaries

- no shell interpolation for untrusted command arguments;
- no Node integration in the renderer;
- no remote content in privileged windows;
- no protected distribution credentials in untrusted pull requests;
- no raw user content or secret material in logs or reports;
- no destructive reset disguised as recovery;
- no deployment-time patching of product semantics or visual identity.

## Repository map

```text
src/       canonical collection, parsing, pricing, analytics, evidence and CLI
app/       Electron desktop application
dash/      local browser dashboard
android/   companion application foundation
mac/       native macOS menubar companion
gnome/     GNOME Shell companion
tests/     canonical core and integration tests
docs/      public contracts, architecture and release boundaries
scripts/   bounded build, validation, migration and release utilities
```

## Change discipline

Every substantial change identifies:

- the authority it modifies;
- the public contract or compatibility boundary involved;
- focused and full validation required;
- migration and rollback behavior;
- privacy and provenance impact;
- the public documentation that must remain accurate.

Prefer small independently revertible modules and pull requests. Do not solve architectural growth by raising size limits or moving unrelated responsibilities into another oversized file.
