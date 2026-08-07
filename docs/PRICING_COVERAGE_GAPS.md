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

### DeepSeek V4 — peak/valley pricing is time-dependent

DeepSeek's direct API currently publishes the normal V4 Flash and V4 Pro token rates. The final V4 Flash release does not by itself require a new historical price interval when those economic rates are unchanged: the reviewed book versions pricing conditions, not model weights.

Current reference:

- `https://api-docs.deepseek.com/quick_start/pricing/`

Separate provider/customer notices and cloud-partner announcements have described peak/valley pricing for V4, with higher rates during specified Beijing-time windows. A time-of-day modifier is not expressible by V1's token-threshold `rateBands`.

Do not pre-apply an announced future tariff before its effective terms are verified, and do not flatten a temporal tariff into one average rate.

A future compatible representation should define at least:

- an effective date for the temporal rule;
- an authoritative timezone;
- one or more local-clock windows and applicable days;
- the rates or multiplier within each window;
- deterministic precedence when a temporal rule combines with another modifier.

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

### OpenAI pre-cache models — input/output known, cache semantics absent

Older OpenAI models such as GPT-4 Turbo, GPT-4 and GPT-3.5 Turbo have authoritative historical input/output prices, but the reviewed evidence for their pre-prompt-caching periods does not provide the cache-read/cache-write dimensions required by the current V1 record shape.

Current V1 requires all four token rates. Encoding missing cache dimensions as zero, or copying the input rate into them, would confuse `not applicable`, `not supported` and `unknown`.

A future schema should be able to state cache behavior explicitly, for example by distinguishing:

- cache unsupported/not applicable;
- cache supported but non-billable;
- cache price unknown;
- cache price known.

Until then, leave those pre-cache intervals uncovered rather than manufacture cache economics.

### Anthropic Claude 3 Haiku — one-hour cache write is an exception

Anthropic's historical pricing table publishes Claude 3 Haiku at $0.25/M normal input, $0.30/M five-minute cache writes, $0.50/M one-hour cache writes, $0.03/M cache reads and $1.25/M output.

Reference:

- `https://docs.anthropic.com/en/docs/about-claude/pricing`

Metrora V1 currently derives a one-hour Anthropic cache write from the five-minute rate using the standard 1.6x relationship. That relationship is exact for the other reviewed Anthropic models in this tranche, but for Claude 3 Haiku it would produce $0.48/M instead of the published $0.50/M.

Do not add Claude 3 Haiku until the record can carry the exact one-hour rate, for example with a `cacheWriteOneHourPerToken` field or a generalized cache-duration-rate representation.

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
- time-of-day / peak-valley pricing;
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
