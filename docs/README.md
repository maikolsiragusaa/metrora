# Metrora documentation

Metrora is the local-first control center for AI-assisted development. Start with the product surfaces that let you observe Usage, Cost, Models, Projects and Activity; compare evidence; investigate with Advisor; and manage provider Capacity and explicit local controls without requiring a mandatory Metrora account or AI-traffic gateway.

This index separates user guidance, current product guarantees, public contracts and contributor-facing technical references.

## Use Metrora

- [Getting started](GETTING_STARTED.md) — install or build Metrora, run the first reports and understand the current distribution boundary.
- [CLI reference](CLI_REFERENCE.md) — public commands grouped by task.
- [BenchRunV1 local Ollama](BENCHRUN_V1_OLLAMA_LOCAL.md) — bounded synthetic runtime evidence from an explicitly selected local Ollama model.
- [Bench Core conformance v1](BENCH_TASK_PACK_V1.md) — bounded local conformance checks, model discovery, private history and factual comparison for Ollama.
- [Supported tools](SUPPORTED_TOOLS.md) — local collector coverage and evidence boundaries.
- [Provider discovery outcomes v1](PROVIDER_DISCOVERY_OUTCOMES_V1.md) — truthful success/empty/unavailable/failed/partial/cancelled semantics and never-lose cache publication rules.
- [Provider documentation](providers/) — source locations, formats, limitations and parser notes for individual integrations.

## Connect devices locally

- [Android companion foundation](ANDROID_COMPANION_FOUNDATION.md) — the accepted secure pairing foundation plus the implemented Mobile Product Foundation V1 and Activity Sessions/Pull Requests surfaces, Project scope and bounded Android limits; public Android distribution remains separate.
- [Mobile Product Parity V1 inventory](MOBILE_PRODUCT_PARITY_V1.md) — the current Desktop/core and Android inventory, parity matrix, authority gaps and sequential implementation plan audited from `main`.
- [Local companion API v1](LOCAL_COMPANION_API.md) — stable local HTTPS endpoints, capability discovery, Project scope and the content-minimal domain contracts used by first-party companions.

## Understand the product

- [Product principles](PRODUCT_PRINCIPLES.md) — stable local-first, privacy, evidence and portability commitments.
- [Architecture](architecture.md) — current responsibility and authority map for the public codebase.
- [Advisor public foundation](ADVISOR_PUBLIC_FOUNDATION.md) — read-only conversational investigation over bounded Metrora evidence, runtime/privacy boundaries, tests and license provenance.
- [ACT contract preparation 001](ACT_CONTRACT_PREP_001.md) — design-only action boundary, first local Bench proposal, mobile projection and OSS reuse notes; no executor is added.
- [Advisor contextual integration v1](ADVISOR_CONTEXT_INTEGRATION_V1.md) — factual-surface → Ask Advisor → contextual investigation scope handoff across supported Desktop surfaces.
- [Provider quota authority](provider-quota-authority.md) — canonical provider-reported Capacity semantics, freshness and separation from measured local usage or budgets.
- [Canonical history read projection v1](CANONICAL_HISTORY_READ_PROJECTION_V1.md) — shadow observation/activity identity and trusted daily-history boundary.
- [Canonical history shadow store v1](CANONICAL_HISTORY_SHADOW_STORE_V1.md) — removable content-addressed persistence and cross-refresh reconciliation.
- [Canonical history parity observer v1](CANONICAL_HISTORY_PARITY_OBSERVER_V1.md) — non-authoritative cache-to-shadow parity validation before snapshot publication.
- [CLI status C3 dual-read v1](CANONICAL_HISTORY_CLI_DUAL_READ_V1.md) — the bounded terminal consumer, exact parity gate and legacy fallback boundary.
- [Accounting and pricing](ACCOUNTING_AND_PRICING.md) — user-facing semantics for multidimensional pricing identity, evidence precedence, request conditions, durable totals and evidence-aware cost valuation.
- [Cost assignment v1](COST_ASSIGNMENT_V1.md) — immutable per-call assignments, provenance, bounded charges and settled-history compatibility.
- [Local pricing observations](LOCAL_PRICING_OBSERVATIONS.md) — private first-observed pricing evidence, deterministic/dynamic resolution and its history boundary.
- [Pricing history](PRICING_HISTORY.md) — generated reviewed rate history and date-effective records used by the accounting path.
- [Collector inventory v1](COLLECTOR_INVENTORY_V1.md) — generated technical inventory of registered collectors and signed-measurement eligibility.
- [Public contracts v1](PUBLIC_CONTRACTS_V1.md) — public schemas, signed-data behavior and compatibility commitments.
- [Technical identity compatibility](TECHNICAL_IDENTITY_COMPATIBILITY.md) — identifiers retained to protect local state and integrations.

## Local Workspace and evidence

- [Workspace v1](WORKSPACE_V1.md) — canonical current description of the local personal Workspace and its user-visible lifecycle.
- [Local endpoint identity and outbox v1](LOCAL_ENDPOINT_IDENTITY_AND_OUTBOX_V1.md) — protected identity, immutable local evidence records and signed batches.
- [Workspace production scope v1](WORKSPACE_PRODUCTION_SCOPE_V1.md) — trusted production window and historical-scope boundary.
- [Workspace evidence export v1](WORKSPACE_EVIDENCE_EXPORT_V1.md) — independently verifiable user-owned export.
- [Workspace recovery v1](WORKSPACE_RECOVERY_V1.md) — read-only inspection and explicit non-destructive recovery.
- [Reviewed event factory v1](REVIEWED_EVENT_FACTORY_V1.md) — provenance-gated projection of normalized calls into public measurement events.

Component references in this section explain bounded implementation responsibilities. They do not define product sequencing or a private roadmap; [Workspace v1](WORKSPACE_V1.md) is the current status authority.

## Distribution and releases

- [Windows distribution](WINDOWS_DISTRIBUTION.md) — canonical current Windows package, identity and publication boundary.
- [Windows Store package identity v1](WINDOWS_STORE_IDENTITY_V1.md) — assigned package identity and separate AppX/MSIX build boundary.
- [Windows Store local package test](WINDOWS_STORE_LOCAL_TEST_GUIDED.md) — bounded local installation/cleanup path, preserved RC10 → RC11 historical procedure and RC11 starting point for any separately selected future candidate.
- [Windows release candidate v1](WINDOWS_RELEASE_CANDIDATE_V1.md) — unsigned candidate manifest and independent verification contract.
- [Windows format derivation v1](WINDOWS_FORMAT_DERIVATION_V1.md) — one-payload portable and installer derivation.
- [Windows clean install v1](WINDOWS_CLEAN_INSTALL_V1.md) — isolated NSIS installation and state-preservation contract.
- [Windows interrupted upgrade recovery v1](WINDOWS_INTERRUPTED_UPGRADE_RECOVERY_V1.md) — deterministic interruption fixture and recovery contract.
- [Windows GitHub pre-release acceptance v1](WINDOWS_GITHUB_PRE_RELEASE_ACCEPTANCE_V1.md) — current unsigned technical-preview source, candidate, physical and publication gates.
- [Windows physical acceptance guided path](WINDOWS_PHYSICAL_ACCEPTANCE_GUIDED.md) — two-profile guided execution for the current candidate.
- [Windows physical acceptance R1.B.D](WINDOWS_PHYSICAL_ACCEPTANCE_R1BD.md) — historical `0.9.19` acceptance contract and evidence boundary.
- [Android public distribution v1](ANDROID_PUBLIC_DISTRIBUTION_V1.md) — source-bound direct APK contract, production-signing boundary and Founder-gated publication path.
- [Versioning](VERSIONING.md) — release-candidate and platform build-version authority.
- [Releasing Metrora](../RELEASING.md) — public release responsibilities and prohibitions.
- [Changelog](../CHANGELOG.md) — Metrora-originated public changes.

Historical and guided acceptance documents preserve reproducible public evidence for the source and artifact they name. They do not override the current release status in [Windows distribution](WINDOWS_DISTRIBUTION.md), [Versioning](VERSIONING.md) or the root [README](../README.md).

## Contribute safely

- [Contributing](../CONTRIBUTING.md) — contribution workflow and validation requirements.
- [Contributing pricing data](CONTRIBUTING_PRICING.md) — evidence, identity, interval, policy and fail-closed rules for reviewed pricing changes.
- [Security policy](../SECURITY.md) — private vulnerability reporting.
- [Third-party notices](../THIRD_PARTY_NOTICES.md) — required licences and component notices.
- [Brand policy](../BRAND_POLICY.md) — product identity and permitted brand use.

## Documentation rule

Public documentation explains current behavior, stable guarantees, known limitations, reproducible contracts and contribution requirements. Internal staffing, budgets, private infrastructure, unpublished commercial plans, milestone codes and product sequencing do not belong in this repository.
