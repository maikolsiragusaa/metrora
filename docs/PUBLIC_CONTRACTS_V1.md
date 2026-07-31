# Qovrion Public Contracts v1

Status: **foundation contract**. These schemas are public, local-first, content-minimal, and intentionally independent from any future commercial control plane.

The TypeScript source of truth lives in `src/contracts/v1/`. Every object is runtime-validated with Zod 4, statically typed, strict against undeclared fields, and exportable as JSON Schema Draft 2020-12.

## Why these contracts exist

Qovrion already has mature collectors, parsers, analytics, desktop surfaces, and local sharing inherited and hardened from CodeBurn. The missing boundary was not another collector framework. It was one stable vocabulary that future desktop, CLI, web, Android, team, export, and managed-advisor surfaces can share without exposing the internal parser model.

The v1 boundary covers:

- workspace identity and membership;
- enrolled endpoint identity and capability;
- privacy-aware repository identity;
- bounded sharing policy;
- normalized AI-usage measurement events and batches;
- verifiable aggregate-usage evidence statements.

It does **not** define billing, hosted BYOK, account provisioning, cloud synchronization, an advisor prompt protocol, or a general authorization engine.

## Standards adopted instead of reinvented

### Zod 4

Qovrion already depends on `zod@3.25.x`, which includes the stable `zod/v4` subpath. The contracts use that existing dependency rather than introducing TypeBox, Joi, Yup, Valibot, or a home-grown validator.

Zod is the executable source of truth and its built-in `z.toJSONSchema()` converter produces language-neutral JSON Schema documents.

### JSON Schema Draft 2020-12 and OpenAPI 3.1

The generated schema target is JSON Schema Draft 2020-12:

- https://json-schema.org/draft/2020-12

When Qovrion exposes a public HTTP control-plane API, it should describe that API with OpenAPI 3.1 or newer. OpenAPI 3.1 aligns its Schema Object with modern JSON Schema and avoids maintaining a separate DTO dialect:

- https://spec.openapis.org/oas/v3.1.1.html

No public HTTP API is created by this tranche.

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

The event type is `dev.qovrion.measurement.ai-usage.v1`.

CloudEvents gives Qovrion a portable event identity and routing envelope without selecting Kafka, NATS, a cloud event bus, or any hosted infrastructure:

- https://github.com/cloudevents/spec

### OpenTelemetry GenAI semantic vocabulary

The measurement data uses the same core concepts as the OpenTelemetry Generative AI semantic conventions:

- operation name;
- AI system/provider;
- requested and response model;
- input and output token usage;
- cache and reasoning token usage.

The OpenTelemetry GenAI conventions are still marked as development and have moved to their own repository. Qovrion therefore records the convention version in each batch instead of importing unstable generated constants into the public wire contract:

- https://github.com/open-telemetry/semantic-conventions-genai

Qovrion extensions cover facts OpenTelemetry does not currently standardize for this product boundary, including cost provenance, repository/session attribution, reasoning attribution confidence, collector evidence, and content-exclusion guarantees.

### in-toto Statement v1

`UsageEvidenceStatementV1` is an in-toto Statement v1 with a Qovrion predicate type. It does not invent a proprietary attestation envelope:

- `_type`: `https://in-toto.io/Statement/v1`
- `predicateType`: `https://schemas.qovrion.dev/attestations/usage-evidence/v1`

The statement subject binds the exact SHA-256 digest of the measurement batch. Runtime validation also checks that the subject and predicate name the same batch and digest.

- https://in-toto.io/docs/specs/

### RFC 8785 canonical JSON

Evidence predicates declare RFC 8785 JSON Canonicalization Scheme as the canonical preimage before hashing:

- https://www.rfc-editor.org/rfc/rfc8785.html

Qovrion must use a tested RFC 8785 implementation when hashing is wired into runtime. It must not create an ad-hoc sorted-key serializer.

### DSSE and Sigstore later, not now

The in-toto statement is intentionally signature-neutral. A later signing tranche can wrap it in DSSE and, where appropriate, use Sigstore bundles or a local enterprise key. No custom `signature` field is added to the statement.

This separation keeps offline local evidence possible and avoids coupling the open contract to a public transparency service.

## Contracts

### `WorkspaceV1`

Defines an opaque workspace identity, display metadata, ownership class, lifecycle status, and timestamps. It contains no billing or deployment-plan fields.

### `WorkspaceMembershipV1`

Defines a user or service principal with one of four stable roles:

- owner;
- admin;
- analyst;
- viewer.

This is a product-level role contract, not a provisioning protocol. SCIM can be adopted later if enterprise directory provisioning is implemented.

### `EndpointV1`

Defines the identity and lifecycle of a desktop, server, or companion endpoint. Identity is a SHA-256 fingerprint of an ECDSA P-256 or Ed25519 public key. Enrollment state is a discriminated contract: pending, active, or revoked records require the timestamps appropriate to that state.

### `RepositoryIdentityV1`

Defines an opaque repository ID and an optional normalized Git remote locator. A remote URL must not include embedded credentials. Shared measurement events refer to the opaque repository ID, not local paths or raw remotes.

### `SharingPolicyV1`

Defines a narrow positive allowlist for aggregate datasets, recipients, time windows, disclosure, and response limits.

V1 can never authorize prompts, responses, source code, patches, secrets, or full local paths. Those fields are literals fixed to `none`.

This is deliberately smaller than OPA/Rego, Cedar, OpenFGA, SpiceDB, or Casbin. Qovrion should adopt one of those systems only when a real multi-user control plane requires delegated authorization evaluation. Embedding a general policy engine in the local core now would add complexity without enforcing an existing product flow.

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

It is not OTLP. OTLP is the transport protocol for OpenTelemetry data and can be added as an adapter when Qovrion actually exports to or receives from an OpenTelemetry Collector. Forcing the existing local historical parsers into OTLP's wire representation now would make the core more complex without improving interoperability.

### `UsageEvidenceStatementV1`

Defines aggregate claims over a measurement batch using an in-toto statement. Claims record totals and assurance separately:

- source coverage;
- token measurement quality;
- pricing quality.

The evidence content policy permanently records that content and local paths were excluded.

## Versioning rules

- `version` changes only for Qovrion contract semantics.
- CloudEvents uses its own `specversion`.
- OpenTelemetry semantic-convention versions are pinned in each measurement batch.
- in-toto uses its own `_type` URI.
- Breaking Qovrion changes create `v2`; v1 schemas are not silently reinterpreted.
- Consumers must reject unknown required fields because all v1 objects are strict.
- Producers may continue emitting v1 after v2 exists.

## Current limits

These contracts have unit and schema-export tests. They are not yet wired into the inherited parser/cache runtime, a hosted service, Android synchronization, or cryptographic signing.

The next implementation step is a narrow adapter from existing `ParsedApiCall` records into `UsageMeasurementEventV1`, validated against real fixtures. Existing collectors remain authoritative until that adapter demonstrates parity.
