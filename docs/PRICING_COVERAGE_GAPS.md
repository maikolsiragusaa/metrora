# Pricing coverage gaps

Metrora's reviewed historical price book is intentionally narrower than its live/fallback model-price registry. A model belongs in the historical book only when its economics can be represented from evidence that Metrora actually records.

This page tracks pricing structures that were researched but deliberately not forced into `catalog.v1.json`.

## Review method

For reviewed pricing data:

1. use provider pricing/API documentation as the primary authority;
2. use dated provider announcements or changelogs to establish or corroborate product/model transitions;
3. use reputable reporting to corroborate material pricing changes where useful;
4. use community reports only to find discrepancies, route differences, stale integrations, or undocumented edge cases;
5. never promote a community-reported number into the reviewed price book without stronger evidence.

Subscription quotas, bundled credits and reseller prices are separate economic routes from direct API-equivalent pricing. They must not be blended into the standard API route.

## Current reviewed gaps

### Google Gemini — cache storage depends on time

Official Gemini API pricing includes context-cache storage charged per cached token per hour in addition to cached-token processing. Current references:

- `https://ai.google.dev/gemini-api/docs/pricing`
- `https://ai.google.dev/gemini-api/docs/caching`

`catalog.v1.json` can express input, output, cache reads, cache writes, web search, fast multipliers and prompt-size bands. It cannot express a duration-dependent cache-storage charge. More importantly, a price field alone would not make the calculation correct: Metrora would also need evidence of how many tokens remained stored for how long.

Do not add a Gemini reviewed record that silently omits storage when storage is economically applicable.

A future compatible design should distinguish at least:

- a reviewed rate such as `cacheStoragePerTokenHour`;
- usage evidence representing cached token-time (or explicit cache create/expire events from which token-time can be derived);
- provenance for whether duration is observed or derived;
- settlement logic that never infers storage duration merely from a later cache read.

This crosses collector/runtime/accounting contracts and should be implemented as a dedicated reviewed change rather than hidden inside a catalog update.

### Qwen / Alibaba Model Studio — cached tokens need normalization first

Official Model Studio pricing documents direct API pricing, deployment scopes, thinking/non-thinking variants, request-size tiers and context caching. Current reference:

- `https://www.alibabacloud.com/help/en/model-studio/model-pricing`

Metrora's Qwen collector currently exposes the provider's full `promptTokenCount` as `inputTokens` and also exposes `cachedContentTokenCount` as cache-read tokens. Because the provider's prompt count contains cached tokens, historical settlement would risk charging cached tokens once at the normal input rate and again at the cache-read rate.

Before adding reviewed Qwen pricing, normalize the collector/accounting evidence so uncached input and cached input are disjoint. Preserve the raw provider counters or provenance needed to audit that normalization.

### MiniMax M3 — cache-write economics not established by the reviewed source

The current MiniMax pay-as-you-go table publishes M3 input, output and cache-read pricing, including a context-size tier, but the reviewed table does not establish a cache-write price as explicitly as it does for M2.7.

Reference:

- `https://platform.minimax.io/subscribe/token-plan?tab=api-enterprise`

Do not reuse a live-registry heuristic as historical evidence. Keep M3 uncovered until the provider documentation or another stable primary source establishes the missing billing behavior.

### Z.ai / GLM — cache storage is currently promotional zero

Current Z.ai documentation publishes separate normal input and cached-input rates and describes cached-input storage as `Limited-time Free`.

References:

- `https://docs.z.ai/guides/overview/pricing`
- `https://docs.z.ai/guides/capabilities/cache`

The current direct-API-equivalent calculation is representable while storage is free. If Z.ai later charges cache storage by duration, add a new date-effective interval only after Metrora can represent the new component. Do not rewrite the current interval retroactively.

### Mistral — direct API covered; collector evidence varies by route

Mistral's API documents prompt caching explicitly: cached prompt tokens are billed at 10% of normal input, `prompt_tokens` includes cached tokens, and uncached input is `prompt_tokens - cached_tokens`.

References:

- `https://docs.mistral.ai/studio-api/conversations/advanced/prompt-caching`
- `https://mistral.ai/pricing/api/`

The direct API pricing structure is representable in V1 and `mistral-medium-3.5` is now covered by a reviewed direct API-equivalent record. Metrora's Vibe collector can also receive an already-computed `session_cost` or configured per-million prices from the client. Those stronger client-provided values remain distinct from direct API-equivalent historical valuation and must not be reinterpreted as subscription or API pricing for another route.

### Cohere — cache semantics not established for the required V1 fields

Cohere publishes token prices for Command models, but the reviewed sources used in this pass did not establish prompt-cache read/write billing semantics sufficient to populate V1's required cache fields without inference.

References:

- `https://docs.cohere.com/docs/models`
- `https://cohere.com/pricing`

Keep these models uncovered until either the cache economics are documented or the schema can express a model/route for which caching is explicitly not a billable dimension without pretending that unknown equals zero.

## Route and modifier gaps to keep separate

The following should remain distinct pricing identities or future modifiers rather than being folded into a standard API record:

- batch discounts;
- regional or data-residency premiums;
- priority/flex/low-latency routes;
- subscriptions and bundled token plans;
- reseller or gateway markups;
- per-tool charges not represented by observed tool-request counts;
- multimodal unit prices that are not token-equivalent;
- temporary promotions with an unknown end instant.

## When to extend the schema

Extend the reviewed pricing schema only when all three are true:

1. the economic component is material and supported by authoritative evidence;
2. Metrora can observe or defensibly derive the usage quantity needed to settle it;
3. the representation preserves historical provenance and does not silently reinterpret older records.

A broader schema that cannot be settled from recorded evidence is not better coverage. It is only a larger source of false precision.
