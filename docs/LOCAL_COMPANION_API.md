# Metrora local companion API v1

**Status:** Implemented local contract used by the accepted Android companion scope. It does not define public Android distribution or remote/managed access.

Metrora exposes a local HTTPS protocol for first-party companion applications and trusted devices. The desktop remains the authority for collection and analysis; companions read a content-minimal versioned summary over the local network.

## Compatibility

The stable first-party route prefix is `/api/v1`.

| Stable endpoint | Compatibility endpoint | Purpose |
| --- | --- | --- |
| `GET /api/v1/peer/hello` | `GET /api/peer/hello` | Discover identity, versions and pairing methods |
| `POST /api/v1/peer/pair-request` | `POST /api/peer/pair-request` | Request approval using a code compared on both devices |
| `POST /api/v1/peer/revoke` | `POST /api/peer/revoke` | Revoke the calling certificate/token peer |
| `GET /api/v1/usage` | `GET /api/usage` | Read a stable companion DTO for a period or range |

The inherited `POST /api/peer/pair` PIN flow remains only as a compatibility fallback. New first-party clients must use `pair-request` and compare the complete confirmation code.

The unversioned `/api/usage` response remains the inherited desktop payload for desktop-to-desktop compatibility. `/api/v1/usage` is not a path alias: it returns the explicit `CompanionUsageV1` contract described below.

## Discovery response

`GET /api/v1/peer/hello` is unauthenticated and returns no usage data.

```json
{
  "product": "metrora",
  "apiVersion": 1,
  "apiVersions": [1],
  "fingerprint": "...",
  "name": "...",
  "pairingOpen": false,
  "pairingMethods": ["approve-sas"]
}
```

The client observes the self-signed desktop certificate and verifies that its SHA-256 fingerprint equals the advertised value. That observation is not sufficient by itself to authenticate the first contact; the pairing confirmation code completes that verification.

## Pairing

The client creates and retains its own certificate identity, then sends:

```http
POST /api/v1/peer/pair-request
Content-Type: application/json

{"name":"Android phone"}
```

Both devices derive the same six-digit short authentication string from the two certificate fingerprints. The complete code is shown on both devices. The desktop owner approves only when every digit matches.

A successful response contains the bearer token, desktop fingerprint, desktop name and confirmed code. The client must reject the response if the fingerprint or code changed during the request.

## Authorization and revocation

The protocol uses HTTPS with mutual TLS. Usage and revocation require both:

1. the client certificate fingerprint of a paired device; and
2. the bearer token issued to that same fingerprint.

A copied token presented with another certificate is rejected.

`POST /api/v1/peer/revoke` removes the authenticated peer from the desktop and invalidates its token. A client must distinguish remote revocation from merely deleting its local credential copy.

## Usage query

`GET /api/v1/usage` accepts:

- `period=<today|week|30days|month|all|lifetime>`; or
- `from=YYYY-MM-DD&to=YYYY-MM-DD`.

The response is `CompanionUsageV1`:

```json
{
  "kind": "metrora.companion.usage",
  "version": 1,
  "generatedAt": "2026-07-31T10:30:00.000Z",
  "period": {
    "label": "This month"
  },
  "totals": {
    "costMicrosUsd": 1234567,
    "estimatedCostMicrosUsd": null,
    "calls": 12,
    "sessions": 4,
    "tokens": {
      "input": 100,
      "output": 50,
      "cacheRead": 25,
      "cacheWrite": 5,
      "total": 180
    },
    "cacheHitPercent": 20.5
  },
  "topModels": [
    {
      "name": "Model A",
      "calls": 8,
      "costMicrosUsd": 1100000,
      "estimatedCostMicrosUsd": null
    }
  ],
  "quality": {
    "pricingCoverage": 0.875
  }
}
```

The DTO deliberately excludes projects, session titles, local paths, findings, prompts, responses, source code, patches, tool arguments and secrets. New fields may be added compatibly within v1; removal or semantic changes require a new version.

## Offline behavior

A companion may retain the most recent successful DTO in encrypted local storage for offline viewing. It must display the retrieval timestamp and clearly indicate when cached data is being shown. Cache behavior does not change desktop authority.
