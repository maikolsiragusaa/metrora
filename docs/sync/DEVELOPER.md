# Metrora sync — developer contract

This document describes the current opt-in sync client, its v1 compatibility wire contract and its offline test boundaries. It is not a production-backend deployment guide.

## Client flow

```text
Metrora client                              Configured remote endpoint
──────────────                              ──────────────────────────
config root/sync.json       (non-secret)
credential backend          (refresh token)
cache root/sync-ledger.json (sent ledger)

metrora sync push
  │
  ├─ read endpoint configuration
  ├─ refresh the OIDC access token
  ├─ collect eligible local usage records for the requested window
  ├─ subtract records already present in the sent-ledger
  ├─ build OTLP/HTTP JSON
  ├─ POST to the configured endpoint with a Bearer token
  ├─ append successful record identities to the ledger
  └─ update lastSync
```

Fresh installations use canonical Metrora config/cache roots. Existing legacy roots are adopted in place when present so upgrades do not silently abandon state.

## Discovery protocol

The v1 protocol currently discovers endpoint metadata at:

```text
GET {baseUrl}/.well-known/metrora-export.json
```

The `metrora-export.json` route name is a **frozen compatibility wire identifier**. It remains only to avoid breaking already compatible endpoints and must not be treated as current product branding.

Example shape:

```json
{
  "version": 1,
  "issuer": "https://auth.example.com",
  "client_id": "example-client-id",
  "scopes": ["openid", "email"],
  "traces_path": "/v1/traces",
  "max_batch_size": 1000
}
```

| Field | Required | Default | Meaning |
|---|---|---|---|
| `version` | No | `1` | Client rejects versions newer than it understands. |
| `issuer` | Yes | — | OIDC issuer URL. |
| `client_id` | Yes | — | OAuth client ID for the deployment. |
| `scopes` | No | `["openid"]` | Requested OIDC scopes. |
| `traces_path` | No | `/v1/traces` | OTLP HTTP POST path. |
| `max_batch_size` | No | `1000` | Maximum spans per request. |

Remote endpoint and issuer URLs must use HTTPS. Plain HTTP is accepted only for loopback development/testing.

## OIDC authentication

The client uses Authorization Code + PKCE:

1. generate a random verifier and SHA-256 challenge;
2. start a loopback callback listener on one of the reviewed fixed ports;
3. open the authorization endpoint in the browser;
4. validate the returned `state` and authorization code;
5. exchange the code using the verifier;
6. store the refresh token using the platform credential backend.

On a later `metrora sync push`, the refresh token is exchanged for a current access token. An invalid/expired refresh grant stops the push and requires the user to run `metrora sync setup <url>` again.

## Credential boundary

Supported storage backends are:

| Platform | Preferred storage |
|---|---|
| macOS | Keychain |
| Linux | libsecret, with permission-restricted file fallback |
| Windows | DPAPI-protected local file |

Canonical credential identity is `metrora-sync`. Existing legacy keychain service entries can be adopted into the canonical service after a successful read. Legacy files remain readable through the shared config-root compatibility boundary.

Secrets are never written to `sync.json` or the sent-ledger.

## OTLP encoding

The payload follows protobuf-JSON mapping for `ExportTraceServiceRequest`.

Deterministic span identity is derived from local record identity so retries remain stable:

```text
span_id  = first 8 bytes of SHA-256(deduplicationKey)
trace_id = first 16 bytes of SHA-256(sessionId)
```

The v1 payload may still contain inherited wire attribute names that are frozen for compatibility. Those identifiers are protocol details, not current UI/product names, and require a separately versioned migration before removal.

## Privacy boundary

The sync payload is metadata-oriented. It does not include prompt bodies, response bodies, source-code contents, diffs, shell-command text, API keys, secrets or unrestricted local paths.

Identity for a remote deployment comes from the authenticated token; the client does not send a user's local account name as a dedicated identity field.

## Sent-ledger

`sync-ledger.json` records successfully sent deduplication keys. Push behavior is:

```text
selected local records
  minus sent-ledger
  = records eligible for this push
```

Entries older than the supported retention window are pruned. A partially rejected OTLP batch is not ledgered as successful because the response does not identify exactly which spans were rejected; the batch can therefore retry with deterministic span IDs.

HTTP 429 handling honors bounded `Retry-After` delays. Authentication or server failures stop the current push without falsely ledgering unsent records.

## Server contract

A compatible endpoint implements:

1. `GET {baseUrl}/.well-known/metrora-export.json` for the v1 discovery document;
2. `POST {baseUrl}{traces_path}` accepting OTLP/HTTP JSON with Bearer authentication.

The server is responsible for validating tokens, applying its own authorization/retention policy and handling deterministic span IDs idempotently.

Metrora does not ship or require a public hosted Community backend as part of this contract.

## Testing

The repository's sync tests are expected to cover discovery parsing, PKCE helpers, callback validation, config read/write, token refresh behavior, sent-ledger semantics and loopback/mock-server flows without requiring a production endpoint.

Tests that require external credentials or a live deployment are developer-controlled and must remain opt-in. Public documentation must not contain real deployment identifiers, private profiles, passwords, test-user credentials or production secrets.
