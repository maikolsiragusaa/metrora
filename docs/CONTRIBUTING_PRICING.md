# Contributing reviewed pricing data

Metrora keeps reviewed historical pricing separate from the live/fallback model-price registry. The reviewed book is append-only evidence used to value usage against the pricing conditions that applied at the time.

## Source of truth

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

Reviewed models that are deliberately not representable yet, or whose usage evidence is not safe to settle yet, are tracked in [`PRICING_COVERAGE_GAPS.md`](PRICING_COVERAGE_GAPS.md). Check that file before inventing a workaround for a missing model.

## Evidence bar

Prefer evidence in this order:

1. official provider pricing or route documentation;
2. an official dated announcement or changelog;
3. a pinned, reviewable upstream pricing revision when the provider page does not preserve history;
4. a manually reviewed secondary source only when the stronger sources cannot establish the fact.

A current pricing page can establish a current `first-observed` record. It does not, by itself, justify backdating that price.

Do not use search snippets, AI-generated values, reseller prices, or an unpinned rolling table as sole evidence for historical pricing.

Community discussion and social posts can help discover stale integrations, route differences or undocumented edge cases, but they are corroboration and discovery signals rather than pricing authority unless a stronger source independently establishes the number.

## Pricing identity

A record is identified economically by:

- `pricingAuthority`;
- `pricingModel`;
- `route`;
- optional `billingTier`.

`pricingModel` must be the exact reviewed pricing key Metrora resolves internally. Do not rename source-observed model labels in collectors or reports just to make a price record match. If an observed alias needs normalization, treat that mapping as a separate reviewed change.

Keep direct-provider pricing distinct from reseller, free, batch, priority, regional, subscription, or other billing routes when their economics differ.

A provider redirect or retirement does not automatically create a new price interval for the retired pricing identity. End the old identity when its reviewed route stops applying; add a replacement price only under the pricing identity that Metrora can actually resolve from evidence.

## Time and history

Choose `validFrom.basis` deliberately:

- `official-effective`: the provider gives an authoritative effective instant;
- `reviewed-effective`: the effective instant is established by reviewed evidence but is not directly published as such by the provider;
- `first-observed`: this is the earliest instant for which the price was actually verified.

Never rewrite an older interval just because the price changed. Add a new record with the same pricing identity and set `supersedes` to the immediately preceding record.

If the exact start of an old price cannot be established, leave the earlier period uncovered rather than inventing a boundary. A publication date is not automatically an exact pricing-effective timestamp.

## Rates and modifiers

Every priced record requires:

- input;
- output;
- cache read;
- cache write.

Optional reviewed fields currently include:

- web-search cost per request;
- fast-mode multiplier;
- prompt-input-token threshold bands.

For automatic caching with no separately billed cache-write operation, a reviewed cache write may equal normal uncached input when that is the provider's billing behavior. For Anthropic-style prompt caching, `cacheWritePerToken` is the 5-minute write rate; Metrora can account for one-hour cache writes from the corresponding usage evidence.

Threshold semantics must be exact. The V1 condition is strictly `prompt-input-tokens-above`. If a provider publishes an inclusive integer threshold such as `>= 200000`, `> 199999` is the equivalent V1 condition.

Do not force a price into V1 if an economically material component cannot be represented. Examples include a storage charge that depends on cache duration when the runtime has no corresponding usage evidence. In that case, leave the model uncovered and propose the schema/runtime evidence change separately.

## Zero is not unknown

Use `explicit-zero` only when zero cost is itself supported by evidence, such as a reviewed free route or local inference.

Missing, ambiguous, unsupported, or unknown pricing must stay unavailable. Never encode it as zero.

## Provenance

Each record must keep enough provenance for another reviewer to reproduce the decision:

- `source.kind`;
- stable `source.reference`;
- `source.observedAt`;
- `source.revision` or digest when a pinned revision exists.

Use `manual-reviewed` when the record depends on an explicit reviewed compatibility mapping rather than a provider's literal pricing model identifier.

## Coverage tests

Tests should protect economic behavior, not a catalog-size target. Prefer assertions for:

- representative provider/model identities that must resolve;
- exact effective/retirement boundaries;
- `supersedes` chains when a price changes under the same identity;
- cache, tool, fast-mode and threshold economics;
- exclusions whose omission is intentional and documented.

Do not use a fixed total record count as the acceptance criterion for catalog quality. A count can increase while coverage gets worse, or change legitimately when duplicate, superseded or unsupported records are corrected.

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
- cache and tool charges match the provider's actual billing semantics;
- unsupported components remain explicit gaps rather than approximations;
- coverage tests describe actual reviewed records rather than planned additions;
- the generated pricing history is committed with the catalog change.
