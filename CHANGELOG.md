# Changelog

This file records Metrora-originated public changes. Required third-party notices and licence texts are maintained separately in [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md) and [`LICENSES/`](LICENSES/).

## Unreleased — post-RC11 development

**RC11 is the current published Microsoft Store baseline.** Everything in this section describes source development accumulated after the frozen RC11 Store line unless a separate distribution channel is named explicitly. This section does not select, authorize or imply a future Windows Store candidate or version.

### Correctness and reliability

- Hardened mutable SQLite reads around Metrora-owned point-in-time snapshots so producer WAL state can be observed without creating support files beside provider-owned databases.
- Corrected provider/accounting boundaries including Copilot OTel cache and reasoning semantics, Grok completed-turn usage, Codex model attribution, DeepSeek V4 date/time-effective pricing and named-period date semantics without rewriting unsupported historical evidence.
- Extended durable Project history with model/category detail while retaining fail-closed coverage and `Other models` reconciliation where identity is incomplete.
- Added bounded Electron progress watchdog behavior and strengthened provider discovery publication so failed, partial, unavailable or cancelled scans cannot be mistaken for factual empty state.

### Harness

- Added one read-only conversational Harness grounded in canonical Metrora evidence, with local Ollama and LM Studio runtimes plus direct-provider BYOK options that keep Metrora out of the inference traffic path.
- Added bounded planning, factual evidence atoms, streaming/cancellation and explicit hosted evidence-sharing consent while keeping deterministic Metrora surfaces authoritative for measurements and calculations.
- Added contextual launches from factual Desktop surfaces so the selected period/provider/Project scope is carried only where that originating surface actually owns it.
- Harness does not execute changes, autonomously route requests or create a second measurement authority.

### Capacity

- Established one provider-reported Capacity authority with explicit fresh, stale, unavailable, disconnected and rate-limited states instead of deriving quota from local usage.
- Expanded Capacity observations across Claude, Codex, GitHub Copilot, Kimi Code and Antigravity while keeping provider credentials/account identity out of product snapshots.
- Added a sanitized companion Capacity projection so Android can show current Desktop-observed limits without becoming an independent quota collector or authority.

### Bench

- Added bounded local Ollama runtime evidence, a versioned deterministic synthetic task pack, private retained history and compatibility-gated factual comparison.
- Added a Desktop Bench route while keeping the result scoped to what the selected pack actually proves; no global leaderboard, universal quality score or automatic winner is inferred.

### Share Card

- Added a privacy-safe local AI recap Share Card with an exact disclosure preview and local PNG export.
- Exact spend and Project name remain opt-in, and prompts, responses, repository identity, local paths, credentials and provider-account labels stay outside the card contract.

### Android and companion

- Advanced the public Android channel to the production-signed `0.1.0-alpha.3` GitHub pre-release while preserving earlier release evidence and the separate Google Play gate.
- Replaced the Android QR decoder dependency with on-device ZXing Core while preserving the existing local pairing authority and permission boundary.
- Added bounded Demo Mode and the Desktop-sourced Capacity module without turning Android into a second collection, pricing, history or evidence engine.

### Desktop product UX

- Simplified the Overview/Home measurement hierarchy around Cost, activity and mainstream Usage, with specialist token/pricing detail available through progressive disclosure.
- Clarified provider Capacity presentation around factual freshness, remaining/used percentages, reset boundaries and unavailable states.
- Added dedicated Harness and Bench product surfaces and preserved factual-surface → Ask Harness → contextual investigation as the conversational interaction model.

### Provider and discovery work

- Added explicit provider discovery outcomes and bounded concurrency while preserving deterministic output order and retained history across incomplete scans.
- Added privacy-bounded Doctor probe roots and a Hermes observation ledger for monotonic local evidence without introducing remote telemetry.
- Continued provider-specific parsing, pricing and attribution corrections under existing evidence/provenance boundaries.

### Future Store freeze boundary

- [#230](https://github.com/maikolsiragusaa/metrora/issues/230) is a **must-fix correctness/privacy gate before any future Microsoft Store freeze**: stale retained Capacity facts must not cross a confirmed provider credential/account identity change.
- [#203](https://github.com/maikolsiragusaa/metrora/issues/203), [#231](https://github.com/maikolsiragusaa/metrora/issues/231) and [#232](https://github.com/maikolsiragusaa/metrora/issues/232) remain progressive product/UX tracks rather than whole-issue blockers. Any slice included in a future candidate still requires its normal review and acceptance.
- No RC12, later release candidate or future Store package version is selected by this changelog.

## `1.0.0-rc.11` — Microsoft Store published update (current)

RC11 is the current published Windows Store source line, published by Vensent after Microsoft certification. Its public version authorities are:

- product/source line: `1.0.0-rc.11`;
- Desktop build version: `1.0.0.11`;
- Microsoft Store AppX identity version: `1.0.1.0`.

The accepted RC11 package carries the companion runtime used for local Android pairing and preserves the bundled CLI/runtime boundary required by the Store distribution. Development on `main` after this frozen line is not part of the published RC11 Store package merely because it exists in the repository.

RC10 remains immutable historical publication evidence. The historical RC10 entry below is intentionally retained in its release-time wording; current Store status is governed by RC11 and the current distribution/versioning documents.

## `1.0.0-rc.10` — Microsoft Store published line (frozen)

RC10 is the exact frozen source line for the live Microsoft Store
distribution published by Vensent. Post-RC10 development is separate from
the published package; any future Store update requires its own acceptance,
submission and publication decision.

### Source completeness and durable history

- Reconciled exact native-source accounting with durable historical totals so source expiration or cache eviction does not silently lose previously observed usage.
- Corrected provider identity, request-boundary and timezone reconciliation where those boundaries could change calls or token totals.
- Preserved estimated or otherwise non-native rows as explicit non-exact accounting rather than blending them into native-source evidence.
- Kept project, model, daily and filtered views conserved against their applicable durable accounting authority.

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
