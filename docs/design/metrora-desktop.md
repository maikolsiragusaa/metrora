# Metrora Desktop architecture

**Status:** implemented architecture and maintenance boundary

## Purpose

Metrora Desktop is the primary local graphical surface for usage intelligence and the personal Workspace. It is a view and orchestration layer over canonical public product contracts; it does not create a second parser, pricing engine, evidence model or recovery authority.

## Process boundary

- Electron main process owns local filesystem access, CLI execution, OS-vault access, Workspace runtime and bounded IPC handlers.
- The preload bridge exposes a minimal typed API.
- The renderer runs with context isolation and no Node integration.
- No remote content is loaded into privileged application surfaces.
- Structured public DTOs cross IPC; private keys, unrestricted paths and mutable internal state do not.

## Data authority

The desktop consumes canonical CLI/runtime payloads for:

- overview, sessions, projects, tools, models, tokens and cost;
- historical pricing and evidence states;
- optimization findings and plan pacing;
- endpoint identity and local-device foundations;
- Workspace creation, inspection, production lifecycle, batching, export and recovery.

Uninspected or unavailable evidence remains visibly indeterminate. The UI must never replace an unknown state with a false zero.

## Compatibility

Inherited command aliases, IPC object names and storage identifiers may remain only where changing them would break installed state or integrations. They are governed by `../TECHNICAL_IDENTITY_COMPATIBILITY.md` and are not product-facing branding.

## Packaging

Desktop packaging is split by platform and channel:

- Windows Microsoft Store AppX/MSIX for ordinary users;
- Windows portable ZIP and unsigned NSIS for technical users;
- macOS development packaging pending a separate trusted-distribution tranche;
- Linux AppImage, deb and rpm pending release acceptance.

Build, packaging, Store submission, publication and rollback remain separate responsibilities.

## Maintenance rules

- Keep domain state, orchestration and presentation in separate modules.
- Do not grow GOD FILES or duplicate canonical aggregation logic in React.
- Preserve local state through reviewed migrations.
- Add focused tests for every IPC boundary and failure state.
- Keep privacy, provenance and evidence-quality language truthful at the UI boundary.
