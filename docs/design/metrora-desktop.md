# Metrora Desktop architecture

**Status:** implemented architecture and maintenance boundary

## Purpose

Metrora Desktop is the primary local graphical surface for usage intelligence and the personal Workspace. It is a view and orchestration layer over canonical public product contracts; it does not create a second parser, pricing engine, evidence model or recovery authority.

## Process boundary

- Electron main owns local filesystem access, runtime execution, OS-vault access, Workspace authority and bounded IPC handlers.
- The preload bridge exposes a minimal typed API.
- The renderer runs with context isolation and no Node integration.
- No remote content is loaded into privileged application surfaces.
- Structured public DTOs cross IPC; private keys, unrestricted paths and mutable internal state do not.

## Data authority

The desktop consumes canonical runtime payloads for:

- overview, sessions, projects, tools, models, tokens and cost;
- historical pricing and evidence states;
- optimization findings and plan pacing;
- endpoint identity and local-device foundations;
- Workspace creation, inspection, production lifecycle, batching, export and recovery.

Uninspected or unavailable evidence remains visibly indeterminate. The UI must never replace an unknown state with a false zero.

## Compatibility

Inherited command aliases, IPC object names and storage identifiers may remain only where changing them would break installed state or integrations. They are governed by [`../TECHNICAL_IDENTITY_COMPATIBILITY.md`](../TECHNICAL_IDENTITY_COMPATIBILITY.md) and are not product-facing branding.

## Packaging boundary

Desktop development packaging currently supports Windows, macOS and Linux formats. Official publication requires platform-specific identity, integrity, installation, update, rollback and support acceptance.

Product build, packaging, protected signing, publication and rollback remain separate responsibilities.

## Maintenance rules

- Keep domain state, orchestration and presentation in separate modules.
- Prevent oversized modules and duplicate canonical aggregation logic in React.
- Preserve local state through reviewed migrations.
- Add focused tests for every IPC boundary and failure state.
- Keep privacy, provenance and evidence-quality language truthful at the UI boundary.
