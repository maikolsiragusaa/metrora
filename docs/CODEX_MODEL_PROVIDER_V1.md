# Codex source-recorded model provider v1

**Status:** implemented compatibility boundary for reviewed Codex measurements.

Codex rollout files may include `session_meta.payload.model_provider`. Metrora preserves that source-recorded value so reviewed Workspace production can distinguish the AI/API provider from the Codex collector without inference.

## Source authority

The accepted source is:

```text
session_meta.payload.model_provider
```

The value passes through the existing explicit-provider normalizer. Missing, malformed, path-like or unsupported values remain unknown.

Metrora does not infer the provider from:

- collector name `codex`;
- model label;
- endpoint, account or subscription;
- pricing records;
- assumptions about a vendor or product.

## Fresh parser path

The canonical provider registry decorates the existing Codex parser. Before a call enters the ordinary session cache, it:

1. reads a bounded rollout prefix until `session_meta`;
2. extracts and normalizes `model_provider`;
3. attaches it to calls from that source;
4. rejects a contradiction if the base parser already supplied a different explicit provider.

This does not change tokens, settled cost, deduplication, model labels, timestamps, tools or project/session grouping.

## Existing-cache compatibility

A complete cache created before provider propagation may contain Codex calls without the field.

During explicit reviewed production, the scanner reads the same source metadata and reconciles it with the cached call:

- missing cached provider plus explicit source provider — use the source value for the reviewed candidate;
- matching providers — preserve the value;
- contradictory providers — fail closed;
- missing or invalid source provider — withhold the call.

This compatibility path does not rewrite the cache, reprice usage or introduce a second token parser. A later ordinary reparse stores the provider through the canonical provider path.

## Privacy and bounds

The metadata reader:

- scans at most the first 256 lines;
- extracts no prompt, response, code, patch, command or tool content;
- returns only a normalized provider identifier or unknown;
- exposes no rollout path or source metadata to the renderer;
- runs locally without an account or network service.

## Reviewed-production effect

A Codex call becomes eligible only when all ordinary requirements also pass:

- the source still exists;
- canonical cache state is complete;
- private deduplication identity is valid;
- the concrete Codex provenance path is reviewed;
- immutable cost evidence is valid or explicitly unavailable;
- source-recorded provider is present and non-contradictory.

This boundary does not make every Codex record eligible automatically.

## Non-goals

It adds no provider inference, collector rewrite, analytics or price change, destructive cache migration, renderer authority, network transport, account, billing or mobile behavior.
