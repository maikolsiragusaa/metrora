# Metrora public contracts v1

**Status:** shipped public foundation contracts.

The TypeScript source of truth lives in `src/contracts/v1/`. Every object is runtime-validated, statically typed, strict against undeclared fields and exportable as JSON Schema Draft 2020-12.

These contracts provide one stable, local-first and content-minimal vocabulary for the CLI, desktop application, local dashboard, companion clients, exports and independently verifiable evidence.

## Boundary

The v1 contracts cover:

- Workspace identity and membership;
- enrolled endpoint identity and capability;
- privacy-aware repository identity;
- bounded sharing policy;
- normalized AI-usage measurement events and batches;
- collector provenance profiles;
- verifiable aggregate-usage evidence statements.

They do not create remote transport, account provisioning, server enrollment, billing or a general authorization service.

The contracts define shared semantics rather than a deployment implementation. Any conforming producer or consumer must preserve the same measurement, historical-pricing, provenance, privacy and evidence meaning.

A receiver may validate authorization, schemas, signatures, sequence ranges and duplicate delivery. It must not reparse local tool data, invent missing facts, recalculate tokens, reprice settled history or reinterpret rejected evidence.

## Standards

### Zod 4

Metrora uses the stable `zod/v4` API as the executable source of truth. `z.toJSONSchema()` produces language-neutral schemas.

### JSON Schema Draft 2020-12

Generated schemas target JSON Schema Draft 2020-12:

- `https://json-schema.org/draft/2020-12`

### CloudEvents 1.0

`UsageMeasurementEventV1` uses the CloudEvents 1.0 core envelope:

- `specversion`;
- `id`;
- `source`;
- `type`;
- `time`;
- `subject`;
- `datacontenttype`;
- `dataschema`;
- `data`.

The event type is `dev.metrora.measurement.ai-usage.v1`.

CloudEvents provides portable event identity without coupling the contract to a transport.

### OpenTelemetry Generative AI vocabulary

Measurement data uses the same core concepts as the OpenTelemetry Generative AI semantic conventions:

- operation name;
- AI provider;
- requested and response model;
- input and output tokens;
- cache and reasoning tokens.

Each batch records the semantic-convention version used. Metrora extensions cover cost provenance, opaque attribution, reasoning confidence, collector evidence and content-exclusion guarantees.

### in-toto Statement v1

`UsageEvidenceStatementV1` uses an in-toto Statement v1 envelope with a Metrora predicate type:

- `_type`: `https://in-toto.io/Statement/v1`;
- `predicateType`: `https://schemas.metrora.dev/attestations/usage-evidence/v1`.

The statement subject binds the exact SHA-256 digest of the measurement batch. Runtime validation verifies that the subject and predicate identify the same batch and digest.

### RFC 8785 canonical JSON

Evidence predicates and signed Workspace batch records use RFC 8785 JSON Canonicalization Scheme before hashing:

- `https://www.rfc-editor.org/rfc/rfc8785.html`

Metrora uses a tested RFC 8785 implementation rather than an ad-hoc sorted-key serializer.

## Contracts

### `WorkspaceV1`

Defines an opaque Workspace identity, display metadata, ownership class, lifecycle status and timestamps.

### `WorkspaceMembershipV1`

Defines a user or service principal with one of four stable roles:

- owner;
- admin;
- analyst;
- viewer.

This is a product role contract, not an account-provisioning protocol.

### `EndpointV1`

Defines the identity and lifecycle of a desktop, server or companion endpoint. Identity is a SHA-256 fingerprint of an ECDSA P-256 or Ed25519 public key.

Enrollment state is discriminated: pending, active and revoked records require the timestamps appropriate to their state.

The shipped local Workspace uses a protected Ed25519 endpoint identity. This contract does not create remote enrollment.

### `RepositoryIdentityV1`

Defines an opaque repository ID and an optional normalized Git remote locator. A remote URL must not include embedded credentials.

Shared measurement events refer to the opaque repository ID rather than local paths or raw remotes.

### `SharingPolicyV1`

Defines a narrow positive allowlist for aggregate datasets, recipients, time windows, disclosure and response limits.

V1 cannot authorize prompts, responses, source code, patches, secrets or complete local paths. Those fields are fixed to `none`.

### `UsageMeasurementEventV1`

Defines one normalized usage fact in a CloudEvents envelope. Event data includes only operational metadata, token and cost facts, opaque attribution IDs, quality labels and collector provenance.

The strict schema rejects undeclared payload fields. Privacy flags explicitly record that prompts, responses, source code, patches, secrets and local paths were excluded.

Cost is a discriminated union:

- `metered`: provider, client or billing-export evidence;
- `estimated`: method explicitly recorded;
- `unavailable`: no false zero.

Reasoning attribution is also explicit: a known level requires a source; otherwise level and source remain `unknown`.

### `MeasurementBatchV1`

Batches up to 10,000 CloudEvents measurement records, identifies the producing endpoint and adapter set, pins semantic-convention versions and may chain to a previous batch digest.

The local Workspace persists immutable signed batch records and independently verifies their chain. Network delivery and server acknowledgement are outside this contract.

### `CollectorProvenanceProfileV1`

Defines what one reviewed collector path can prove per field. It does not apply one optimistic “measured” label to an entire call.

Each profile records:

- provenance for input, output, cache-read, cache-write and reasoning tokens;
- model and session identity quality;
- supported reasoning-attribution sources;
- provider-metered or locally priced cost authority;
- pricing-coverage requirements;
- whether raw content or local paths are required.

Profiles are deeply frozen after validation. Embedded parser versions are tested against `PROVIDER_PARSE_VERSIONS`, so a parser change requires explicit provenance review.

`collectorProvenanceProfileForCall()` returns `undefined` for unreviewed collectors. Collector support alone does not create optimistic public evidence.

### `UsageEvidenceStatementV1`

Defines aggregate claims over a measurement batch using an in-toto statement.

Claims record totals and assurance separately:

- source coverage;
- token measurement quality;
- pricing quality.

The evidence content policy permanently records that content and local paths were excluded.

## Projection adapter

`toUsageMeasurementEventV1()` is the first-party projection from normalized `ParsedApiCall` records into the public event contract.

The adapter is an allowlist rather than a serializer:

- it copies token facts and the normalized response model;
- it requires explicit AI provider, operation, collector provenance, cost provenance and quality;
- it never infers the AI provider from the collector name;
- it derives the opaque CloudEvents ID with HMAC-SHA-256 over endpoint, source and private deduplication identity;
- it requires at least 32 bytes of endpoint key material and never exports the key;
- key rotation intentionally breaks cross-key linkability;
- it never exports raw deduplication keys, tools, MCP names, skills, subagents, shell commands, filenames, local paths, prompts, responses, source code or patches;
- it emits `unavailable` rather than inventing zero cost;
- it rejects invalid monetary values, partial reasoning attribution and contradictory session claims;
- it validates its own output through the public schema.

Reviewed production uses this projection only for executable provenance paths and verified immutable pricing assignments. It does not replace collectors or parsers.

## Shipped local runtime use

The contracts participate in the accepted local Workspace runtime through:

- protected endpoint identity;
- explicit local personal Workspace creation;
- provenance-gated measurement production;
- rotation-safe private production receipts;
- append-only measurement outbox;
- active and paused production lifecycle;
- deterministic non-destructive recovery;
- immutable signed batch-chain records;
- independently verifiable user-owned export;
- strict desktop DTO and action boundaries.

Normal analytics remain available without creating a Workspace. No automatic upload or remote dependency is introduced.

Detailed runtime boundaries:

- [`LOCAL_ENDPOINT_IDENTITY_AND_OUTBOX_V1.md`](LOCAL_ENDPOINT_IDENTITY_AND_OUTBOX_V1.md)
- [`WORKSPACE_V1.md`](WORKSPACE_V1.md)
- [`WORKSPACE_EVIDENCE_EXPORT_V1.md`](WORKSPACE_EVIDENCE_EXPORT_V1.md)
- [`DESKTOP_WORKSPACE_RUNTIME_V1.md`](DESKTOP_WORKSPACE_RUNTIME_V1.md)

## Versioning

- `version` changes only for Metrora contract semantics.
- CloudEvents uses its own `specversion`.
- OpenTelemetry semantic-convention versions are pinned in each batch.
- in-toto uses its own `_type` URI.
- breaking Metrora changes require a new major contract version;
- v1 schemas are not silently reinterpreted;
- consumers reject unknown required fields because v1 objects are strict;
- producers may continue emitting v1 after a later version exists.

## Current limits

V1 does not implement:

- network transport or server acknowledgement;
- remote account or endpoint provisioning;
- general multi-user authorization evaluation;
- mobile synchronization through the batch protocol;
- interoperable signature-envelope packaging beyond the shipped local signed records.

Collector evidence coverage remains limited to reviewed paths. Adding a collector requires equivalent source, fixture, parser-version and pricing review.
