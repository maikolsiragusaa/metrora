# Qovrion local companion API v1

Qovrion exposes a local HTTPS protocol for first-party companion applications and trusted devices. The desktop remains the authority for collection and analysis; companions read sanitized usage summaries over the local network.

## Compatibility

The stable route prefix is `/api/v1`.

The inherited unversioned endpoints remain available as compatibility aliases:

| Stable endpoint | Compatibility endpoint | Purpose |
| --- | --- | --- |
| `GET /api/v1/peer/hello` | `GET /api/peer/hello` | Discover identity, supported versions and pairing state |
| `POST /api/v1/peer/pair` | `POST /api/peer/pair` | Pair with a short-lived PIN |
| `POST /api/v1/peer/pair-request` | `POST /api/peer/pair-request` | Request interactive approval with a matching code |
| `GET /api/v1/usage` | `GET /api/usage` | Read sanitized usage for a period or date range |

New first-party clients must use `/api/v1`. Compatibility endpoints may be removed only in a future major protocol transition with an explicit migration path.

## Discovery response

`GET /api/v1/peer/hello` is unauthenticated and returns no usage data. Its response includes:

```json
{
  "product": "qovrion",
  "apiVersion": 1,
  "apiVersions": [1],
  "fingerprint": "...",
  "name": "...",
  "pairingOpen": false
}
```

Clients must pin the advertised server certificate fingerprint before pairing or reading usage.

## Security boundary

The protocol uses HTTPS with mutual TLS. Usage requests require both:

1. the client certificate fingerprint of a paired device; and
2. the bearer token issued to that same fingerprint during pairing.

A token presented from a different client certificate is rejected. Pairing is either time-bounded by a one-time PIN or explicitly approved by the desktop user. The server shares sanitized aggregates and does not expose prompts, source code, transcripts, secrets or unrestricted local paths.

## Usage query

`GET /api/v1/usage` accepts the existing query contract:

- `period=<today|week|30days|month|all|lifetime>`; or
- `from=YYYY-MM-DD&to=YYYY-MM-DD`.

The response is the sanitized Qovrion menubar/usage payload. The Android companion should cache the most recent successful payload locally for offline viewing and clearly display its retrieval timestamp; cache behavior is a client responsibility and does not change the desktop authority.
