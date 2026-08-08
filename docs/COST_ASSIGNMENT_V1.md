# Metrora cost assignment v1

Status: **assignment and settlement contract implemented; parser/cache wiring not enabled**.

A historical price record is not sufficient by itself. Once one call has been valued, Metrora must preserve which evidence produced the amount so a later catalog refresh, alias update, cache rebuild, or model-price change cannot silently alter that settled call.

`CostAssignmentV1` is the immutable per-call explanation for one cost value.

## Assignment kinds

- `metered` — a provider, client, or billing export recorded the amount directly;
- `token-price` — Metrora calculated the amount from one exact reviewed or locally observed price record and records the selected base or conditional rate band;
- `explicit-zero` — a reviewed free route, free model, local inference path, or manual zero-price record proves that zero is intentional;
- `legacy-frozen` — an older amount is preserved without upgrading its historical provenance;
- `unavailable` — evidence is insufficient or conflicting, so no numeric cost is settled.

Settled values are stored as non-negative safe integer micro-USD. This matches the public measurement precision and prevents binary floating-point tails from changing equality checks.

## Invariants

- the assignment amount must match the call cost at micro-USD precision;
- explicit zero and unavailable pricing are never interchangeable;
- a token-priced assignment names the exact `priceRecordId`, reviewed/local origin, and selected rate band;
- a legacy amount remains explicitly legacy rather than being relabeled as provider-metered;
- unavailable assignments carry no settled amount;
- unsafe, negative, non-finite, or contradictory values fail closed.

## Historical settlement

`settleHistoricalCostV1()` converts one reviewed historical calculation into either:

- a numeric amount plus `token-price` assignment;
- zero plus `explicit-zero` assignment;
- no amount plus `unavailable` when prompt-size, web-search, fast-route, or other required rate evidence is missing.

The function does not change existing Metrora-derived runtime totals. The next tranche must carry this optional contract through normalized calls and the session cache, preserve old caches losslessly, and compare real Metrora and Metrora logs before historical assignments become authoritative.
