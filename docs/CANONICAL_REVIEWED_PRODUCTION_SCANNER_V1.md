# Canonical reviewed-production scanner v1

**Status:** W1.D.C.B.B.A scanner boundary. Secure desktop runtime/IPC/UI integration remains W1.D.C.B.B.B.

This scanner is the trusted read-side counterpart to the reviewed-production orchestrator. It refreshes Metrora's existing canonical parser/cache path and derives eligible local Workspace production candidates from per-source cached calls.

It does not create events, receipts, batches, exports, uploads, or analytics totals.

## Authority

The scanner reuses:

- `clearSessionCache()` only to bypass the process-local Overview TTL;
- `parseAllSessions()` as the canonical discovery, reconciliation, parse, settlement, and cache-publication path;
- `loadCache()` and the current cache-completeness marker;
- `cachedCallToApiCall()` for the exact normalized call and immutable cost assignment;
- `collectorProvenanceProfileForCall()` for executable reviewed-path eligibility;
- the provider registry for the local tool display name.

It does not create a second provider scan, parser, pricing calculation, cache, or call normalization path.

## Per-source rule

Candidates are derived only from current per-file cache entries whose source still exists locally.

A source-less durable or migrated cache entry may remain authoritative for historical analytics, but it cannot become newly produced evidence after the underlying source disappears. Its cached calls are counted as withheld and are not emitted as candidates.

A cache marked incomplete after the explicit canonical refresh is an integrity failure, not an empty successful scan.

## Eligibility

A cached call becomes a candidate only when all of these are true:

1. the source file is still present;
2. the cached call provider matches its provider section;
3. the private deduplication key is non-empty;
4. the source supplied an explicit normalized model/API provider;
5. the executable provenance registry resolves a reviewed profile;
6. the provider registry can resolve the local tool display name.

Missing explicit provider identity, unsupported collectors, estimated/unreviewed paths, unavailable provider modules, and source-less history are withheld rather than inferred.

A provider-section mismatch, empty deduplication identity, incomplete cache, or malformed trusted state fails closed.

## Context and privacy

The scanner supplies only the context required by the existing reviewed producer:

- session disclosure is `omit`;
- no repository, project, account, prompt, response, code, patch, tool argument, local path, or private receipt is disclosed;
- tool name comes from the provider registry;
- adapter version is the current Metrora release supplied by the trusted main process;
- GenAI operation is `other` when no stronger source-backed operation exists;
- model/API provider comes only from the source-recorded normalized call.

The scanner does not select a public profile ID or source kind. The reviewed factory derives both from the executable registry.

## Source-record fingerprint

Each candidate receives a SHA-256 source-record fingerprint over a domain-separated composition of:

- stable endpoint ID;
- collector/provider section;
- private per-call deduplication key.

The local source path is used only for the source-presence check and is not an input to the public digest. The private deduplication key also never leaves the scanner; only the digest crosses into the reviewed event.

Provider parsers already enforce the private deduplication identity globally within their provider, so adding a local path would not improve record identity. Excluding it also avoids creating a path-derived public correlation value. Including the endpoint ID prevents an identical local record on different endpoints from becoming a cross-device correlation handle. Endpoint-key rotation does not change the fingerprint.

## Counts

The scanner returns:

- `candidates`: eligible trusted calls and minimal contexts;
- `withheldCount`: individual calls not eligible for production;
- `failedCount`: source files already marked failed by the canonical parser/cache path.

A failed source file is counted once and contributes no invented calls.

## Ordering

Provider sections and source paths are sorted. Within one source file, the scanner preserves canonical cached turn and call order. The production orchestrator then processes candidates sequentially, preserving deterministic outbox order.

## Non-goals

- no renderer input;
- no desktop runtime method, IPC channel, preload method, or button yet;
- no inferred provider from collector or model label;
- no automatic/background production;
- no session, repository, project, or account disclosure;
- no collector, parser, pricing, cache-schema, label, aggregation, batch, export, network, account, team, billing, mobile, or unrelated product redesign.
