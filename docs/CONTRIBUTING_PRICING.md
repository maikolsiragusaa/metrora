# Contributing reviewed pricing data

Metrora keeps reviewed historical pricing separate from the live/fallback model-price registry. The reviewed book is append-only evidence used to value usage against the pricing conditions that applied at the time.

## Source of truth and compatibility

Edit:

`src/data/pricing-history/catalog.v1.json`

Do not edit `docs/PRICING_HISTORY.md` directly. It is generated with:

```bash
npm run pricing:docs
npm run pricing:docs:check
```

The JSON stores USD **per token**. Provider pages commonly publish USD per 1M tokens, so convert with:

`perToken = perMillion / 1_000_000`

For example, `$3 / 1M` becomes `0.000003`.

The catalog remains `schemaVersion: 1`. Optional identity dimensions, deterministic policies, bounded dynamic-evidence requirements and request-charge rates are additive V1 fields. The current 82 reviewed records must remain preserved and readable; do not perform a catalog V2 migration or mass provider population in a pricing contribution. “Pricing Policy Engine V2” is a tranche name, not the catalog schema version.

Reviewed models that are deliberately not representable yet, or whose usage evidence is not safe to settle yet, are tracked in [`PRICING_COVERAGE_GAPS.md`](PRICING_COVERAGE_GAPS.md). Check that file before inventing a workaround for a missing model.

## Review rules

Every contribution must preserve these rules:

1. **Model identity is not pricing authority.** The same model can have different prices through different inference providers, gateways, routes, tiers or regions. Keep model identity, owner/developer, actual inference provider, billing authority and gateway/router distinct. Never choose the original developer's price solely because a hosted model shares its name.
2. **Host evidence is required.** A host, gateway or adapter label may identify the request path, but it becomes pricing authority only when source evidence establishes that authority and its applicable rate. Missing dimensions stay missing; do not infer them from the model string.
3. **Deterministic schedules need an authoritative source.** A time window must come from provider or reviewed route evidence and must declare an explicit UTC/IANA timezone, half-open boundaries, optional weekdays and any midnight-crossing semantics. Do not reconstruct arbitrary surge pricing from timestamps or guesses.
4. **Dynamic prices require dynamic evidence.** Use only bounded provider, gateway or client evidence such as a reported tier, reported multiplier or quoted rates. Missing, conflicting or equally ambiguous evidence must resolve to unavailable, not to a guessed base rate, zero or an arbitrary multiplier.
5. **Provenance is part of review.** Keep a stable source reference, source kind, observation time and revision or SHA-256 digest when available. A current page supports `first-observed`; do not backdate it without an authoritative effective instant.
6. **Unknown is not zero.** Use `explicit-zero` only when a free route, free model, local inference path or manual reviewed decision proves zero. Missing, unsupported or contradictory pricing remains unavailable.
7. **Intervals must be valid and non-overlapping.** Use `validFrom` inclusively and `validUntil` exclusively. A later record for the same full identity must start after its predecessor and point to it with `supersedes`. Do not silently rewrite an old interval.
8. **Settled history is immutable.** A catalog update or new local observation can support a fresh diagnostic candidate, but it must not replace a stored per-call assignment or rewrite settled historical totals.
9. **Ambiguous matching fails closed.** If authority, model identity, host, route, tier, region, required request evidence or policy specificity cannot be resolved uniquely, leave the call unavailable or preserve its explicit legacy assignment. Catalog order is not a tie-breaker.
10. **Canonical evidence must be reviewable.** Prefer official provider or route documentation, official dated announcements, or pinned upstream revisions. Random aggregators, blogs, search snippets, AI-generated values, reseller prices and rolling tables may help discovery but are not canonical pricing evidence by themselves.

## Evidence bar

Prefer evidence in this order:

1. official provider pricing or route documentation;
2. an official dated announcement or changelog;
3. a pinned, reviewable upstream pricing revision when the provider page does not preserve history;
4. a manually reviewed secondary source only when the stronger sources cannot establish the fact.

A current pricing page can establish a current `first-observed` record. It does not, by itself, justify backdating that price.

Community discussion and social posts can help discover stale integrations, route differences or undocumented edge cases, but they are corroboration and discovery signals rather than pricing authority unless a stronger source independently establishes the number.

## Pricing identity

A record is identified economically by its complete available identity:

- `pricingAuthority`;
- `pricingModel`;
- optional `modelIdentity` and `modelOwner`;
- optional `inferenceProvider` and `gateway`;
- optional `route`, `billingTier` and `region`.

`pricingModel` must be the exact reviewed pricing key Metrora resolves internally. Do not rename source-observed model labels in collectors or reports just to make a price record match. If an observed alias needs normalization, treat that mapping as a separate reviewed change.

Keep direct-provider pricing distinct from reseller, free, batch, priority, regional, subscription or other billing routes when their economics differ.

A provider redirect or retirement does not automatically create a new price interval for the retired pricing identity. End the old identity when its reviewed route stops applying; add a replacement price only under the pricing identity that Metrora can actually resolve from evidence.

## Time, policies and rates

Choose `validFrom.basis` deliberately:

- `official-effective` — the provider gives an authoritative effective instant;
- `reviewed-effective` — the effective instant is established by reviewed evidence but is not directly published as such by the provider;
- `first-observed` — this is the earliest instant for which the price was actually verified.

Every priced record requires input, output, cache read and cache write rates. Optional bounded charges include web-search per request, gateway/service per request and tool request per request. Fast-mode multipliers, prompt-input threshold bands and policy conditions are allowed only when the request supplies the corresponding evidence and usage counts.

Threshold semantics must be exact. The V1 condition is strictly `prompt-input-tokens-above`. If a provider publishes an inclusive integer threshold such as `>= 200000`, `> 199999` is the equivalent V1 condition. Time-window policies use explicit `UTC` or IANA timezones and half-open local intervals; a crossing-midnight window assigns after-midnight time to the day on which the window began.

Do not force a price into V1 if an economically material component cannot be represented. Examples include a storage charge that depends on cache duration when the runtime has no corresponding usage evidence. In that case, leave the model uncovered and propose the schema/runtime evidence change separately.

## Provenance and local observations

Each reviewed record must keep enough provenance for another reviewer to reproduce the decision:

- `source.kind`;
- stable `source.reference`;
- `source.observedAt`;
- `source.revision` or digest when a pinned revision exists.

Use `manual-reviewed` when the record depends on an explicit reviewed compatibility mapping rather than a provider's literal pricing model identifier. Private local observations use a content digest and `first-observed`; they supplement the reviewed book and never rewrite settled assignments.

## Coverage tests

Tests should protect economic behavior, not a catalog-size target. Prefer assertions for:

- representative provider/model/route identities that must resolve;
- exact effective, retirement and half-open interval boundaries;
- `supersedes` chains when a price changes under the same identity;
- cache, tool, gateway, web-search, fast-mode and threshold economics;
- deterministic time windows, including weekday and midnight cases;
- dynamic evidence, quoted rates and fail-closed behavior;
- exclusions whose omission is intentional and documented.

Do not use a fixed total record count as the acceptance criterion for catalog quality. The current 82-record preservation requirement protects compatibility, while tests should describe actual reviewed behavior.

Whenever the catalog changes, regenerate `docs/PRICING_HISTORY.md` in the same contribution and run `pricing:docs:check`. A catalog change whose generated book is stale is incomplete even if the pricing tests pass.

## Minimal record example

```json
{
  "priceRecordId": "provider:model-a:standard:official-2026-08-07",
  "pricingAuthority": "provider",
  "pricingModel": "model-a",
  "route": "standard",
  "validFrom": {
    "basis": "first-observed",
    "at": "2026-08-07T17:13:00Z"
  },
  "rates": {
    "inputPerToken": 0.000001,
    "outputPerToken": 0.000005,
    "cacheReadPerToken": 0.0000001,
    "cacheWritePerToken": 0.00000125
  },
  "valuation": {
    "kind": "priced"
  },
  "source": {
    "kind": "official-provider",
    "reference": "https://provider.example/pricing",
    "observedAt": "2026-08-07T17:13:00Z"
  }
}
```

## Validation

For a pricing-only contribution:

```bash
npm run pricing:docs
npm run pricing:docs:check
npm test -- --run src/pricing/history.test.ts src/pricing/gpt-5-6-history.test.ts src/pricing/multi-provider-history.test.ts
```

Add or update a targeted test when the contribution introduces a new economic condition, boundary, compatibility key, or historical transition.

Before opening a pull request, verify that:

- old intervals were not silently rewritten;
- every later interval has the correct `supersedes`;
- units are USD/token in JSON and render correctly per 1M in the generated book;
- cache, tool, gateway and web-search charges match the provider's actual billing semantics;
- unsupported components remain explicit gaps rather than approximations;
- ambiguous matches and missing dynamic evidence fail closed;
- coverage tests describe actual reviewed records rather than planned additions;
- the generated pricing history is committed with the catalog change.
