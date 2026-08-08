# Metrora local pricing observations

Status: **storage, conditional-rate, and resolution contracts implemented; runtime pricing not connected**.

The reviewed repository price book cannot know about a mutable upstream price change until Metrora publishes an update. The local observation ledger closes that timing gap without introducing a hosted dependency or rewriting inherited collection behavior.

## Storage

Each first observation is stored as one immutable private JSON record under the platform Metrora data directory:

```text
pricing/v1/observations/<record-id-hash>.json
```

The ledger reuses Metrora's hardened local-state primitives:

- private directories and files;
- atomic write, file sync, and rename;
- bounded Windows mutation retries;
- stale temporary-file cleanup;
- a cross-process lease shared by CLI and desktop;
- record and filename digests;
- fail-closed scanning when a record or supersession chain is corrupt.

The files contain pricing metadata only. They contain no prompts, responses, source code, project paths, credentials, or user identity.

## Observation semantics

A record is appended only when the economic price or explicit-zero status changes for the exact pricing identity:

- pricing authority;
- pricing model key;
- optional route;
- optional billing tier.

Repeated feed snapshots with the same rates are deduplicated even when the upstream revision or content digest changes. A real price change creates a new immutable record whose `supersedes` field points to the prior local observation.

Every local record:

- uses `first-observed` rather than claiming an undocumented official effective date;
- starts exactly at its source observation timestamp;
- requires a SHA-256 digest of the observed source content;
- never edits the earlier record or backdates the new rate;
- preserves explicit free routes as identities distinct from ordinary paid routes;
- preserves conditional rate bands, including prompt-input thresholds, as part of the immutable economic meaning.

## Conditional rates

A price record may carry ordered rate bands for cases where the provider changes the full request price above a prompt-input threshold. Each band stores complete input, output, cache-read, cache-write, request, and speed rates rather than an ambiguous multiplier.

Historical calculation selects the highest threshold strictly exceeded by the observed request. At the exact threshold, the lower band still applies. When a record has conditional bands but the collector cannot provide trustworthy prompt-size evidence, calculation returns `unavailable` rather than assuming the cheaper base rate.

The calculator keeps billable output explicit because some collectors expose reasoning tokens separately while providers bill them with output. It also preserves the inherited one-hour cache-write treatment and verifies formula parity against the current flat-rate pricing engine.

## Reviewed and local precedence

Resolution considers the bundled reviewed book and the private local ledger together.

- Before a local observation, the reviewed record remains authoritative.
- A later, economically different local observation applies only from its observation time onward.
- Older usage remains on the earlier reviewed interval.
- When the same price is later promoted into the reviewed book, reviewed provenance wins and the local duplicate stops being authoritative.
- Equal-start conflicts prefer the stronger start basis, then the reviewed book.

This contract prepares historical pricing without changing the current `calculateCost`, parser, cache, model-label, plan, or UI behavior. Runtime wiring requires a separate reviewed tranche with legacy migration and real-log comparison.
