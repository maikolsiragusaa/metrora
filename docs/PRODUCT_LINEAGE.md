# Product lineage

Metrora is an independently maintained product built from an open-source lineage rather than a claim of having started from an empty repository.

This document explains the functional boundary. The exact legal and source authority remains [`UPSTREAM.md`](../UPSTREAM.md), [`THIRD_PARTY_NOTICES.md`](../THIRD_PARTY_NOTICES.md) and [`LICENSES/`](../LICENSES/).

## Imported baseline

The reviewed public source baseline was:

- project: **CodeBurn**;
- version: **0.9.19**;
- upstream repository: `getagentseal/codeburn`;
- imported commit: `146037bfd533edff85cd39f322571b2c5434fcca`;
- licence: MIT.

The original AgentSeal copyright notice and MIT licence text are preserved in [`LICENSES/CodeBurn-MIT.txt`](../LICENSES/CodeBurn-MIT.txt).

## Functional lineage

The categories below describe product evolution. They do not change copyright ownership or licence obligations for inherited code.

### Inherited foundations

The CodeBurn 0.9.19 baseline already provided substantial working foundations, including:

- local-first discovery and parsing across many AI coding tools and gateways;
- token, cost, cache, model, project, task and session reporting;
- a terminal dashboard and command-line reports;
- a local browser dashboard;
- an Electron desktop application;
- retained macOS menubar and GNOME panel surfaces;
- model comparison, optimization findings and reversible configuration actions;
- budgets, plan-aware reporting, exports and provider diagnostics;
- local MCP access and local-network device pairing;
- provider documentation, fixtures and a broad automated test suite.

Metrora does not describe these foundations as newly invented merely because the product identity changed.

### Materially reworked by Metrora

Metrora has changed or strengthened inherited behavior where accuracy, compatibility and product trust required a different authority. Public changes include:

- durable-history reconciliation that preserves expired or unattributable history without duplicating or fabricating detail;
- stricter project and provider filtering across headline totals, history and breakdowns;
- trusted completeness requirements before durable daily data is published;
- historical pricing with date-effective, non-retroactive settled assignments;
- explicit distinctions between metered, observed, derived, estimated, explicit-zero and unavailable values;
- provider-specific cache invalidation and parser corrections without unnecessary global resets;
- canonicalization and evidence rules used by signed public contracts;
- desktop architecture and information hierarchy changes that preserve one measurement authority;
- bounded Windows packaging, migration, rollback, recovery and physical-accessibility acceptance;
- independent Metrora product, publisher, repository and visual identity.

A feature may therefore have an inherited origin while its current semantics, tests or trust boundary are materially different.

### Metrora-originated product boundaries

The following public product boundaries were established as Metrora work rather than inherited release claims:

- the Metrora product identity, Signal Grid visual identity and Vensent publisher identity;
- the local personal Workspace lifecycle;
- protected endpoint identity and explicit reviewed measurement production;
- deterministic non-destructive recovery, signed batches and independently verifiable evidence export;
- public workspace, endpoint, measurement, sharing and evidence contracts;
- the collector provenance inventory and fail-closed signed-sharing eligibility boundary;
- the independent `1.0.0-rc.N` release line and Windows distribution discipline.

This list describes current public boundaries, not every individual implementation change.

## Compatibility identifiers

The canonical product command is `metrora`.

The current runtime contains a narrowly scoped compatibility boundary for older command aliases and persisted identifiers. Some directories, environment variables, cache files, schemas and persisted identifiers retain historical values only where immediate replacement would risk breaking:

- existing local state;
- scripts and integrations;
- migration and rollback evidence;
- signed or versioned compatibility contracts.

Those identifiers are compatibility mechanisms, not alternate product brands. New user-facing documentation and official releases use Metrora terminology.

## What provenance does not imply

Preserving upstream provenance does not mean:

- CodeBurn or AgentSeal publishes, operates or endorses Metrora;
- Metrora can remove the original copyright notice from inherited code;
- every current Metrora feature existed unchanged in the imported baseline;
- every inherited collector is approved for Metrora signed Workspace measurements;
- an inherited release or store package is an official Metrora distribution.

Metrora is independently maintained and distributed under its own product identity while complying with the licences of all incorporated components.

## Recording future upstream work

When later third-party code or fixes are incorporated, the public record should preserve:

- upstream project and source location;
- exact version or commit when practical;
- licence and required notice;
- the files or behavior adapted;
- material Metrora modifications;
- any additional compatibility or security boundary.

Internal evaluation notes and unpublished product planning do not belong in the public provenance record.
