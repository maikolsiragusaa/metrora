# GPT-5.6 pricing provenance

Status: **reviewed historical data; runtime assignment not connected**.

This note records why Qovrion's first real historical price-book entries use conservative first-observation boundaries rather than silently applying today's GPT-5.6 prices to every older call.

## Reviewed sequence

The initial public GPT-5.6 pricing was observed in the LiteLLM model-cost repository on 2026-07-09 at commit `a874de6ac60a4c4cc940576adaf181bc4ae8494a`:

- Sol: $5 input / $30 output per million tokens;
- Terra: $2.50 input / $15 output;
- Luna: $1 input / $6 output;
- cached input at 10% of input price;
- cache creation at 1.25 times input price;
- a separate full-request rate above 272,000 prompt-input tokens.

OpenAI announced lower Terra and Luna prices on 2026-07-30. LiteLLM recorded the changed standard-route values at commit `f1b781d06b6155df7c8979110ddc45938c3b81fb`:

- Terra: $2 input / $12 output;
- Luna: $0.20 input / $1.20 output;
- Sol unchanged;
- corresponding cache and long-context rates changed by the same published factors.

## Boundary policy

The public announcement states that the new prices start on July 30 but does not provide an exact UTC billing boundary in the reviewed material. Qovrion therefore records the exact upstream commit timestamps as `first-observed` boundaries:

- initial reviewed observation: `2026-07-09T18:51:12Z`;
- reduced-price observation: `2026-07-30T20:08:01Z`.

This is deliberately conservative:

- usage before the observed reduction keeps the earlier price;
- usage at or after the observed reduction can use the reduced price;
- no exact provider billing hour is fabricated;
- the records can later be superseded by stronger official-effective evidence without mutating the original observations.

## Scope

These entries describe the OpenAI standard API-equivalent route only. They do not collapse or infer:

- Flex, Batch, Priority/Fast, data-residency, Azure, Bedrock, IDE subscription, promotional, or free routes;
- actual cash charged to a user whose usage was included in a plan;
- observed model, provider, client, or source labels.

The historical calculator also fails closed when a call uses web search or a fast route and the selected historical record lacks the corresponding reviewed rate.

No parser, cache, collector, plan, alias, visible total, or current `calculateCost` behavior changes in this data tranche. Runtime assignment and legacy migration require a separate guarded implementation and real-log comparison.
