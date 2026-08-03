# Metrora Public Contracts v1

Status: **shipped public foundation contracts**. These schemas are public, local-first, content-minimal, and intentionally independent from any future commercial control plane.

The TypeScript source of truth lives in `src/contracts/v1/`. Every object is runtime-validated with Zod 4, statically typed, strict against undeclared fields, and exportable as JSON Schema Draft 2020-12.

## Why these contracts exist

Metrora has mature collectors, parsers, analytics, desktop surfaces, and local sharing inherited and hardened from CodeBurn. The missing boundary was not another collector framework. It was one stable vocabulary that desktop, CLI, web, Android, export, and any future networked surface can share without exposing the internal parser model.

The v1 boundary covers:

- workspace identity and membership;
- enrolled endpoint identity and capability;
- privacy-aware repository identity;
- bounded sharing policy;
- normalized AI-usage measurement events and batches;
- collector provenance profiles;
- verifiable aggregate-usage evidence statements.

It does **not** define billing, hosted BYOK, account provisioning, cloud synchronization, enterprise deployment, an advisor prompt protocol, or a general authorization engine.

The existence of these contracts is not a claim that a managed service, account system or complete self-hosted server exists.

## Deployment-neutral authority

The contracts are shared public semantics, not a server implementation.

Local production, any future managed Workspace and any future customer-operated deployment must use the same measurement, historical-pricing, provenance and evidence meaning.

A future receiver may validate authorization, schemas, signatures, sequence ranges and duplicate delivery. It must not reparse local tool data, invent missing facts, recalculate tokens, reprice settled history or silently reinterpret rejected evidence.

## Standards adopted instead of reinvented

### Zod 4

Metrora uses the stable `zod/v4` subpath already available through the project dependency rather than introducing TypeBox, Joi, Yup, Valibot, or a home-grown validator.

Zod is the executable source of truth and its built-in `z.toJSONSchema()` converter produces language-neutral JSON Schema documents.

### JSON Schema Draft 2020-12 and OpenAPI 3.1

The generated schema target is JSON Schema Draft 2020-12:

- https://json-schema.org/draft/2020-12

If Metrora later exposes a public HTTP control-plane API, that API should use OpenAPI 3.1 or newer so its Schema Object remains aligned with modern JSON Schema:

- https://spec.openapis.org/oas/v3.1.1.html

No public hosted HTTP control-plane API is created by this contract.

### CloudEvents 1.0

Each `UsageMeasurementEventV1` uses the CloudEvents 1.0 core envelope:

- `specversion`
- `id`
- `source`
- `type`
- `time`
- `subject`
- `datacontenttype`
- `dataschema`
- `data`

The event type is `dev.metrora.measurement.ai-usage.v1`.

CloudEvents gives Metrora a portable event identity and routing envelope without selecting Kafka, NATS, a cloud event bus, or any hosted infrastructure:

- https://github.com/cloudevents/spec

### OpenTelemetry GenAI semantic vocabulary

The measurement data uses the same core concepts as the OpenTelemetry Generative AI semantic conventions:

- operation name;
- AI provider;
- requested and response model;
- input and output token usage;
- cache and reasoning token usage.

Metrora records the convention version in each batch rather than importing unstable generated constants into the public wire contract:

- https://github.com/open-telemetry/semantic-conventions-genai

Metrora extensions cover facts OpenTelemetry does not standardize for this product boundary, including cost provenance, repository/session attribution, reasoning-attribution confidence, collector evidence, and content-exclusion guarantees.

### in-toto Statement v1

`UsageEvidenceStatementV1` is an in-toto Statement v1 with a Metrora predicate type. It does not invent a proprietary attestation envelope:

- `_type`: `https://in-toto.io/Statement/v1`
- `predicateType`: `https://schemas.metrora.dev/attestations/usage-evidence/v1`

The statement subject binds the exact SHA-256 digest of the measurement batch. Runtime validation also checks that the subject and predicate name the same batch and digest.

- https://in-toto.io/docs/specs/

### RFC 8785 canonical JSON

Evidence predicates and signed Workspace batch records use RFC 8785 JSON Canonicalization Scheme before hashing:

- https://www.rfc-editor.org/rfc/rfc8785.html

Metrora uses a tested RFC 8785 implementation rather than an ad-hoc sorted-key serializer.

### Signature packaging remains separable

The public in-toto statement remains signature-neutral. The shipped local Workspace runtime signs its bounded batch-chain records with the protected endpoint identity and verifies exported packages independently.

A future interoperable DSSE or Sigstore wrapper remains a separate contract decision. No hosted transparency service is required for offline local evidence.

## Contracts

### `WorkspaceV1`

Defines an opaque workspace identity, display metadata, ownership class, lifecycle status, and timestamps. It contains no billing or deployment-plan fields.

### `WorkspaceMembershipV1`

Defines a user or service principal with one of four stable roles:

- owner;
- admin;
- analyst;
- viewer.

This is a product-level role contract, not a provisioning protocol. SCIM can be considered only if enterprise directory provisioning is separately implemented.

### `EndpointV1`

Defines the identity and lifecycle of a desktop, server, or companion endpoint. Identity is a SHA-256 fingerprint of an ECDSA P-256 or Ed25519 public key. Enrollment state is a discriminated contract: pending, active, or revoked records require the timestamps appropriate to that state.

The shipped local Workspace uses a protected Ed25519 endpoint identity. The contract does not create a remote enrollment service.

### `RepositoryIdentityV1`

Defines an opaque repository ID and an optional normalized Git remote locator. A remote URL must not include embedded credentials. Shared measurement events refer to the opaque repository ID, not local paths or raw remotes.

### `SharingPolicyV1`

Defines a narrow positive allowlist for aggregate datasets, recipients, time windows, disclosure, and response limits.

V1 can never authorize prompts, responses, source code, patches, secrets, or full local paths. Those fields are literals fixed to `none`.

This is deliberately smaller than OPA/Rego, Cedar, OpenFGA, SpiceDB, or Casbin. Metrora should adopt a general policy engine only when a real multi-user control plane requires delegated authorization evaluation.

### `UsageMeasurementEventV1`

Defines one normalized usage fact in a CloudEvents envelope. The event data includes only operational metadata, token/cost facts, opaque attribution IDs, quality labels, and collector provenance.

Its strict schema rejects undeclared payload fields. Prompts, responses, source code, patches, secrets, and local paths are additionally represented by mandatory `false` privacy flags.

Cost is a discriminated union:

- `metered`: provider/client/billing-export evidence;
- `estimated`: method explicitly recorded;
- `unavailable`: no false zero.

Reasoning is also explicit: a known level requires an attribution source; otherwise both level and source are `unknown`.

### `MeasurementBatchV1`

Batches up to 10,000 CloudEvents measurement records, identifies the producing endpoint and adapter set, pins the semantic-convention versions, and optionally chains to a previous batch digest.

It is not OTLP. OTLP may be added as an adapter if Metrora later exports to or receives from an OpenTelemetry Collector. Existing local historical parsers are not forced into OTLP's wire representation.

The local Workspace runtime persists immutable signed batch records and independently verifies their chain. No network uploader or server acknowledgement implementation is shipped.

### `CollectorProvenanceProfileV1`

Defines what one reviewed collector path can prove, per field. It does not use a single optimistic “measured” badge for an entire call.

The initial registry contains reviewed Claude and Codex paths. For each path the profile records:

- provenance of input, output, cache-read, cache-write, and reasoning tokens;
- model and session identity quality;
- supported reasoning-attribution sources;
- whether cost is provider-metered or locally priced;
- whether pricing coverage must be established before a cost claim is exported;
- whether raw content or local paths are required.

Profile objects are deeply frozen after Zod validation. Embedded parser versions are tested against `PROVIDER_PARSE_VERSIONS`; a parser change therefore forces an explicit provenance review instead of silently inheriting old guarantees.

`collectorProvenanceProfileForCall()` returns `undefined` for every unreviewed collector. Existing collector support does not create optimistic public evidence by default.

### `UsageEvidenceStatementV1`

Defines aggregate claims over a measurement batch using an in-toto statement. Claims record totals and assurance separately:

- source coverage;
- token measurement quality;
- pricing quality.

The evidence content policy permanently records that content and local paths were excluded.

## Internal projection adapter

`toUsageMeasurementEventV1()` is the only first-party projection from the normalized `ParsedApiCall` record into the public event contract.

The adapter is deliberately an allowlist rather than a serializer:

- it copies token facts and the normalized response model;
- it requires the caller to declare the actual AI provider, operation, collector provenance, cost provenance, and quality;
- it never infers the AI provider from the collector name;
- it derives the opaque CloudEvents ID with HMAC-SHA-256 over endpoint, source, and private deduplication identity;
- it requires at least 32 bytes of local endpoint key material, never exports that key, and intentionally breaks cross-key linkability when the key rotates;
- it never exports the raw deduplication key, tools, MCP names, skills, subagents, shell commands, file names, local paths, prompts, responses, source code, or patches;
- it emits `unavailable` rather than inventing a zero when cost evidence is absent;
- it rejects invalid monetary values instead of silently clamping them;
- it rejects partial reasoning attribution and non-unknown session quality without an exported session ID;
- it validates its own output through the public Zod schema before returning it.

The shipped reviewed-production boundary uses this projection only for exact executable provenance paths and verified immutable pricing assignments. It does not replace collectors or parsers.

## Shipped local runtime use

The public contracts now participate in the accepted local Workspace runtime:

- protected local endpoint identity;
- explicit local personal Workspace creation;
- reviewed provenance-gated event production;
- rotation-safe private production receipts;
- append-only local measurement outbox;
- active/paused production lifecycle;
- deterministic non-destructive recovery;
- immutable signed batch-chain records;
- independently verifiable user-owned export;
- strict desktop DTO and action boundaries.

Normal analytics remain available without creating a Workspace. No automatic upload or hosted dependency is introduced.

Detailed runtime boundaries live in:

- `docs/LOCAL_ENDPOINT_IDENTITY_AND_OUTBOX_V1.md`;
- `docs/WORKSPACE_V1.md`;
- `docs/WORKSPACE_EVIDENCE_EXPORT_V1.md`;
- `docs/DESKTOP_WORKSPACE_RUNTIME_V1.md`.

## Versioning rules

- `version` changes only for Metrora contract semantics.
- CloudEvents uses its own `specversion`.
- OpenTelemetry semantic-convention versions are pinned in each measurement batch.
- in-toto uses its own `_type` URI.
- Breaking Metrora changes create `v2`; v1 schemas are not silently reinterpreted.
- Consumers reject unknown required fields because all v1 objects are strict.
- Producers may continue emitting v1 after v2 exists.
- A future deployment mode cannot reinterpret v1 to create different pricing, evidence or privacy semantics.

## Current limits

The following remain unimplemented or not authorized:

- hosted synchronization and network transport;
- account or tenant provisioning;
- endpoint-to-server enrollment credentials;
- a server acknowledgement issuer;
- managed retention, deletion and offboarding;
- general multi-user authorization evaluation;
- Android synchronization through the public batch protocol;
- DSSE/Sigstore interoperability packaging;
- a hosted evidence store or manager console;
- enterprise private deployment;
- SSO/SCIM, billing, entitlement or remote lifecycle control.

Collector evidence coverage remains intentionally limited to reviewed paths. Adding another collector requires equivalent source, fixture, parser-version and pricing review.

C3-P0 — Canonical Observation, Activity and History Authority is ratified as a future core milestone. This document does not define or anticipate its storage schema, database, identity algorithm or migration mechanics.
