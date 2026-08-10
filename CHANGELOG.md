# Changelog

This file records Metrora-originated public changes. Required upstream provenance and licence notices are maintained separately in [`UPSTREAM.md`](UPSTREAM.md), [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md) and [`LICENSES/`](LICENSES/).

## Unreleased — current source line `1.0.0-rc.9`

RC9 is the current source/pre-submission candidate. It is not yet a Microsoft Store submission, certification or publication.

### Accounting reconciliation

- Made the desktop Models surface lead with the same durable historical model accounting used by Home, while keeping call-level/token/task information from surviving source sessions as explicitly narrower detail.
- Kept source-only task attribution available without presenting it as complete lifetime history after original session files expire.
- Made Overview expose any model-history tail omitted by presentation-sized daily top-N lists as an explicit `Other models` remainder so the table reconciles to the durable daily headline instead of silently dropping spend or calls.
- Preserved provider/session parsing, deduplication and historical pricing authority; the reconciliation does not force Metrora totals to match a different product's current-price valuation.

### Windows Store runtime

- Sealed the packaged CLI and its normal production dependency closure inside a dedicated `cli.asar`, so scoped npm paths such as `@scope/package` are not exposed to AppX path rewriting.
- Kept only a tiny stable launcher outside the archive; no loose CLI `node_modules` tree is shipped.
- Strengthened the existing Store-package workflow to execute the CLI from the extracted AppX layout with the packaged Electron runtime, verify read-only accounting JSON startup, reject loose CLI `node_modules`, and reject percent-encoded scoped-package paths.
- Kept the Store candidate unsigned, non-publishing and bound to the existing assigned Store identity.

### RC8 foundation retained

- Retained the assigned Microsoft Store AppX identity and non-publishing x64 Store-package workflow with exact artifact/source binding.
- Retained bounded local AppX acceptance that test-signs only a copy, verifies launch/local collection/no-external-Node behavior and removes the temporary package/certificate/private key afterward.
- Retained Windows PowerShell 5.1-compatible physical-test platform detection.
- Retained persisted Workspace endpoint software reconciliation to the current packaged Metrora/collector version without replacing endpoint identity, membership or evidence history.
- Retained Store-facing product identity cleanup, canonical Metrora local paths, sync credential adoption and public-identity regression checks introduced on the RC8 source line.

## `1.0.0-rc.7` — published unsigned Windows technical preview

RC7 was published as an **unsigned Windows x64 GitHub technical preview**. It remains manually updated, is not Microsoft Store certified and is not the stable `1.0.0` release. Its release assets and evidence remain bound to their exact published source and are not rewritten by later source work.

### Product identity and public documentation

- Canonicalized CLI help, usage examples, diagnostics and default export names around the `metrora` command while preserving versioned compatibility schemas and markers.
- Completed public provider-guide coverage for all 38 registered local collectors and corrected stale inventory metadata without changing evidence approval.
- Established Metrora™ as the product identity, Signal Grid™ as the canonical visual identity and Vensent™ as the publisher identity.
- Established the independent `1.0.0-rc.N` candidate line while preserving `0.9.19` as an immutable historical source and migration baseline.
- Separated the project MIT licence from the preserved upstream notice.
- Added a source-first getting-started guide, task-oriented CLI reference and public documentation index.
- Added a truthful supported-tools matrix that separates local analysis from signed Workspace eligibility.
- Added a functional product-lineage document distinguishing inherited foundations, material Metrora changes and compatibility boundaries.
- Reduced public documentation to current product behavior, stable principles, known limitations and verifiable release status.
- Added public contribution, issue and pull-request hygiene guidance.
- Added canonical copyright, licence, publisher and repository metadata for public product surfaces.

### Accuracy and durable history

- Added trusted complete-watermark requirements for daily cache publication.
- Reconciled project and exclusion filters across durable headline totals, history, provider intersections and project breakdowns.
- Preserved unattributed historical totals without inventing project, model, token or category splits.
- Preserved project names that coincide with JavaScript prototype properties.
- Added content-addressed Optimize result-cache identities so different datasets or date scopes cannot reuse a shape-only cached result.

### Provider and compatibility corrections

- Corrected RFC 8785 negative-zero canonicalization according to the verified technical erratum.
- Made mutable SQLite source fingerprints aware of write-ahead-log state where required.
- Corrected legacy Kiro input accounting while preserving bounded display previews and provider-scoped cache invalidation.
- Resolved Kimi model identifiers with final context-capacity tags without changing the raw observed identifier.
- Expanded Cline discovery across supported VS Code stable, Insiders and VSCodium storage variants with cross-root deduplication.

### Desktop

- Made scope controls and keyboard shortcuts truthful for the active platform and report.
- Extracted desktop scope, shortcuts, provider prefetch, telemetry and daily-budget presentation from the application shell.
- Preserved existing analytics, pricing, evidence and local-state authority during the extractions.
- Established a decision-led Home and navigation hierarchy while retaining direct access to existing reports.
- Improved dense-report terminology, keyboard access and distinctions between zero, unknown, unavailable and unpriced states.

### Local Workspace

- Implemented explicit local personal Workspace creation using the existing protected endpoint identity.
- Added reviewed measurement production, durable pause and resume, deterministic non-destructive recovery, signed batches and independently verifiable evidence export.
- Kept opening and inspection read-only, with unknown evidence state shown as indeterminate rather than false zero.
- Preserved ordinary local analytics without requiring a Workspace or remote service.
- Added a generated collector inventory that keeps local collector usefulness separate from fail-closed signed-sharing approval.

### Windows candidate integrity

- Bound Windows candidates to reviewed public source, canonical payload inventories, manifests and independent post-download verification.
- Derived portable and installer formats from one canonical application payload.
- Validated clean installation, removal, upgrade, repair, controlled rollback, interruption recovery and user-owned state preservation.
- Completed bounded physical Windows keyboard, scaling, theme, reduced-motion and Narrator acceptance for the unsigned engineering candidate.
- Added physical-acceptance report v2 with an explicit migration baseline and candidate-derived transitions while preserving historical report v1 verification.
- Added a public unsigned GitHub pre-release acceptance contract and version-scoped `1.0.0-rc.7` preparation/publication record.

## 0.9.19 — Metrora public source baseline

- Introduced the Metrora-branded public source tree from the reviewed historical 0.9.19 baseline.
- Preserved local-first multi-tool collection, CLI, desktop, dashboard, pricing, export and compatibility behavior while establishing an independent product identity and development history.
- Retained temporary compatibility identifiers where immediate removal would break local state, packaging or integrations.

This source baseline is not itself a claim that an official signed desktop release was published.
