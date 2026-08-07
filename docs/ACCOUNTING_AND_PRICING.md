# Accounting and pricing

Metrora treats cost as a measurement with evidence and time attached to it, not as a single price table applied to every token ever observed.

The goal is to make historical usage useful for comparison without silently rewriting the past when a provider changes pricing or when a request qualifies for a different billing tier.

## What a cost value means

Metrora reports an **API-equivalent value** unless a provider or client exposes a stronger metered value for the same usage.

API-equivalent value is useful for understanding model economics across tools, projects and time. It is not a claim that the number must equal a provider invoice: subscriptions, credits, negotiated rates, taxes, bundled usage and other billing rules can change what a user actually pays.

When trustworthy evidence is unavailable, Metrora keeps that gap explicit rather than silently converting it to zero.

## Historical pricing stays historical

Reviewed price records are date-effective. When Metrora can settle a call against the price that applied when the call occurred, that assignment is preserved instead of being recomputed later with a newer price.

This means a provider price cut does not make earlier usage appear artificially cheaper, and a later price increase does not rewrite old usage upward.

The generated [pricing history](PRICING_HISTORY.md) records the reviewed public rate history used by this accounting path.

## Request-aware valuation

A model name alone is not always enough to determine cost. Where the source data and reviewed pricing record support it, Metrora can account for request-specific pricing conditions such as:

- input and output token rates;
- cache reads and cache writes;
- cache-duration tiers when the provider distinguishes them;
- context or prompt-size tiers;
- route or speed multipliers;
- per-request charges such as supported web-search pricing;
- provider- or client-metered costs when those are the stronger source of truth.

The applicable conditions are selected from evidence available for the individual call. Metrora does not invent a pricing tier when the required evidence is missing.

## Durable totals and available detail

Detailed session files are not guaranteed to live forever. Editors and AI clients can rotate, archive or delete their own local transcripts while the usage they contained is still relevant historically.

Metrora therefore separates two useful views:

- **historical totals**, which preserve settled usage and cost across time when durable evidence is available;
- **available session detail**, which can expose richer token, task and session breakdowns only for source material that still exists locally.

The second view can legitimately be smaller than the first. A missing transcript should not erase previously established historical usage, but Metrora also does not pretend that vanished detail can still be reconstructed.

## Why this matters

Applying one current price table to years of usage can distort model comparisons, budgeting and trend analysis. Ignoring cache or conditional context tiers can distort individual high-value requests even when the model name is correct.

Metrora instead aims for a simple rule:

> Value observed usage using the strongest available evidence and the pricing conditions that applied to that usage at the time.

That rule is shared by the CLI, desktop application, local web dashboard and public accounting contracts. Interfaces may present different levels of detail, but they must not introduce competing cost semantics.

## Boundaries

Accounting remains evidence-aware rather than absolute:

- a provider-metered value can be more authoritative than an API-equivalent calculation;
- subscription coverage is tracked separately from API-equivalent value;
- estimated usage remains marked as estimated;
- explicit zero pricing remains distinct from unknown or unavailable pricing;
- historical totals may outlive the detailed source sessions that originally produced them.

These boundaries are part of the broader [product principles](PRODUCT_PRINCIPLES.md) and evidence model described in the root [README](../README.md).
