# Canonical reviewed-production scanner v1

**Status:** implemented and invoked by the protected desktop Workspace runtime after the explicit production action.

The scanner is the trusted read-side boundary that refreshes Metrora's existing parser/cache authority and derives eligible reviewed-production candidates from source-present cached calls.

It does not create events, receipts, batches, exports, uploads or analytics totals.

## Reused authority

The scanner reuses:

- the canonical provider discovery and parsing path;
- the existing session cache and completeness marker;
- the normalized-call and immutable-cost projection;
- the executable collector-provenance registry;
- the provider registry for local tool display names.

It does not create a second provider scan, parser, pricing calculation, cache or normalization path.

## Source-present rule

Candidates come only from current per-source cache entries whose underlying source still exists locally.

Source-less durable or migrated history may remain authoritative for ordinary historical analytics, but it cannot become newly produced signed evidence after the source disappears.

A cache marked incomplete after the explicit refresh is an integrity failure, not an empty successful scan.

## Production scope

Normal production is bounded from the protected local Workspace creation timestamp. Older history remains available to Overview analytics but is not silently backfilled or counted as failed evidence.

The renderer cannot supply or alter the scope timestamp.

See [Workspace production scope v1](WORKSPACE_PRODUCTION_SCOPE_V1.md).

## Eligibility

A cached call becomes a candidate only when:

1. its source still exists;
2. its provider section and normalized provider agree;
3. its private deduplication identity is valid;
4. the source supplies an explicit model/API provider where required;
5. the executable provenance registry resolves a reviewed profile;
6. the provider registry resolves the local tool name.

Missing provider identity, unsupported collectors, unreviewed paths, unavailable provider modules and source-less history are withheld rather than inferred.

Provider-section mismatch, empty private identity, incomplete cache or malformed trusted state fails closed.

## Context and privacy

The scanner supplies only the context required by the reviewed producer:

- session disclosure remains omitted;
- repository, project and account disclosure remain absent;
- tool name comes from the provider registry;
- adapter version comes from the trusted desktop runtime;
- operation remains `other` when no stronger source-backed value exists;
- model/API provider comes from normalized source evidence.

No prompt, response, code, patch, tool argument, unrestricted local path or private receipt crosses this boundary.

## Source-record fingerprint

Each candidate receives a SHA-256 fingerprint over a domain-separated composition of:

- stable endpoint ID;
- collector/provider section;
- private per-call deduplication key.

The local source path is used only to confirm source presence and is not included in the public digest. The private key itself never leaves the scanner.

Including the endpoint ID prevents identical records on separate devices from becoming a cross-device correlation handle. Endpoint-key rotation does not change this fingerprint.

## Counts and ordering

The scanner returns:

- eligible candidates;
- a withheld-call count;
- a failed-source count.

Provider sections and source paths are sorted, while canonical call order inside one source is preserved. The production orchestrator processes candidates sequentially so outbox order remains deterministic.

## Runtime boundary

The scanner is packaged in a separate desktop bundle and loaded lazily only after the user requests reviewed production. The Electron renderer has no direct scanner API and cannot supply calls, providers, paths, costs or evidence claims.

Opening Metrora or the Workspace view does not load this path or produce evidence.

## Non-goals

The scanner does not provide automatic or background production, inferred providers, historical backfill, renderer-controlled scope, batch creation, export, network transport, account, team or billing behavior.
