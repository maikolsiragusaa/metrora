# Accounting and pricing

Metrora treats cost as a measurement with evidence and time attached to it, not as a single price table applied to every token ever observed.

The goal is to make historical usage useful for comparison without silently rewriting the past when a provider changes pricing or when a request qualifies for a different billing tier.

## Pricing identity is multidimensional

A model name is not a pricing authority. A pricing decision may depend on all of the following dimensions when the source can establish them:

- model identity;
- model owner or developer;
- inference provider that actually served the request;
- billing or pricing authority;
- gateway or router on the request path;
- route;
- billing tier;
- region or deployment variant;
- request evidence such as timestamp, token and cache counts, speed, web-search/tool activity, and provider, gateway or client billing evidence.

The same model can therefore have different prices through different providers or routes. An adapter label, client name or gateway name is evidence about the path; it is not automatically the authority for the price. If a dimension is absent, Metrora does not fill it from the model owner's identity or silently substitute the original developer's price for a third-party hosted route.

## What a cost value means

Metrora reports an **API-equivalent value** unless a provider, client or billing export exposes a stronger metered value for the same usage. An estimated inference amount is not exact billing evidence.

API-equivalent value is useful for understanding model economics across tools, projects and time. It is not a claim that the number must equal a provider invoice: subscriptions, credits, bundled usage, negotiated rates, taxes, allowances and other entitlement rules can change what a user actually pays. Those overlays remain separate from canonical API-equivalent history.

For a fresh assignment, evidence is considered in this order:

1. trustworthy provider-, client- or billing-export-metered cost;
2. an exact policy calculation supported by the request evidence, including any required dynamic quote, tier or multiplier;
3. a safe reviewed historical price record whose identity and effective interval match the request;
4. an explicit unavailable result or a preserved `legacy-frozen` value when only an older assignment exists.

`UNKNOWN` is not `ZERO`. Explicit zero is used only when a reviewed free route, free model or local-inference path proves that zero is intentional. Missing, ambiguous or unsupported pricing remains unavailable; a gateway or adapter must not silently fall back to the original developer's price.

## Deterministic conditions and dynamic evidence

Date-effective records use explicit ISO instants. Recurring pricing windows carry an explicit `UTC` or IANA timezone, use a half-open interval (`start <= time < end`), and may restrict the window to selected weekdays. A window that crosses midnight assigns its after-midnight portion to the day on which the window began. `validFrom` is inclusive and `validUntil` is exclusive. Metrora does not reconstruct arbitrary surge pricing from an unexplained timestamp or a guessed schedule.

Deterministic request policies may select rates by route, billing tier, speed, cache tier, prompt-input threshold or time window. Dynamic pricing is different: it is resolvable only with bounded request-time evidence such as a provider-reported tier, a provider/gateway/client-reported multiplier, or quoted rates. If the required evidence is missing, conflicting or equally ambiguous, the calculation fails closed as unavailable.

## Bounded request charges

The V1 accounting surface covers bounded charges that can be tied to a request:

- input and output tokens, including separately evidenced reasoning tokens where the provider bills them with output;
- cache reads and cache writes, including supported cache-duration treatment;
- web-search or other supported per-request charges;
- gateway or service charges per request;
- tool-request charges per request.

These are not an arbitrary invoice parser. Unsupported storage, subscription, tax, credit, negotiated, bundled or entitlement charges are not invented inside API-equivalent valuation.

## Historical pricing stays historical

Reviewed price records are date-effective and use immutable supersession chains. When Metrora settles a call, the assignment records the evidence, price record and selected policy or rate band that produced the amount. A later catalog refresh, alias change or local observation cannot rewrite that settled assignment.

Runtime parsing carries the assignment through normalized calls and the v8 session cache. A fresh diagnostic or comparison candidate is kept separate from the stored historical assignment, so comparison can explain a possible delta without resettling the past.

The generated [pricing history](PRICING_HISTORY.md) records the reviewed public rate history used by this accounting path. The catalog remains V1: optional identity, policy, dynamic-evidence and request-charge fields extend records additively; they do not create a catalog schema V2. “Pricing Policy Engine V2” names the implementation tranche, not a new catalog schema.

## Durable totals and available detail

Detailed session files are not guaranteed to live forever. Editors and AI clients can rotate, archive or delete their own local transcripts while the usage they contained is still relevant historically.

Metrora therefore separates two useful views:

- **historical totals**, which preserve settled usage and cost across time when durable evidence is available;
- **available session detail**, which can expose richer token, task and session breakdowns only for source material that still exists locally.

The second view can legitimately be smaller than the first. A missing transcript should not erase previously established historical usage, but Metrora also does not pretend that vanished detail can still be reconstructed.

## Why this matters

Applying one current price table to years of usage can distort model comparisons, budgeting and trend analysis. Ignoring cache, conditional context tiers or route-specific charges can distort individual requests even when the model name is correct.

Metrora instead aims for a simple rule:

> Value observed usage using the strongest available evidence and the pricing conditions that applied to that usage at the time.

That rule is shared by the CLI, desktop application, local web dashboard and public accounting contracts. Interfaces may present different levels of detail, but they must not introduce competing cost semantics.

## Boundaries

Accounting remains evidence-aware rather than absolute:

- a trustworthy metered value can be more authoritative than an API-equivalent calculation;
- subscriptions, credits, bundled usage, negotiated rates and taxes stay separate from API-equivalent value;
- estimated usage remains marked as estimated;
- explicit zero pricing remains distinct from unknown or unavailable pricing;
- historical totals may outlive the detailed source sessions that originally produced them.

These boundaries are part of the broader [product principles](PRODUCT_PRINCIPLES.md), the [cost assignment contract](COST_ASSIGNMENT_V1.md) and the evidence model described in the root [README](../README.md).
