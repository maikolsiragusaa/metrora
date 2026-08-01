# Metrora reviewed event factory v1

Status: **implemented but not connected to runtime collection or transport**.

`createReviewedUsageMeasurementEventV1()` is the single first-party composition boundary between:

- an existing normalized `ParsedApiCall`;
- the reviewed collector provenance registry;
- fail-closed quality and pricing resolution;
- the public CloudEvents measurement adapter.

It creates an event only for a reviewed collector path with a supported reasoning attribution source. Other paths return a structured `withheld/unreviewed-evidence-path` result.

## Explicit context

The factory does not discover or infer the following facts:

- workspace ID;
- endpoint ID;
- local endpoint event-identity key;
- repository, project, account, or session disclosure;
- tool name and version;
- Metrora adapter version;
- source fingerprint;
- actual AI/API provider;
- GenAI operation;
- requested model.

The caller must supply them. In particular, collector `codex` never implies AI provider `openai`: the actual provider remains an explicit field.

## Profile-owned fields

The caller cannot choose the public collector profile identity or source kind. When evidence is approved, the factory derives:

- `collector.adapterId` from the reviewed profile ID;
- `collector.sourceKind` from the reviewed profile source kind;
- event quality and cost evidence from `resolveMeasurementEvidenceV1()`.

This prevents a content-length fallback from being labelled as a measured token-count path.

`collector.adapterVersion` remains explicit because it identifies the Metrora implementation release, while the provenance profile separately pins the inherited parser fingerprint.

## Session disclosure

Session sharing is a discriminated decision:

- `{ mode: "omit" }` produces no session ID and forces session quality to `unknown`;
- `{ mode: "include", sessionId }` requires a concrete non-empty ID.

There is no boolean or implicit default that can accidentally claim session identity.

## Created versus withheld

A reviewed call with unavailable pricing still creates a useful measurement event whose cost is `unavailable`.

A call is withheld when its collector path or reasoning attribution is not reviewed. Malformed normalized facts or invalid explicit context throw rather than being silently repaired.

## Privacy boundary

The factory ultimately calls the existing allowlist adapter. The event never serializes:

- private deduplication keys;
- prompts or responses;
- source code or patches;
- tool sequences, MCP names, skills, or subagents;
- shell commands, filenames, or local paths;
- the endpoint HMAC key.

## Non-goals

- no automatic scan/cache hook;
- no endpoint key generation or storage;
- no repository-ID derivation from local paths;
- no provider inference;
- no outbox, retry, batching, synchronization, or network transport;
- no signing or attestation generation;
- no additional collector profiles.

## Next safe step

Before normal collection can emit these events, Metrora needs an offline endpoint event-identity store and an append-only local outbox with idempotent batch publication. That layer should reuse the existing desktop identity and atomic cache patterns rather than introduce a hosted dependency.
