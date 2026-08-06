# Metrora documentation

This index separates user guidance, current product guarantees, public contracts and contributor-facing technical references.

## Use Metrora

- [Getting started](GETTING_STARTED.md) — build from source, run the first reports and understand the current distribution boundary.
- [CLI reference](CLI_REFERENCE.md) — public commands grouped by task.
- [Supported tools](SUPPORTED_TOOLS.md) — local collector coverage and evidence boundaries.
- [Provider documentation](providers/) — source locations, formats, limitations and parser notes for individual integrations.

## Understand the product

- [Product principles](PRODUCT_PRINCIPLES.md) — stable local-first, privacy, evidence and portability commitments.
- [Product lineage](PRODUCT_LINEAGE.md) — inherited foundations, material Metrora changes and compatibility identifiers.
- [Architecture](architecture.md) — current responsibility and authority map for the public codebase.
- [Canonical history read projection v1](CANONICAL_HISTORY_READ_PROJECTION_V1.md) — shadow observation/activity identity and trusted daily-history boundary.
- [Canonical history shadow store v1](CANONICAL_HISTORY_SHADOW_STORE_V1.md) — removable content-addressed persistence and cross-refresh reconciliation.
- [Pricing history](PRICING_HISTORY.md) — date-effective rates, settled assignments and historical-cost behavior.
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
- [Windows release candidate v1](WINDOWS_RELEASE_CANDIDATE_V1.md) — unsigned candidate manifest and independent verification contract.
- [Windows format derivation v1](WINDOWS_FORMAT_DERIVATION_V1.md) — one-payload portable and installer derivation.
- [Windows clean install v1](WINDOWS_CLEAN_INSTALL_V1.md) — isolated NSIS installation and state-preservation contract.
- [Windows interrupted upgrade recovery v1](WINDOWS_INTERRUPTED_UPGRADE_RECOVERY_V1.md) — deterministic interruption fixture and recovery contract.
- [Versioning](VERSIONING.md) — release-candidate and platform build-version authority.
- [Releasing Metrora](../RELEASING.md) — public release responsibilities and prohibitions.
- [Changelog](../CHANGELOG.md) — Metrora-originated public changes.

Historical and guided acceptance documents preserve reproducible public evidence for the source and artifact they name. They do not override the current release status in [Windows distribution](WINDOWS_DISTRIBUTION.md), [Versioning](VERSIONING.md) or the root [README](../README.md).

## Contribute safely

- [Contributing](../CONTRIBUTING.md) — contribution workflow and validation requirements.
- [Security policy](../SECURITY.md) — private vulnerability reporting.
- [Upstream provenance](../UPSTREAM.md) — exact imported source authority.
- [Third-party notices](../THIRD_PARTY_NOTICES.md) — required licences and component notices.
- [Brand policy](../BRAND_POLICY.md) — product identity and permitted brand use.

## Documentation rule

Public documentation explains current behavior, stable guarantees, known limitations, reproducible contracts and contribution requirements. Internal staffing, budgets, private infrastructure, unpublished commercial plans, milestone codes and product sequencing do not belong in this repository.
