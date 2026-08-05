# Metrora documentation

This index separates user guidance, product guarantees, public contracts and contributor-facing technical references.

## Use Metrora

- [Getting started](GETTING_STARTED.md) — build from source, run the first reports and understand the current release boundary.
- [CLI reference](CLI_REFERENCE.md) — public commands grouped by task.
- [Supported tools](SUPPORTED_TOOLS.md) — local collector coverage and evidence boundaries.
- [Provider documentation](providers/) — source locations, formats, known limitations and parser notes for individual integrations.

## Understand the product

- [Product principles](PRODUCT_PRINCIPLES.md) — stable local-first, privacy, evidence and portability commitments.
- [Product lineage](PRODUCT_LINEAGE.md) — what came from the CodeBurn baseline and what Metrora changed or added.
- [Pricing history](PRICING_HISTORY.md) — date-effective rates, settled assignments and historical-cost behavior.
- [Collector inventory v1](COLLECTOR_INVENTORY_V1.md) — generated technical inventory of registered collectors and signed-sharing eligibility.
- [Public contracts v1](PUBLIC_CONTRACTS_V1.md) — public schemas, canonical signed-data behavior and compatibility commitments.
- [Technical identity compatibility](TECHNICAL_IDENTITY_COMPATIBILITY.md) — legacy identifiers retained to protect local state and integrations.

## Local Workspace and evidence

- [Workspace v1](WORKSPACE_V1.md) — local personal Workspace boundary and lifecycle.
- [Local endpoint identity and outbox v1](LOCAL_ENDPOINT_IDENTITY_AND_OUTBOX_V1.md) — protected endpoint identity and durable local delivery state.
- [Workspace evidence export v1](WORKSPACE_EVIDENCE_EXPORT_V1.md) — independently verifiable evidence export.
- [Workspace recovery v1](WORKSPACE_RECOVERY_V1.md) — deterministic non-destructive recovery behavior.
- [Reviewed event factory v1](REVIEWED_EVENT_FACTORY_V1.md) — reviewed production boundary for measurement events.

## Distribution and releases

- [Windows distribution](WINDOWS_DISTRIBUTION.md) — official Windows package and identity boundary.
- [Windows release candidate v1](WINDOWS_RELEASE_CANDIDATE_V1.md) — candidate manifest and verification contract.
- [Versioning](VERSIONING.md) — release-candidate and platform build-version authority.
- [Releasing Metrora](../RELEASING.md) — public release responsibilities and prohibitions.
- [Changelog](../CHANGELOG.md) — Metrora-originated public changes.

## Contribute safely

- [Contributing](../CONTRIBUTING.md) — contribution workflow and validation requirements.
- [Security policy](../SECURITY.md) — private vulnerability reporting.
- [Upstream provenance](../UPSTREAM.md) — exact imported source authority.
- [Third-party notices](../THIRD_PARTY_NOTICES.md) — required licences and component notices.
- [Brand policy](../BRAND_POLICY.md) — product identity and permitted brand use.

## Documentation rule

Public documentation should explain current behavior, stable guarantees, known limitations and reproducible contribution requirements. Internal staffing, budgets, private infrastructure, unpublished commercial plans and speculative implementation sequences do not belong in this repository.
