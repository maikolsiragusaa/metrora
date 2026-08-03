# Metrora product principles

These principles govern the public Metrora project. They are intended to remain stable even as interfaces, providers, packaging and optional deployment modes evolve.

## Local-first is the default

A person must be able to install Metrora, inspect locally available usage, and export their data without creating an account or sending their AI traffic through Metrora.

Networked features are additive. They must never silently convert local analysis into hosted collection.

## User-owned data stays portable

Canonical records, public contracts, local APIs, backup, and ordinary export formats must remain usable without a proprietary service.

Metrora must not trap users behind an account, a hosted dashboard, or an undocumented database format to access measurements created from their own machines.

Service failure, subscription expiry or a change of deployment mode must not remove access to local user-owned history.

## Content-minimal by default

The default analytical layer uses structured metadata such as timestamps, model identifiers, token counts, cost, tool names, task categories, project identifiers, and measurement provenance.

Prompts, responses, source code, patches, secrets, tool arguments, and unrestricted local paths are outside the default sharing boundary. Any future content-aware capability requires a separate, explicit consent and storage boundary.

## Evidence before inference

Metrora distinguishes:

- values observed directly from a source;
- deterministic values derived from observed data;
- estimates with documented assumptions;
- unknown values where trustworthy attribution is unavailable.

Missing evidence must remain visible. Cost, duration, token volume, or task content must not be used to fabricate model settings or measurement certainty.

## Independent across tools

Metrora exists to provide one coherent view across AI tools and providers. It must not require users to standardize on one editor, one model vendor, one proxy, or one hosted platform.

Provider-specific integrations may be deep, but canonical reporting should remain provider-neutral.

## One canonical core across deployment modes

Local, future managed and future customer-operated modes must use the same public authority for collection, canonical history, historical pricing, provenance, evidence and deterministic analytics.

A remote service may validate, accept, authorize, retain and aggregate evidence produced by that authority. It must not reparse local tool data, invent missing facts, reprice settled history or introduce a second measurement engine.

Deployment location may change operational ownership. It must not change the meaning of the user's history.

The existence of public contracts does not imply that a hosted service, account system, enterprise deployment or complete self-hosted server is available.

## Sharing is explicit and inspectable

Every device or workspace connection must state what is shared, with whom, for what purpose, and how access can be revoked.

Aggregate views should not silently expose prompts, code, personal file paths, or unrelated activity. Network protocols and shared schemas must be versioned and testable.

Offline or failed delivery must not corrupt the local source of truth. Repeated delivery must be idempotent before a remote mode can be considered trustworthy.

## The CLI remains first-class

The desktop application, local web interface, and companion clients are views over the same trustworthy core. The CLI and public contracts must remain suitable for automation, inspection, migration, and independent tooling.

A graphical or remote feature should not require a separate measurement implementation when the public core can own the semantics once.

## The open-source edition must remain genuinely useful

The public project should provide a complete local experience for individual developers and a practical foundation for privacy-conscious shared use.

Public measurement quality, collectors, canonical history, provenance, core analytics, local access, and data portability must not be intentionally degraded to manufacture a paid limitation.

Commercial value may come from operating services, remote access, coordination, retention, governance, support and other capabilities that require continuing operational responsibility.

## Security and privacy outrank convenience

Pairing, enrollment, synchronization, update delivery, and release signing must be designed as security boundaries, not added after the interface is considered finished.

When a safe workflow is not ready, Metrora should label the capability experimental, planned or unavailable rather than overstate its guarantees.

## Product identity should be its own

Metrora preserves upstream license and provenance while developing an independent product language, visual system, information architecture, release channel, and user experience.

Compatibility names may remain internally while migrations are active, but new public interfaces and documentation should use Metrora terminology.
