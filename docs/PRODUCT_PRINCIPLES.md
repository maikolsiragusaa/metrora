# Metrora product principles

These principles govern the public Metrora project and remain stable as interfaces, providers and packaging evolve.

## Local-first is the default

A person must be able to install Metrora, inspect locally available usage and export their data without creating an account or sending AI traffic through Metrora.

Optional connections must never silently convert local analysis into mandatory remote collection.

## User-owned data stays portable

Canonical records, public contracts, local APIs, backup and ordinary export formats must remain usable without a proprietary service.

Metrora must not trap users behind an account, hosted dashboard or undocumented database format to access measurements created from their own machines.

## Content-minimal by default

The default analytical layer uses structured metadata such as timestamps, model identifiers, token counts, cost, tool names, task categories, Project identifiers and measurement provenance.

Prompts, responses, source code, patches, secrets, tool arguments and unrestricted local paths are outside the default sharing boundary.

## Evidence before inference

Metrora distinguishes:

- values observed directly from a source;
- deterministic values derived from observed data;
- estimates with documented assumptions;
- unknown values where trustworthy attribution is unavailable.

Missing evidence must remain visible. Cost, duration, token volume or task content must not be used to fabricate model settings or measurement certainty.

## Independent across tools

Metrora provides one coherent view across AI tools and providers. It must not require users to standardize on one editor, one model vendor, one proxy or one platform.

Provider-specific integrations may be deep, but canonical reporting should remain provider-neutral.

## One measurement authority

Collection, canonical history, historical pricing, provenance, evidence and deterministic analytics must retain one public semantic authority.

When the source exposes enough evidence, cost valuation should use the pricing conditions that applied to the individual call at the time it occurred — including relevant cache, context, route or speed tiers — rather than flattening historical usage onto one current rate table. Missing evidence must remain explicit instead of forcing an unsupported tier.

A new interface must not reparse the same source data, invent missing facts, reprice settled history or introduce a competing measurement engine.

## Sharing is explicit and inspectable

Every device or Workspace connection must state what is shared, with whom, for what purpose and how access can be revoked.

Aggregate views must not silently expose prompts, code, personal file paths or unrelated activity. Shared schemas must be versioned and testable.

Offline or failed delivery must not corrupt the local source of truth. Repeated delivery must be idempotent.

## The CLI remains first-class

The Desktop application, local web interface and companion clients are views over the same trustworthy core. The CLI and public contracts must remain suitable for automation, inspection, migration and independent tooling.

A graphical feature should not require a separate measurement implementation when the public core can own the semantics once.

## Adopt mature upstream instead of rebuilding commodity engines

Owning more code is not automatically a product advantage.

When a mature open-source project already owns a commodity subsystem well, Metrora may adopt, pin, verify and integrate that upstream rather than maintain a weaker parallel implementation.

The current Code surface is the clearest example:

> **Metrora adds. OpenCode executes.**

OpenCode owns ordinary coding-agent mechanics; Metrora keeps the host/security boundary and adds the facts, context, evidence and control surfaces that are specific to Metrora.

Upstream adoption must preserve licence/provenance, deterministic versioning and a clean responsibility boundary. A fork or reconstruction should require a proven product/security blocker, not a preference for owning every layer.

## The open-source project remains genuinely useful

The public project should provide a complete local experience for individual developers and a practical foundation for privacy-conscious shared use.

Measurement quality, collectors, canonical history, provenance, core analytics, local access and data portability must not be intentionally degraded.

## Security and privacy outrank convenience

Pairing, enrollment, sharing, update delivery and release signing must be designed as security boundaries rather than added after an interface is considered finished.

When a safe workflow is not ready, Metrora should label the capability experimental or unavailable rather than overstate its guarantees.

## Product identity is independent

Metrora preserves required upstream licences and provenance while maintaining its own product language, visual system, information architecture, release channels and user experience.

Compatibility identifiers may remain internally while migrations are active, but new public interfaces and documentation use Metrora terminology.
