# Metrora Android companion foundation

**Current status:** the local Android companion is implemented in the public source tree. The QR pairing, SAS approval, mutual TLS, certificate pinning, Android Keystore storage, offline cache, revoke, forget and re-pair behavior are the accepted `#181` foundation. Foundation V1 adds the bounded mobile product surfaces described below; it is not a public Android store release.

Metrora Mobile is the smartphone expression of the same Metrora product. Desktop/core remains authoritative for collection, parsing, provider normalization, canonical history, pricing/accounting, evidence and Workspace identity. Android consumes projections and does not become a second collector, parser, pricing engine, history engine or evidence engine.

## Product and Project scope

The user-created **Metrora Project** is an overlay above one or more observed **Source Projects**:

- a Source Project is the repository/working-directory identity observed by the existing collectors;
- a Metrora Project is a stable user-owned grouping that can contain many Source Projects;
- an unassigned Source Project remains explicitly **Unassigned**;
- deleting a Metrora Project deletes only the overlay membership, never sessions, evidence or Source Projects.

Desktop owns create, rename, delete, assign, unassign and presentation editing. Android V1 reads the same Project `id`, `name`, `icon` and `color` and lets the user select `All projects`, `Unassigned` or a named Project. Android editing is intentionally not duplicated in this foundation.

The registry is a versioned JSON file named `projects.v1.json` beside the normal Metrora config. Writes use a temporary file followed by an atomic rename. The reader validates kind, version, stable IDs, timestamps, curated icon/color tokens and one-membership-per-Source-Project. An unrecognizable current file is reported as corrupt, used as an empty read-only overlay, and never overwritten automatically; observed Source Projects remain available. The only migration accepted in V1 is an unversioned legacy `projects` envelope with deterministic IDs.

Source identity is a SHA-256-derived ID over the normalized canonical observed project path. Durable historical rollups without a path use a separate factual `historical:<cached-project-key>` namespace; they are surfaced as `historicalOnly` Source Projects and never silently equated with a live Source Project that happens to share its display name. Session `workingDirectory` remains provenance and is not silently converted into membership. A path move, provider record with no path, or two genuinely different roots can therefore create separate Source IDs; the user can explicitly assign them to the same Metrora Project. Display name, icon and color are never identity or membership keys.

## Pairing and secure local transport

The app creates an EC client identity in Android Keystore and presents its certificate during mutual TLS. Discovery verifies that the certificate fingerprint advertised by Desktop equals the fingerprint observed during the TLS connection. Android and Desktop derive and display the same six-digit SAS; the Desktop owner must approve the request after comparing the complete code.

After approval, the Desktop fingerprint is pinned for subsequent operations. The bearer token is accepted only with the same client certificate fingerprint. The QR payload contains connection information only; it does not grant access and is followed by discovery, SAS comparison and Desktop approval.

Remote revoke is confirmed by Desktop before local credentials and cache are cleared. **Forget on this phone** is separate and does not claim to revoke the Desktop credential. Existing offline/reconnect, force-stop/reboot persistence, local recovery and re-pair behavior from `#181` remain in place.

## Foundation V1 capabilities

Android performs authenticated capability discovery before exposing domain surfaces. The current Desktop advertises:

- Home / Usage;
- Projects;
- Activity / Sessions (additive paged Activity contract);
- Activity / Pull Requests (same Activity destination);
- Analyze / Models;
- Analyze / Spend;
- Device / Settings;
- Workspace as **unavailable** because no bounded public Workspace mobile projection exists yet.

`CompanionUsageV1` remains the bounded compatibility contract for Home totals and trend data. Its additive `scope` and `quality.projectDetailCoverage` fields identify the selected Project and distinguish complete, partial and unavailable historical model/token/category detail. The separate Foundation V1 contract remains backward-compatible for older companions. Current Android Activity uses additive `activity.sessions` and `activity.pullRequests` projections: cursor-paged metadata-only session cards, bounded session detail, Pull Request summaries/detail and canonical provider/route/model filters plus a Source Project ID filter. Provider (`call.provider`), route (`modelProvider`), model and Source Project identity are independent; Android displays a safe Source Project label while sending the stable `sp_...` ID. Prompts, assistant responses, source code, patches, tool arguments, secrets, session titles derived from content and unrestricted filesystem paths are not sent to Android.

Models and Spend use the same Desktop accounting/history authorities and selected Project/period scope. Model brand, route/provider and collector/source are separate facts. Android uses Desktop-provided IDs and reviewed labels; it never infers a source or provider from a model display name and never renders an unknown raw internal ID in ordinary consumer UI.

The active Android IA is:

`Home · Activity · Analyze · Workspace · Settings`

Home preserves the accepted period selector, trend granularity, freshness, connection/cache state and factual accounting. Activity is a native Sessions/Pull Requests destination with progressive disclosure, opaque cursor continuation, safe filters and metadata-only detail. Analyze contains Models and Spend/trend. Workspace is shown as explicitly unavailable from capability discovery. Settings preserves pairing, security, cache, revoke, forget and device behavior.

## Local storage and offline behavior

Pairing credentials, the canonical `CompanionUsageV1` snapshot, the bounded Foundation cache and the Activity page/detail cache are encrypted with AES-GCM using a key held in Android Keystore. Activity cache keys bind Desktop identity, canonical Project scope, period/effective bounds, filters, ordering and cursor/page identity. The caches are additive and independently parse-validated. A corrupted Activity or Foundation cache is discarded without discarding valid pairing credentials or the usage snapshot. A cache from a different Desktop identity or incompatible query is ignored. Android backup and device-transfer export remain disabled for application state.

When Desktop is unreachable, Android keeps showing the last valid encrypted usage snapshot and marks it cached. It also retains already fetched Activity pages and bounded detail, never synthesizes missing pages and never presents cached rows under a different scope or filter query. A Foundation fallback is used only when its Desktop identity, Project scope and period are compatible with the usage snapshot being shown; otherwise the prior coherent state is kept or the Foundation surface is explicitly unavailable. Android does not synthesize totals from presentation metadata, and historical Project/session detail is never represented as factual zero.

## Validation and accepted scope

The repository contains Android unit coverage for protocol paths, capability negotiation, Foundation and Activity parsing/round-trip, opaque cursor/query binding, privacy bounds, Project scope selection, pairing, cache recovery, revoke and local forget. The existing physical acceptance is the bounded Windows↔Samsung local pairing/security/persistence scope from `#181`; Activity parity still requires the physical smoke matrix in the implementation handoff before being described as physically accepted.

The foundation does not add cloud relay, accounts, remote access, managed service behavior, billing, background push, a mobile gateway, mobile-side provider parsing/pricing, remote execution or Workspace authority.

The broader current-product inventory and bounded execution map is maintained
in [Mobile Product Parity V1 inventory](MOBILE_PRODUCT_PARITY_V1.md). It is the
source for deciding which Desktop capabilities can be projected safely and
which remain partial, blocked, Desktop-only or deferred.
