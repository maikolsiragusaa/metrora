# Metrora local pricing observations

Status: **storage, conditional-rate, resolution, and runtime-assignment contracts implemented**.

The reviewed repository price book cannot know about a mutable upstream price change until Metrora publishes an update. The local observation ledger closes that timing gap without introducing a hosted dependency, mass-populating the public catalog, or rewriting inherited collection behavior.

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

## Observation identity and semantics

A record is appended only when the economic price or explicit-zero status changes for the exact pricing identity. That identity keeps these dimensions separate:

- pricing authority and pricing model;
- model identity and model owner/developer, when observed;
- inference provider that served the request;
- gateway/router;
- route, billing tier and region.

Repeated feed snapshots with the same rates and policy meaning are deduplicated even when the upstream revision or content digest changes. A real price change creates a new immutable record whose `supersedes` field points to the prior local observation.

Every local record:

- uses `first-observed` rather than claiming an undocumented official effective date;
- starts exactly at its source observation timestamp;
- requires a SHA-256 digest of the observed source content;
- never edits the earlier record or backdates the new rate;
- preserves explicit free routes as identities distinct from ordinary paid routes;
- preserves conditional policies, rate bands, dynamic mode and bounded evidence requirements as part of the immutable economic meaning.

Omitted dimensions stay omitted. The runtime must not fill a missing provider, gateway or authority from the model owner's identity.

## Deterministic and dynamic conditions

Local records use the same V1 policy conditions as the reviewed book. Recurring time windows require an explicit `UTC` or IANA timezone, use a half-open interval (`start <= time < end`), may list weekdays, and assign the after-midnight portion of a crossing-midnight window to the day on which the window began. `validFrom` is inclusive and `validUntil` is exclusive. The ledger does not reconstruct arbitrary surge pricing.

Dynamic pricing is resolved only from bounded provider, gateway or client evidence: a reported tier, a reported multiplier, or quoted rates. Missing, conflicting or ambiguous dynamic evidence returns unavailable rather than a guessed base rate or zero.

## Conditional rates

A price record may carry ordered rate bands for cases where the provider changes the full request price above a prompt-input threshold. Each band stores complete input, output, cache-read, cache-write, request and speed rates rather than an ambiguous multiplier.

Historical calculation selects the highest threshold strictly exceeded by the observed request. At the exact threshold, the lower band still applies. When a record has conditional bands but the collector cannot provide trustworthy prompt-size evidence, calculation returns `unavailable` rather than assuming the cheaper base rate.

The calculator keeps billable output explicit because some collectors expose reasoning tokens separately while providers bill them with output. It also preserves the inherited one-hour cache-write treatment and verifies formula parity against the current flat-rate pricing engine.

## Reviewed and local precedence

Resolution considers the bundled reviewed book and the private local ledger together.

- Before a local observation, the reviewed record remains authoritative.
- A later, economically different local observation applies only from its observation time onward.
- Older usage remains on the earlier reviewed interval.
- When the same price is later promoted into the reviewed book, reviewed provenance wins and the local duplicate stops being authoritative.
- Equal-start conflicts prefer the stronger start basis; a reviewed effective interval outranks a local `first-observed` record.
- A corrupt or unreadable local ledger does not replace reviewed history; runtime reports the ledger problem and keeps reviewed and preserved legacy assignments available.

Resolution requires matching the observed authority and identity dimensions. A gateway or adapter label is not permission to use the original developer's price, and ambiguous matching fails closed.

## Runtime and history boundary

The runtime loads this ledger alongside the reviewed V1 book. It can use a matching local observation for a new assignment, records whether the origin was reviewed or local, and carries that provenance into the immutable cost assignment. It never rewrites an already settled cache assignment.

A comparison or diagnostic evaluation may produce a fresh candidate and a delta without resettling history. The local ledger is supplemental pricing evidence, not a second public catalog and not a source for inventing absent invoice, subscription, credit, tax or entitlement amounts.
