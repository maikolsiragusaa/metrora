# Codex source-recorded model provider v1

**Status:** bounded W1.D.C compatibility checkpoint.

Codex rollout files may include `session_meta.payload.model_provider`. Metrora preserves that source-recorded value so reviewed Workspace production can distinguish the AI/API provider from the Codex collector without inference.

## Source authority

The only accepted source is:

```text
session_meta.payload.model_provider
```

The value is normalized through the existing explicit-provider normalizer. Missing, malformed, path-like, or unsupported values remain unknown.

Metrora does not infer the provider from:

- collector name `codex`;
- model label;
- endpoint, account, or subscription;
- pricing record;
- historical assumptions about OpenAI products.

## Fresh parser path

The canonical provider registry decorates the existing Codex provider.

Before one parsed call enters the ordinary session cache, the decorator:

1. reads a bounded prefix of the rollout until `session_meta`;
2. extracts and normalizes `model_provider`;
3. attaches it to every call from that source;
4. rejects a contradiction if the base parser already supplied a different explicit provider.

The decorator does not change token parsing, cost settlement, deduplication, model labels, timestamps, tool attribution, or project/session grouping.

## Pre-upgrade cache compatibility

An existing complete session cache may contain Codex calls created before provider propagation.

During explicit reviewed production only, the canonical scanner reads the same `session_meta.model_provider` for that source and reconciles it with the cached call:

- missing cached provider + explicit source provider → use the source provider for the reviewed candidate;
- matching providers → keep the cached provider;
- contradictory providers → fail closed;
- missing/invalid source provider → withhold the call.

This compatibility path does not rewrite the cache, reprice usage, or create a second token parser. A later ordinary source reparse stores the provider through the decorated canonical provider.

## Privacy and bounds

The metadata reader:

- scans at most the first 256 lines;
- extracts no prompt, response, code, patch, command, or tool content;
- returns only a normalized provider identifier or unknown;
- does not expose the rollout path or metadata to the renderer;
- runs locally and requires no network or account service.

## Reviewed production effect

A Codex call becomes eligible only when all existing requirements also pass:

- source still exists;
- canonical cache is complete;
- private deduplication identity is valid;
- Codex provenance profile is reviewed;
- immutable cost evidence is valid or explicitly unavailable;
- source-recorded provider is present and non-contradictory.

This checkpoint does not broaden collector provenance or make every Codex record eligible automatically.

## Non-goals

- no provider inference;
- no collector/parser rewrite;
- no analytics-total or price change;
- no cache-schema migration or destructive invalidation;
- no renderer, IPC, network, account, billing, Android, Advisor, or Bench behavior.
