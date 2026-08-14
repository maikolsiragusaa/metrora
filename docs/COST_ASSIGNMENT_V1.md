# Metrora cost assignment v1

Status: **assignment and settlement contract implemented and wired through normalized calls and the v8 session cache**.

A historical price record is not sufficient by itself. Once one call has been valued, Metrora must preserve which evidence produced the amount so a later catalog refresh, alias update, cache rebuild, or model-price change cannot silently alter that settled call.

`CostAssignmentV1` is the immutable per-call explanation for one cost value. It is a compact, non-secret record: it does not contain prompts, responses, source code, credentials, or arbitrary invoice data.

## Assignment kinds

- `metered` — a provider, client, or billing export recorded the amount directly;
- `token-price` — Metrora calculated the amount from one exact reviewed or locally observed price record and records the selected base, policy, evidence, or conditional rate band;
- `explicit-zero` — a reviewed free route, free model, local inference path, or manual zero-price record proves that zero is intentional;
- `legacy-frozen` — an older amount is preserved without upgrading its historical provenance;
- `unavailable` — evidence is insufficient or conflicting, so no numeric cost is settled.

Settled values are stored as non-negative safe integer micro-USD. This matches the public measurement precision and prevents binary floating-point tails from changing equality checks.

## Resolution precedence

For a new assignment, runtime resolution follows this order:

1. trustworthy provider-, client- or billing-export-metered evidence;
2. an exact deterministic or dynamic policy calculation supported by the request;
3. a safe reviewed historical record, or a later reviewed/local observation with a matching identity and effective interval;
4. an explicit unavailable result, or the already stored `legacy-frozen` value when no stronger fresh assignment can be made.

The model identity, owner/developer, inference provider, pricing authority, gateway/router, route, tier, region and request evidence are separate dimensions. A third-party hosted model does not inherit the original developer's price merely because the model string is the same. A provider or adapter label that is not established as pricing authority cannot trigger a silent fallback.

## Invariants

- the assignment amount must match the call cost at micro-USD precision;
- explicit zero and unavailable pricing are never interchangeable;
- `UNKNOWN` is not `ZERO`;
- a token-priced assignment names the exact `priceRecordId`, reviewed/local origin, selected rate or policy, and compact pricing provenance when available;
- provenance may include authority, pricing model, model identity/owner, inference provider, gateway, route, tier, region, effective interval and source kind, but never secrets or raw request content;
- a legacy amount remains explicitly legacy rather than being relabeled as provider-metered;
- unavailable assignments carry no settled amount;
- unsafe, negative, non-finite, contradictory, missing-authority or ambiguous values fail closed.

## Bounded charges

Historical settlement can include only request-bounded components for which the record and usage provide matching rates and counts: input/output tokens, cache reads/writes, web-search requests, gateway/service requests and tool requests. It does not manufacture subscription, credit, tax, negotiated, bundled or arbitrary invoice charges. An API-equivalent calculation remains distinct from exact provider billing, and estimated inference remains estimated.

## Historical settlement and fresh diagnostics

`settleHistoricalCostV1()` converts one reviewed historical calculation into either:

- a numeric amount plus `token-price` assignment;
- zero plus `explicit-zero` assignment;
- no amount plus `unavailable` when prompt-size, web-search, fast-route, request-charge, dynamic-evidence or other required rate evidence is missing.

An assignment already stored in the v8 cache is immutable. A comparison or diagnostic run may produce a fresh candidate and report a delta, but it does not replace the stored assignment or resettle historical usage. This is also why a catalog refresh cannot rewrite settled totals.

## Catalog compatibility

The catalog remains `catalog.v1.json` with `schemaVersion: 1`. Identity dimensions, deterministic policies, bounded dynamic-evidence requirements and request-charge rates are additive optional V1 fields. The existing 82 reviewed records remain preserved and readable; this tranche does not perform a catalog V2 migration or mass provider population. “Pricing Policy Engine V2” is the name of the implementation tranche, not a catalog schema version.

## Runtime wiring

Runtime parsing carries the assignment through normalized calls and the v8 session cache without changing the cache schema authority. Existing caches are adopted losslessly, and the canonical projection requires the immutable assignment before it can publish an observation.
