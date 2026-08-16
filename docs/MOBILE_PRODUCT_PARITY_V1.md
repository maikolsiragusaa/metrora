# Mobile Product Parity V1 inventory and execution map

**Audit base:** `27c8ff03b07f51ad855b7e801454e051d2473e69` (`main`)

**Scope:** current Desktop/core product, local companion contracts and Android
Mobile Product Foundation V1 as implemented at the audit base. This document
is an implementation inventory, not a claim that the proposed slices are
already physically accepted.

## Product invariant

Metrora Mobile is a smartphone expression of the same Metrora product. The
Desktop/core path remains authoritative for collectors, parsers, provider and
route identity, pricing, historical accounting, evidence, Workspace state and
the Metrora Project registry. Android consumes bounded, versioned projections
over the authenticated local connection.

For the same Desktop identity, Metrora Project scope, effective period bounds
and trend granularity, factual values and coverage semantics must agree. A
mobile-specific card, drill-down or navigation arrangement may differ from
Desktop; it must not create a second accounting, history, Project or evidence
engine.

The audit used the actual renderer, Electron IPC, CLI, core/domain modules,
sharing contracts and Android sources. Navigation labels were treated as
claims to verify, not as evidence of functionality.

## Current Desktop product inventory

### Home / Overview

The Desktop Home surface is a live analytics consumer of `MenubarPayload`,
with a separate yield request for outcome analysis. Its shared controls are
period (`today`, `week`, `30days`, `month`, `all`, `lifetime`), custom date
range, provider, Claude configuration source where applicable, Metrora Project
scope and refresh.

Implemented product behavior includes:

- current cost, calls, sessions, token dimensions and cache reuse;
- month-to-date and projected-month figures, budget/status messaging and
  period comparisons;
- daily spend history, sparse-history normalization, average/peak/yesterday
  context, activity heatmap and trend tooltips;
- current model summaries from canonical model accounting, including cost,
  calls, shares and an exact `Other models` accounting remainder when named
  identity is unavailable;
- pricing coverage, estimated-cost indicators and data-quality warnings;
- most expensive sessions and top activities, with navigation to the full
  Sessions surface;
- decision facts for comparison, primary spend driver, data quality, warning
  and next action;
- savings from applied fixes and local-model counterfactual savings;
- a Git-correlated cost-per-outcome card when yield data is available;
- a Workflow card covering correction rate, median time to first edit and top
  reworked file when the required workflow signals exist;
- an explicitly experimental Efficiency diagnostics disclosure covering
  one-shot rate, cache reuse, retry tax and a composite workflow heuristic.

The Home payload also carries provider totals, project rollups, workflow,
optimization, model-efficiency, retry-tax, routing-waste, tool, skill,
subagent, MCP-server, pull-request and branch fields. Not every field is a
first-class visible Home widget, and not every field is safe or useful as a
mobile projection.

Important authority limitations found in code:

- Home's yield request currently does not include the selected Metrora Project
  scope and does not pass a custom range from the Overview component.
- Workflow and efficiency fields are derived workflow heuristics, not model
  quality or causal productivity measurements.
- Durable scoped history can retain cost/calls/sessions while lacking complete
  historical Project × model/token/category detail.

### Activity

#### Sessions

Desktop Sessions calls the canonical CLI report through Electron IPC with
period, provider, custom range and Metrora Project scope. It currently:

- loads a bounded initial view of 120 rows and adds more rows in 120-row
  increments;
- supports search over title, Project, session ID, models, provider and
  reasoning level;
- supports sorting by recent activity, cost, total tokens, calls, cache reuse
  and cost per million tokens;
- supports grouping by provider;
- shows session/project/source context, provider, models, timestamps, duration,
  calls, turns, token dimensions, cache reuse, cost and estimated-cost context;
- expands a row into bounded metadata and accounting detail;
- reports when historical totals exceed surviving session-detail rows.

The current renderer does not expose prompt/response bodies in the Sessions
surface. Session title and local path handling remain privacy-sensitive and
are not automatically suitable for a phone.

#### Pull Requests

Pull Request spend is an actual Desktop surface backed by session-layer
attribution in `sessions-report.ts` and the shared overview payload. It shows
PR URL, spend, date span, linked sessions, calls, models, folded subagent runs,
attributed versus unattributed spend and approximate/detail-unavailable
markers. A row expands into category/work breakdown when that evidence exists.

Pull Request attribution is scoped by the projects used to build the shared
overview payload, but it is not currently an independently versioned companion
contract.

### Analyze

#### Spend

Desktop Spend uses the scoped overview authority and `computeSpendFlow`.
Visible behavior includes daily spend by model, model-to-Project flow,
expandable Project rows with sessions/date/models/calls/cost, activity
categories, tools, MCP servers and subagents. It accepts provider, period,
custom range and Metrora Project scope.

#### Insights / Optimize

The current Insights label maps to `Optimize.tsx`. It has Opportunities,
Reverted work, Abandoned work and Quick fixes tabs. The read-only report shows
deterministic evidence-based findings, potential savings and token context,
with expandable explanations and copyable fixes. Yield rows show
productive/reverted/abandoned work with Project, commit, session and cost
context.

The CLI also has an explicit `optimize --apply` path. Applying configuration
fixes is a machine-local mutation with backup/journal/undo behavior; it is not
a mobile read action.

The current Optimize and yield IPC requests do not carry Metrora Project scope.
Yield also correlates sessions with the local repository/main branch and is
explicitly heuristic.

#### Models

Desktop Models has By model, By task and Audit lenses. The By model lens uses
canonical durable model accounting and model presentation. It can show cost,
calls, token dimensions, reasoning/cache semantics, cache reuse, total tokens,
throughput, active-time rates, cost per million, savings and expandable
delivery/economic rows for provider route, source, semantic variant, timing and
pricing context. It preserves `Other models` and partial/unavailable detail.

By task uses surviving session records and Audit compares raw/display token
fields with attributed cost and estimated markers. Models accepts Project
scope; the Audit path is not currently Project-scoped.

#### Compare

Desktop Compare selects two available model presentation rows and reports
observed usage, cost, calls, token dimensions, efficiency, editing categories,
workflow diagnostics and coverage context. Its renderer and Electron bridge
currently accept period/provider/model A/model B, but not Metrora Project
scope or custom range in the compare contract.

### Workspace / Control

Workspace is not a UI shell. The current Desktop implementation is a local
personal evidence/runtime product:

- status and inspection are read-only and expose a strict local snapshot;
- creation enrolls the existing endpoint identity into a personal Workspace;
- reviewed production scans canonical local parser/cache state and adds only
  source-present, reviewed measurements;
- production can be explicitly paused/resumed;
- recovery reconciles known interrupted local state without destructive reset;
- pending evidence can be signed into a batch;
- a verified user-owned evidence package can be exported;
- capability gates depend on evidence integrity, compatibility, pending state,
  production lifecycle and local runtime health.

The snapshot is marked `localOnly`. It includes endpoint identity, software
and collector versions, OS-vault state, evidence counts, lifecycle state,
privacy exclusions and capability reasons. The runtime uses OS-backed key
storage (Windows DPAPI or macOS Keychain where supported), and unsupported or
unavailable runtimes fail closed without a plaintext fallback.

Workspace creation, production, pause/resume, recovery, batch signing and
export are explicit mutations. They are not ordinary analytics and cannot be
made mobile-safe by copying the Desktop snapshot into Android. No bounded
Workspace companion projection exists at this base; capability discovery
correctly reports `workspace: unavailable` with `no-authority`.

### Projects

Desktop Project management is a real registry-backed control surface. Metrora
Projects are overlays over collector-owned Source Project facts. Desktop
supports:

- create with name, icon and color;
- rename and presentation editing;
- delete of the overlay only;
- assign and unassign stable Source Project IDs;
- inspection of safe Source Project labels, contributors and
  `historicalOnly` status;
- Project-scoped filtering throughout the supported analytics paths.

The canonical registry is `projects.v1.json`, with stable `mp_` Metrora
Project IDs and `sp_` Source Project IDs. CRUD is routed through the canonical
CLI/registry authority. Project operations do not rewrite telemetry, sessions,
history, pricing or evidence.

### Settings / product control

The current Settings surface contains these actual panes:

- General: theme, default period, refresh cadence, currency, daily budget and
  provider/config selections;
- Projects: the registry-backed Project management surface;
- Providers: detected provider usage/status;
- Model aliases: map unrecognized model names to priced canonical models;
- Pricing: local/per-model price overrides;
- AI plans: provider plan/budget configuration and detected quota/status;
- Devices: local identity, sharing state, discovered devices, paired-device
  usage and device removal;
- Export: CSV/JSON export to a user-selected local directory;
- Privacy & data: local-analysis, provider-key and consent-gated telemetry
  explanations.

These panes mix analytics, local configuration, credential-adjacent provider
state, filesystem actions and device administration. They do not all map to a
phone settings screen.

### Other actual product domains

The CLI/core also exposes `report`/`overview`/`status`, `export`, `devices`,
`share`, `identity`, `projects`, `models`, `sessions`, `spend`, `compare`,
`yield`, `optimize`, `audit`, `doctor`, `context`, `codex-tps`, `mcp`, `web`,
`menubar`, `act`, `guard`, configuration commands for aliases/pricing/plans/
proxy paths/model savings/currency, and a separate `sync` command family.

Some of these are alternate Desktop or terminal consumers of the same core
authority. Others are machine-local controls, experimental diagnostics,
collector hooks or separate product domains. They are included in the matrix
below so their absence from the five-destination mobile IA is intentional.

## Current Android Mobile Foundation inventory

| Foundation area | Implemented state at the audit base | Authority and parity assessment |
| --- | --- | --- |
| Home | Native Compose destination with cost hero, calls/sessions/tokens, period picker, cost trend, trend granularity, top models, pricing evidence, freshness and refresh. | Reads `CompanionUsageV1` plus Foundation V1. This is a truthful foundation slice and is final-capable for the bounded headline, not complete Desktop Home parity. |
| Activity | Native metadata-only session list, capped at 128 rows, with Project/Source Project, date, cost, source/route/brand/model facts and coverage/freshness notes. | Reads `MobileFoundationPayload.activity`. No prompt/response content is sent. It is a bounded foundation slice: no cursor paging, search/filter controls, PR activity or session drill-down yet. |
| Analyze | One native destination combines Models and Spend. Model rows carry cost and factual route/source/brand data; Spend shows cost/calls/sessions and trend. | Reads Foundation V1. Model token fields and accounting coverage are present in the DTO but are not yet a complete mobile presentation of Desktop Models. Compare, task/audit views, flow breakdowns and Insights are absent. |
| Workspace | Destination is visible and explicitly renders unavailable. | Capability discovery says `no-authority`; this is correct behavior, not a placeholder to activate without a contract. |
| Settings | Device card with Desktop identity/endpoint, connection details, remote revoke and local forget/re-pair. | Preserves local secure pairing semantics. It does not expose Project CRUD, provider configuration, pricing, export or Desktop diagnostics. |
| Project scope | Picker is available on Home, Activity, Analyze and Workspace; Settings is excluded. Catalog is fetched from `/api/v1/projects` and cached separately. | Android validates selections against the canonical Desktop catalog and sends the selected ID back to Desktop. It never creates a local registry or filters telemetry locally. |
| Pairing / device state | QR/discovery, mTLS, SAS comparison, Desktop approval, certificate-bound token, remote revoke, local forget, recovery and re-pair. | Security foundation from `#181` remains the authority. It is physically accepted only within the existing bounded local pairing/security scope, not as acceptance of all new product surfaces. |
| Offline / cached state | Encrypted Keystore-backed credentials, usage snapshot, Foundation snapshot and Project catalog; same Desktop/scope/period compatibility checks; cached notices. | Local cache is a projection cache only. Android does not recompute totals, infer identity or merge incompatible scopes. |
| Freshness | Domain freshness is represented as live/cached/unknown; retrieval and Desktop-generated timestamps are retained. | Semantics are present, but every new contract must preserve effective bounds and scope identity so cache coherence cannot depend on a display label alone. |
| Coverage | Complete/partial/unavailable states for activity, model, token, category and historical detail; partial numeric subtotals remain visible with explanatory copy. | Correctly preserves incomplete durable history. Missing detail is not rendered as zero. |
| Model brand / route / source | Desktop sends independent route/provider, brand and collector/source IDs. Android has reviewed labels and neutral fallbacks. | No provider/brand inference from model names. Unknown identity remains unavailable. |
| Other models accounting residual | Android parses and renders exact cost/call remainder as a neutral `Other models` row. | Correct factual residual; no invented model identity or token split. |

## Desktop to Mobile parity matrix

The class in the final column is exactly one of the allowed mission classes.
“Small contract extension” means the Desktop/core authority already exists
and the companion needs a bounded DTO/query addition. “Core prerequisite” means
the current Desktop consumer itself does not yet expose the required scope or
semantics safely.

| ID / product domain | Desktop capability, authority and current consumer | Current mobile state | Required bounded contract; ProjectScope; period/filter; coverage/freshness | Recommended smartphone UX | Class; prerequisite; proposed implementation PR |
| --- | --- | --- | --- | --- | --- |
| H1 Home headline | Overview metrics from `usage-aggregator.ts` → `MenubarPayload` and `/api/v1/usage`; Desktop `Overview.tsx`. | Implemented with `UsageSnapshot` and Foundation. | `CompanionUsageV1` is sufficient for cost/calls/sessions/tokens/cache/top models/trend. Scope must be `all`, `unassigned` or canonical `mp_…`; Desktop resolves effective bounds and granularity; preserve live/cached and complete/partial/unavailable. | Keep the cost hero, compact metric strip, one trend and top model cards. Make freshness/quality contextual rather than a permanent large status block. | **A. MOBILE PARITY NOW**; no core prerequisite; PR 5 convergence/acceptance. |
| H2 Home period and trend controls | Desktop supports presets, custom ranges and selectable global trend/history dimensions. | Presets and trend granularity are implemented; custom ranges are not exposed. | Existing server query accepts `from/to`, but Android protocol/state only models presets and period labels. A future bounded range contract should carry `effectiveFrom/effectiveTo` explicitly and bind cache to them plus scope/granularity. | Use a compact preset menu first; add a native date-range picker only if a bounded range contract is accepted. Do not reproduce Desktop top-bar controls. | **D. MOBILE-ADAPTED**; Android query/state extension; PR 5 unless promoted earlier by Analyze needs. |
| H3 Home provider/config scope | Desktop provider and Claude configuration selectors feed canonical aggregation. | Mobile requests all providers and has no provider/config selector. | Add an explicit provider/config query dimension to the companion contract, with Desktop-resolved effective scope and no inference from model names. Coverage must describe provider-filtered historical gaps. | Add a secondary filter sheet only when more than one factual provider/config scope is available; default to all. | **B. MOBILE PARITY AFTER SMALL CONTRACT EXTENSION**; extend query/DTO and cache key; PR 2. |
| H4 Home current intelligence | Overview decision facts use current payload fields: comparison, driver, pricing/data quality, warning and next action. | No equivalent decision-fact layer; Home shows the underlying factual cards. | Add a small bounded `home.intelligence` projection or additive fields. It must carry evidence labels, targets and quality, not opaque Desktop copy or a universal payload. Project scope, effective bounds and domain freshness must match the headline. | One “what matters” card with progressive disclosure into Activity or Analyze; show unavailable instead of a dead action. | **B. MOBILE PARITY AFTER SMALL CONTRACT EXTENSION**; define bounded decision facts; PR 5 after factual slices. |
| H5 Home outcome/workflow/efficiency intelligence | Git-correlated `yield`, workflow-insights and experimental efficiency fields are current Desktop diagnostics. | Not exposed. | Current yield/efficiency requests do not consistently carry Project scope or custom range. A truthful mobile contract requires a scoped core authority, methodology, confidence/coverage and explicit experimental labels. | Defer to a compact optional insight only after authority exists; never make it the Home headline or imply causal productivity. | **C. CORE AUTHORITY PREREQUISITE**; add project/range-aware bounded yield/workflow authority; PR 3. |
| A1 Activity session cards | `sessions-report.ts`, parser/cache and `MobileFoundationPayload.activity`; Desktop Sessions is the consumer. | Implemented as metadata-only, newest-first, max 128. | Existing Foundation fields are sufficient for a bounded page. Scope is canonical and period-bound; use partial when capped or when totals exceed surviving rows; freshness is domain-specific. | Retain cards, not a dense table. Tap opens a metadata/accounting sheet; never send or display prompt/response bodies, patches, source code or unrestricted paths. | **A. MOBILE PARITY NOW** for the bounded slice; no core prerequisite; PR 1 hardens it. |
| A2 Activity session scale and filters | Desktop supports search, sort, provider grouping, 120-row increments and rich metadata. | No paging/cursor, search, filter, sort or drill-down. | Add a versioned bounded sessions endpoint with opaque cursor, limit, `hasMore`, total/coverage, safe metadata detail, and filters for Project/provider/model/source/time. Desktop must apply filters before projection; cache keys include all effective dimensions. | Filter sheet plus chips; chronological list; cursor-driven “load more”; a focused session detail sheet. Keep totals/coverage separate from visible page count. | **B. MOBILE PARITY AFTER SMALL CONTRACT EXTENSION**; add cursor/filter projection; PR 1. |
| A3 Activity Pull Requests | `buildPrAttribution` / `sessions-report.ts` → shared Desktop overview; `PullRequests.tsx`. | Absent. | Add a bounded PR activity projection with URL, safe title/identifier policy, date span, attributed/unattributed cost, linked-session count, models and approximate/detail-unavailable markers. Apply Project scope and provider/period bounds at core. | Add Pull Requests as a segmented Activity view or filter, not a fifth destination. Expand a PR card into spend/work breakdown; external links remain optional. | **B. MOBILE PARITY AFTER SMALL CONTRACT EXTENSION**; add `activity.pullRequests` contract; PR 1. |
| N1 Analyze Spend summary | `MenubarPayload` / `MobileFoundationPayload.analyze.spend`; Desktop Spend and Home consumers. | Implemented as cost/calls/sessions and trend in Analyze. | Existing bounded spend DTO is sufficient. Project scope is canonical; period/granularity and live/cached freshness are carried; no missing trend bucket becomes zero beyond Desktop’s factual projection. | Keep summary at top of Analyze with a compact trend and tap-through to breakdown sections. | **A. MOBILE PARITY NOW**; no core prerequisite; PR 2 validates presentation. |
| N2 Analyze Spend flow and breakdowns | `computeSpendFlow` → Desktop Spend: model→Project flow, categories, tools, MCP, subagents and expandable sessions. | Only summary/trend. | Add bounded spend-flow DTO with bounded node/edge counts, Project IDs, model identities, categories and source/route facts. Preserve estimated/pricing/coverage markers; apply `all`/`unassigned`/`mp_…`, provider and effective range in core. | Progressive disclosure: summary → model/Project flow cards → category/tool details. Avoid a desktop Sankey or wide table. | **B. MOBILE PARITY AFTER SMALL CONTRACT EXTENSION**; project-scoped flow projection; PR 2. |
| N3 Analyze Models factual accounting | `model-accounting.ts`, `model-presentation.ts`, durable period aggregation → Desktop Models and current Foundation rows. | Bounded model cards show cost and provenance; token fields are parsed but not fully presented. | Foundation already carries bounded rows with cost, calls, token dimensions, route/source/brand, canonical identity/variant and accounting coverage/gap. Scope and historical detail coverage must remain explicit; preserve `Other models`. | Model cards with expandable token/cache/pricing details and neutral provenance fallback. Show partial/unavailable labels beside the affected detail, not as fake zeros. | **A. MOBILE PARITY NOW** for the bounded factual slice; no core prerequisite; PR 2. |
| N4 Analyze Models durable/task/audit detail | Desktop Models exposes By task, Audit, delivery/economic variants, timing, pricing and raw/display token comparisons. | Absent or reduced to model rows. | Add separate bounded model-detail contracts; do not put raw audit payloads in the general model card. Audit needs explicit Project scope or must remain all-scope. Durable history must identify which dimensions are complete/partial/unavailable. | Use model detail sheets and a task lens; keep Audit as an advanced disclosure. Do not build a mini desktop table. | **B. MOBILE PARITY AFTER SMALL CONTRACT EXTENSION**; extend model projections and scope audit; PR 2, with #184 remaining relevant. |
| N5 Analyze Compare | `compare-stats.ts` / CLI `compare` → Desktop Compare; Electron bridge currently accepts period/provider/model A/model B only. | Absent. | A mobile compare DTO needs a core-side Project-scoped compare query, explicit effective range, selected model presentation IDs, observed usage definitions, efficiency methodology and coverage. Current core consumer does not accept the required Project scope. | Two model cards, one comparison result, and expandable metric groups; let the user choose from models already factual for the selected scope. | **C. CORE AUTHORITY PREREQUISITE**; add Project/range-aware Compare authority before a companion contract; PR 3. |
| N6 Analyze Insights / Optimize read-only | `scanAndDetect` / `optimize.ts` and yield reports → Desktop Insights. | Absent. | A bounded findings DTO needs scoped core output, stable finding IDs, evidence, potential savings, quality/estimated markers and explicit heuristic methodology. Current IPC does not pass Project scope. | Optional compact findings list with “why” disclosure; no automatic apply action. | **C. CORE AUTHORITY PREREQUISITE**; add scoped read-only optimize/yield authority; PR 3. |
| N7 Analyze Optimize apply | CLI/act optimizer applies local configuration changes with backup/journal/undo. | Absent. | No mobile contract should expose the mutation in V1. | Link to Desktop-only guidance if ever needed; no remote execution or “apply” button. | **E. DESKTOP-ONLY**; machine-local mutation and filesystem authority; no Mobile Product Parity V1 PR. |
| W1 Workspace status/inspection | `desktop-workspace-runtime.ts`, Electron Workspace IPC and Desktop Workspace panels; strict local-only snapshot. | Explicitly unavailable with `no-authority`. | A future read-only projection would need a new core-owned contract with identity binding, safe status/capability/evidence counts, local-vs-remote semantics, freshness and no signing material. It must not be inferred from Desktop IPC types. | Keep the destination visible but honest while unavailable. If authority is later approved, use a read-only status card and evidence timeline, not actions. | **C. CORE AUTHORITY PREREQUISITE**; first define and review a remote-safe read-only projection; PR 4 is conditional. |
| W2 Workspace creation, production, lifecycle, recovery, batch and export | Local personal Workspace runtime, OS-vault identity, canonical reviewed production and user-owned export. | Absent. | No companion contract should carry private keys, local evidence, recovery controls or arbitrary export paths. | None in V1. Keep all actions on Desktop. | **E. DESKTOP-ONLY**; machine-local security and explicit mutations; no Mobile Product Parity V1 PR. |
| P1 Project catalog and Source Project membership | `project-registry.ts`, `project-scope.ts`, `/api/v1/projects`; Desktop Project Management. | Implemented read-only picker and cached catalog. | Current catalog projection is sufficient for selection and safe membership inspection. Use canonical `mp_`/`sp_` IDs, `historicalOnly`, contributors and registry status; catalog is not period data and has its own freshness. | Add a Settings Project browser with membership/source detail; keep the global picker compact. | **A. MOBILE PARITY NOW**; no core prerequisite; PR 5 improves presentation. |
| P2 Project CRUD and assignment | Canonical CLI/registry mutation methods and Desktop IPC: create, update, delete, assign, unassign. | No mutation UI or mobile write route. | Add authenticated, versioned, idempotent write endpoints or a bounded mutation command protocol. Return the updated registry/catalog; enforce one membership per Source Project, corrupt/read-only registry behavior and no telemetry/history mutation. | Native create/edit sheet, assignment list and destructive-delete confirmation. State clearly that only the overlay changes. | **B. MOBILE PARITY AFTER SMALL CONTRACT EXTENSION**; expose the existing registry authority safely; PR 5. |
| S1 Pairing and device security | Desktop share server, mTLS/SAS/approval, peer store and revoke; Android coordinator/store. | Implemented and security-foundation accepted. | Existing pairing/revoke contracts are sufficient. Preserve Desktop identity, certificate-bound token, local forget distinction and encrypted cache. | Keep Settings focused on connection state, identity details, Revoke and Forget; use explicit confirmations. | **A. MOBILE PARITY NOW**; no core prerequisite; PR 5/acceptance only. |
| S2 Mobile-native local controls | Desktop theme/default period/refresh/currency/budget controls and Android-native period/theme/cache behavior. | Android has native period and product settings surface but not all Desktop controls. | No Desktop accounting contract is needed for local presentation preferences. If a default period is persisted, it must only select the next query and never change authority. | Use phone-native settings for theme, refresh and cache policy; do not copy the Desktop Settings rail. | **D. MOBILE-ADAPTED**; Android-local implementation; PR 5. |
| S3 Provider config, aliases, pricing overrides, plans and quota | Desktop Settings/CLI/config files and provider quota readers. | Absent. | Safe mobile parity would require separate read/write authority for machine-local config, provider credentials/quotas and pricing overrides. The current companion API exposes none of these. | Keep on Desktop. A future read-only status card is a separate product decision, not V1 parity. | **E. DESKTOP-ONLY**; machine-local/provider-sensitive controls; no V1 PR. |
| S4 Export, diagnostics and device administration | Desktop export chooses a local directory; Devices scans local machines, sharing peers and paired usage; Privacy describes local boundaries. | Only connection controls are present. | Full export/device scan is not a bounded phone projection. A future safe diagnostic DTO would need an explicit allowlist and freshness, but no local path or remote mutation. | Keep export, local device scan and detailed diagnostics on Desktop; show only connection status on Android. | **E. DESKTOP-ONLY**; local filesystem/machine administration; no V1 PR. |
| O1 CLI/report/web/menubar alternate consumers | CLI reports, web dashboard and menubar installer consume Desktop/core authority. | Not represented as separate mobile destinations. | No new mobile contract is needed for their interactions; factual projections may reuse the same authority. | Do not reproduce CLI/web/menubar navigation. Link or hand off only where a safe external action is justified. | **E. DESKTOP-ONLY**; alternate machine-oriented consumers; no V1 PR. |
| O2 Specialized activity and controls | `context`, `codex-tps`, `mcp`, `doctor`, `act`, `guard`, provider hooks and related CLI surfaces. | Absent. | Each would need a separately bounded, privacy-reviewed contract; some are machine-local mutations or diagnostics. They do not belong in a universal Foundation dump. | Defer. Keep Activity/Analyze focused on high-signal factual usage and decisions. | **F. DEFERRED PRODUCT DOMAIN**; separate authority/product decision; no V1 PR. |
| O3 Branch attribution and low-level breakdowns | `byBranch` and detailed tools/skills/subagents/MCP fields exist in core payloads; not all are first-class Desktop destinations. | Absent except future Spend projection possibilities. | Only project-scoped bounded subsets with clear coverage should be added. Do not expose raw branch/path or low-level payload fields merely because they exist. | Defer branch as a separate mobile destination; disclose selected breakdowns inside Analyze only after PR 2 authority work. | **F. DEFERRED PRODUCT DOMAIN**; bounded subset may be revisited after Analyze. |
| O4 Sync command family | A separate `sync` CLI command family exists in the repository. | Absent. | No mobile relay, account, cloud sync or remote-sync contract is part of this mission. | No mobile surface. | **F. DEFERRED PRODUCT DOMAIN**; separate mission and authority review; no V1 PR. |

## Recommended final mobile information architecture

Keep the accepted five destinations. They are coherent smartphone groupings
and do not require nine Desktop navigation items:

1. **Home** — overview headline, current status, period/scope, one trend,
   pricing/coverage signal and a small number of decision cards. Home should
   route to Activity or Analyze rather than repeat their detail.
2. **Activity** — Sessions and Pull Requests as two views over chronological
   factual activity. Use cards, filters and drill-down; preserve metadata-only
   privacy bounds.
3. **Analyze** — Spend, Models and Compare as compact sections/lenses. Add
   Insights/Optimize-style findings only after scoped authority exists. Keep
   token breakdowns and `Other models` visible when factual, with coverage
   next to the affected detail.
4. **Workspace** — retain an explicit unavailable state until a bounded
   authority exists. If a future read-only projection is approved, it belongs
   here; production, signing, recovery and export remain Desktop actions.
5. **Settings** — pairing/device state, Project catalog/control, mobile-native
   presentation/cache settings and safe product controls. Do not mirror the
   Desktop Settings rail.

Project scope should be available consistently on Home, Activity and Analyze.
Workspace may show scope only if a future Workspace projection defines what
that scope means. Settings should manage Projects rather than use a global
analytics scope picker.

Period and filters should persist only when their exact semantic identity is
preserved: Desktop identity, effective bounds, granularity, Project scope,
provider/config dimension and contract version. A phone may use a bottom sheet,
chips, segmented controls and detail sheets; it should not render dense
Desktop tables or horizontal mini-desktop layouts.

## Authority and contract dependency map

```text
collector records / provider files
        ↓
Desktop parsers and normalization
        ↓
per-source cache + canonical history / durable daily rollups
        ↓
pricing + historical cost assignment + model presentation
        ↓
Project registry overlay + ProjectScope filtering
        ↓
usage-aggregator / sessions-report / spend-flow / compare / optimize / Workspace runtime
        ↓
bounded Desktop consumers and local companion projections
        ↓
mTLS/SAS-authenticated companion API
        ↓
Android parsers + encrypted projection cache + native UX
```

Current bounded contracts:

- `CompanionUsageV1` — Home totals, bounded model rows, exact accounting gap,
  pricing coverage and trend;
- `MobileFoundationPayload` — bounded Activity session metadata, Analyze model
  rows, Spend totals/trend, Project scope and explicit Workspace unavailability;
- `CompanionCapabilitiesV1` — factual capability/version/scope availability;
- `Companion Projects V1` — non-period Project catalog and safe Source Project
  membership facts;
- local mTLS/SAS/peer contracts — pairing, approval, token/certificate
  binding, revoke and local recovery.

Contract gaps to resolve in implementation order:

1. Activity cursor/filter/PR DTOs, with page coverage separate from historical
   accounting coverage.
2. Analyze Spend flow and bounded breakdown DTOs.
3. Provider/config and explicit effective-range dimensions where mobile needs
   them; current mobile is intentionally all-provider/preset-period.
4. Project-scoped Compare authority, followed by scoped Optimize/Yield
   authority. The companion must not paper over a Desktop IPC that lacks the
   requested scope.
5. Optional read-only Workspace authority review. No action contract is
   implied by this item.
6. Authenticated Project mutation protocol over the canonical registry.
7. Durable historical model/category authority tracked by #184.

Every projection must include or bind to:

- Desktop identity and contract version;
- canonical Project scope ID;
- effective period bounds and requested granularity;
- Desktop-generated timestamp and instance freshness;
- complete/partial/unavailable coverage for each detail dimension;
- factual provider/route/source/brand IDs without inference;
- exact residual accounting where named model identity is unavailable.

## Desktop-only capabilities

The following remain Desktop/core-owned for Mobile Product Parity V1:

- collectors, parsers, provider normalization and canonical history/cache
  maintenance;
- pricing resolution, historical accounting and model/category reconciliation;
- Workspace creation, reviewed production, pause/resume, recovery, signing and
  evidence export;
- OS-vault identity and local private evidence handling;
- local filesystem export, provider configuration, model aliases, price
  overrides, proxy paths and plan/quota configuration;
- machine/device discovery and removal, local diagnostics and collector scans;
- CLI/web/menubar interaction models and specialized CLI mutations;
- prompt/response content, source code, patches, tool arguments, secrets and
  unrestricted local paths.

Keeping these on Desktop is an authority boundary, not a statement that the
underlying product domains are unimportant.

## Deferred capabilities

The following are real current or possible product domains but are not part of
Mobile Product Parity V1 until their authority and UX are separately defined:

- Git-correlated outcome/workflow/efficiency intelligence without a scoped,
  methodologically explicit core projection;
- branch-level and low-level tool/skill/subagent/MCP exploration as a separate
  mobile destination;
- specialized context, throughput, guard, hook, diagnostics and action
  workflows;
- sync, remote relay, accounts, billing, subscription systems and provisioning;
- public Android distribution/signing and release work;
- historical backfill or mobile-side repair of incomplete model/category
  identity.

Deferred does not authorize Android to synthesize or approximate these values.

## Sequential implementation PR map

The inventory recommends vertical slices with overlapping authority work kept
sequential. These are future implementation PRs; this inventory branch must
not create them.

### PR 1 — Activity parity: Sessions and Pull Requests

- **Exact scope:** add bounded session paging/cursors, safe filters and
  metadata drill-down; add bounded Pull Request activity; keep the current
  128-row Foundation contract compatible while migrating Android to the new
  Activity projection.
- **Core/domain files likely involved:** `src/sessions-report.ts`,
  `src/usage-aggregator.ts`, `src/project-scope.ts`,
  `src/project-coverage.ts`, `src/sharing/mobile-foundation.ts`, new or
  adjacent `src/sharing/activity-contract.ts`, `src/sharing/share-server.ts`
  and `src/sharing/share-run.ts`.
- **Bounded contracts:** versioned `activity.sessions` page/detail DTO;
  versioned `activity.pullRequests` DTO; opaque cursor, limit, total/coverage,
  effective bounds, Project scope, provider/model/source/time filters and
  freshness. Do not expand Foundation into a Desktop dump.
- **Android surfaces:** Activity list, filter sheet, session detail sheet,
  Pull Requests view, coordinator query state and encrypted cache keys.
- **Tests:** core session/PR projection and scope tests; route/integration
  tests; privacy-bound tests; Android parser, cursor, filter, cache and
  presentation tests; same-scope stale/fresh tests.
- **Parity invariants:** Desktop and mobile agree on scope/bounds and factual
  totals; page truncation is marked partial; no prompt/response/body/path
  content; unknown brand/route/source remains unknown; PR attributed and
  unattributed spend is not silently summed.
- **Physical smoke:** existing local pairing plus live Desktop → Android
  Activity refresh, cursor continuation, Project switch, cached fallback and
  PR detail on a physically paired phone.
- **Explicitly out of scope:** prompt/response content, arbitrary session
  search over private content, Analyze, Workspace, Project mutations, cloud
  transport and public distribution.
- **Dependency:** this inventory; no dependency on #184 for safe metadata, but
  historical detail must retain current partial/unavailable semantics.

### PR 2 — Analyze factual parity: Spend and Models

- **Exact scope:** deliver mobile-native Spend breakdown and complete the
  bounded Models detail experience, including factual token/cache dimensions,
  pricing/estimated markers, route/source/brand disclosure and `Other models`.
- **Core/domain files likely involved:** `src/spend-flow.ts`,
  `src/model-accounting.ts`, `src/model-presentation.ts`,
  `src/usage-aggregator.ts`, `src/project-coverage.ts`,
  `src/sharing/mobile-foundation.ts`, `src/sharing/companion-contract.ts`,
  and new bounded Analyze DTO modules.
- **Bounded contracts:** `analyze.spend` flow/breakdown and
  `analyze.models` detail; bounded node/row limits, token/accounting coverage,
  estimated/pricing flags, scope, effective bounds, granularity and
  freshness. Add provider/config query only if the mobile filter is included.
- **Android surfaces:** Analyze sections, model detail sheet, Spend flow cards,
  filter sheet, coverage explanations and neutral residual row.
- **Tests:** core flow/model projection reconciliation; Project-scope durable
  coverage tests; contract route tests; Android parser round-trip, token
  semantics, brand/route/source and `Other models` tests; offline compatibility.
- **Parity invariants:** raw canonical totals are never recomputed on Android;
  named rows plus residual remain factual; incomplete history is not completed
  with zero; model name never supplies missing provider/brand identity.
- **Physical smoke:** paired live/cached Analyze refresh across All,
  Unassigned and named Project scopes; verify pricing partial and residual
  states on a phone.
- **Explicitly out of scope:** Compare, Optimize apply, prompt content, raw
  Audit dumps, Workspace and #184 implementation.
- **Dependency:** PR 1 contract/versioning conventions; current
  `CompanionUsageV1`/Foundation semantics remain backward compatible.

### PR 3 — Scoped Compare and bounded Insights authority

- **Exact scope:** first add the smallest core-side Project/range authority for
  Compare and read-only Optimize/Yield projections; then expose a bounded
  mobile Compare and optional evidence-labeled Insights slice. Keep Optimize
  mutations Desktop-only.
- **Core/domain files likely involved:** `src/compare-stats.ts`,
  `src/compare.tsx`/CLI compare path, `src/yield.ts`, `src/optimize.ts`,
  `src/usage-aggregator.ts`, `app/electron/main.ts`, bridge types and new
  sharing projection modules.
- **Bounded contracts:** explicit model presentation IDs, Project scope,
  effective bounds, observed metric definitions, coverage/methodology,
  stable finding IDs and potential savings. Separate heuristic fields from
  factual accounting. No universal report serialization.
- **Android surfaces:** Analyze Compare cards and, only if the authority is
  complete enough, a compact Insights section with no mutation controls.
- **Tests:** core same-scope Compare/Yield/Optimize reconciliation; project
  filtering; custom-range behavior; methodology/coverage tests; route and
  Android parser/UI tests; rejection of unscoped requests when scope is
  required.
- **Parity invariants:** Compare and Insights cannot silently fall back to All
  Projects; Git-correlation remains labeled heuristic; no “productive” claim
  is inferred from absent commits; unavailable is distinct from zero.
- **Physical smoke:** project switch and period/range change while Compare or
  Insights is open; verify cached scope does not display another scope.
- **Explicitly out of scope:** applying fixes, remote execution, Workspace,
  provider plan controls, cloud sync and any Android recomputation.
- **Dependency:** PR 2’s scope/effective-bounds conventions. This PR is
  blocked until the core authority changes are accepted; it cannot be solved
  only in Android or by adding fields to the old Foundation dump.

### PR 4 — Workspace authority decision and conditional read-only slice

- **Exact scope:** review and, only if approved, add a read-only bounded
  Workspace status projection. If the authority review rejects remote
  exposure, the implementation result is to keep the existing explicit
  unavailable capability and add no Android Workspace code.
- **Core/domain files likely involved:** `src/local-state/desktop-workspace-runtime.ts`,
  `src/local-state/workspace-capability-policy.ts`,
  `app/electron/workspace.ts`, `app/electron/workspace-register.ts`,
  `src/sharing/capability-contract.ts` and a new sharing projection module.
- **Bounded contracts:** status/capability/evidence-count projection only;
  Desktop identity binding, freshness, local-only marker, privacy exclusions
  and explicit unavailable reasons. Never expose private keys, signed batch
  material, arbitrary paths or action endpoints.
- **Android surfaces:** Workspace status/read-only evidence card only if the
  contract is accepted; otherwise retain the current unavailable surface.
- **Tests:** Workspace runtime and capability-policy tests; share auth/privacy
  tests; Android parser, unavailable fallback and identity-binding tests.
- **Parity invariants:** no Android mutation can create, produce, pause,
  recover, sign or export Workspace evidence; Desktop local-only semantics
  remain true; unsupported vault/runtime stays unavailable.
- **Physical smoke:** only if a projection is approved: paired status refresh,
  unavailable/runtime failure and cache identity checks. No production action
  is physically exercised from Android.
- **Explicitly out of scope:** all Workspace mutations, evidence export,
  remote execution, signing, recovery and any “active” placeholder.
- **Dependency:** PR 1–3 contract/security conventions; core authority review
  is a hard prerequisite. The expected outcome may be “no mobile slice in
  V1.”

### PR 5 — Projects and Settings mobile control parity

- **Exact scope:** improve the existing read-only Project catalog experience;
  add canonical Project CRUD/assignment only through an authenticated bounded
  write protocol; retain pairing/revoke/forget and add appropriate native
  presentation/cache controls.
- **Core/domain files likely involved:** `src/project-registry.ts`,
  `src/project-scope.ts`, `src/project-cli-commands.ts`,
  `src/sharing/project-catalog.ts`, `src/sharing/share-server.ts`,
  `app/electron/project-bridge.ts` and mutation tests.
- **Bounded contracts:** versioned Project mutation requests/responses with
  idempotence, registry status, stable IDs, safe source membership and
  explicit failure for corrupt/read-only registry. No telemetry/history
  mutation fields.
- **Android surfaces:** Settings Project browser, create/edit/assign sheets,
  delete confirmation, connection/device card and local-native settings.
- **Tests:** registry atomicity/CRUD/membership tests; authenticated route and
  authorization tests; Android coordinator/catalog/mutation/cache tests;
  corrupt registry and interrupted write cases.
- **Parity invariants:** one canonical registry; Android never creates a local
  Project; delete removes only overlay membership; source facts and history
  remain unchanged; current scope is revalidated after a mutation.
- **Physical smoke:** paired Project create/rename/icon/color/assign/unassign/
  delete, scope refresh and reconnect; verify Desktop sees identical registry
  and no analytics facts changed.
- **Explicitly out of scope:** provider configuration, pricing overrides,
  plans/quota, Desktop export, Workspace actions, remote sync and public
  Android release.
- **Dependency:** PR 1–3 stable scope/cache semantics; PR 4 only if Workspace
  status is included. Do not depend on Android-local state.

### PR 6 — Cross-surface parity, UX convergence and final acceptance

- **Exact scope:** reconcile Home/Activity/Analyze/Workspace/Settings behavior
  on smartphone, add shared scope/period/filter persistence where exact,
  standardize coverage/freshness/brand/source presentation and complete the
  final acceptance matrix.
- **Core/domain files likely involved:** only contract/version corrections
  found during acceptance, plus `src/sharing/*` compatibility tests; no new
  collector/parser/accounting engine.
- **Bounded contracts:** freeze versions and compatibility behavior; verify
  every domain has effective scope/bounds/granularity, freshness and coverage.
- **Android surfaces:** all five destinations, navigation handoffs and native
  touch flows.
- **Tests:** full focused core/sharing and Android unit suites for changed
  contracts; renderer/core reconciliation fixtures; accessibility/content
  bounds; offline/reconnect and stale-scope rejection.
- **Parity invariants:** same canonical values for same authority query; no
  dead buttons or unsupported routes; no hidden partial state; no provider or
  brand inference; no prompt/response leakage.
- **Physical smoke:** Windows Desktop plus a physically paired Android device:
  pairing/revoke/forget, all supported periods, Project scopes, refresh,
  offline cache, partial/unavailable coverage, Activity drill-down, Analyze
  navigation, and explicit Workspace unavailable/read-only behavior.
- **Explicitly out of scope:** merging this inventory branch, public
  distribution/signing, cloud/account work, #184 closure and unrelated website
  or CI changes.
- **Dependency:** PR 1–5 complete, or explicit documented decisions for any
  conditional/blocked slice.

## Known blockers and prerequisites

- Project-scoped Compare is not currently a Desktop/core or Electron bridge
  capability; mobile must wait for that authority rather than filtering a
  global report locally.
- Project-scoped Yield/Optimize/Workflow authority is incomplete. Current
  Desktop requests omit the Project scope, and yield depends on local git
  correlation.
- Activity pagination and Pull Request DTOs do not exist in the companion API.
- Spend flow and detailed Models views exceed the current bounded Foundation
  DTO, although their Desktop/core authorities exist.
- Workspace is local-only and mutation-capable; no safe companion projection
  is currently published.
- Project registry writes are canonical on Desktop/CLI but have no
  authenticated companion write endpoint.
- Durable historical model/category detail remains incomplete and is tracked
  by #184.

## Relationship to issue #184

Issue #184, “project scope: complete durable historical model/category
authority,” is a core history/authority issue, not an Android bug. It should
remain open and must not be weakened to make a mobile card look complete.

The accepted behavior remains:

- durable scoped cost/calls/sessions can be factual after raw session files
  expire;
- historical model/token/category detail may be `partial` or `unavailable`;
- `Other models` may carry an exact cost/call accounting remainder without
  invented identity;
- Android never rewrites telemetry, reconstructs a second accounting engine or
  turns missing detail into zero.

Resolving #184 can improve the completeness of the Project-scoped Analyze
Models and future category views. It should be consumed through the same
versioned Desktop projections and coverage fields. It is not required to ship
the bounded Home/Activity/Spend foundation slices, provided their incomplete
historical semantics remain visible.

## Inventory conclusion

The accepted five-destination IA is viable. Home, bounded Activity, bounded
Spend/Models, Project catalog inspection and pairing/device state have enough
authority for native implementation now. Full Activity scale, Spend detail,
Models detail and Project mutations need bounded contract extensions. Compare,
scoped Insights/Yield and any Workspace view require core authority work first.
Desktop-only controls and deferred domains should remain explicitly absent
from Mobile Product Parity V1.
