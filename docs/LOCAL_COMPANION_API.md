# Metrora local companion API v1

**Status:** implemented local HTTPS contract used by the Android companion. It does not define public Android distribution, remote access, cloud relay or a managed service.

Desktop/core is the authority for collection, normalization, canonical history, accounting, pricing, evidence and Project aggregation. The companion API exposes bounded, versioned projections over the authenticated local connection.

## Compatibility and security

The stable first-party route prefix is `/api/v1`. The inherited unversioned paths remain for compatibility where noted.

| Stable endpoint | Compatibility endpoint | Purpose |
| --- | --- | --- |
| `GET /api/v1/peer/hello` | `GET /api/peer/hello` | Discover Desktop identity, API versions and pairing methods |
| `POST /api/v1/peer/pair-request` | `POST /api/peer/pair-request` | Request approval using a SAS compared on both devices |
| `POST /api/v1/peer/revoke` | `POST /api/peer/revoke` | Revoke the authenticated certificate/token peer |
| `GET /api/v1/usage` | `GET /api/usage` | Read the bounded `CompanionUsageV1` Home contract |
| `GET /api/v1/capabilities` | — | Discover domain availability and supported contract versions |
| `GET /api/v1/foundation` | — | Read the bounded Mobile Product Foundation V1 projection |

All authenticated endpoints require HTTPS mutual TLS and the bearer token issued to the same client certificate fingerprint. A copied token with another certificate is rejected. Discovery and the QR payload carry connection/identity information only; pairing still requires certificate verification, SAS comparison and explicit Desktop approval.

## Usage and Project scope

`GET /api/v1/usage` accepts `period=<today|week|30days|month|all|lifetime>`, optional `granularity=<day|week|month>`, or the existing `from=YYYY-MM-DD&to=YYYY-MM-DD` range. A user-created Project scope is selected with:

```text
projectScopeId=all
projectScopeId=unassigned
projectScopeId=mp_<stable-project-id>
```

`all` is the default and may be omitted. `unassigned` and `mp_…` are canonical membership scopes, not display-name filters. The same scope is applied by the existing accounting/history authority; the server does not recalculate spend in a second mobile engine.

The response remains `CompanionUsageV1`, including integer micro-USD totals, calls, sessions, tokens, cache-hit percentage, bounded model rows, pricing coverage and optional trend buckets. Existing clients that understand only this contract remain compatible.

`providerId` is the factual route/provider identity and `brandId` is Desktop-derived model-owner branding. They are independent and optional. A missing or ambiguous value remains unavailable; companions must not infer either identity from a model display name or collector label.

## Capability discovery

`GET /api/v1/capabilities` returns a small versioned matrix:

```json
{
  "kind": "metrora.companion.capabilities",
  "version": 1,
  "generatedAt": "2026-08-14T10:00:00.000Z",
  "capabilities": [
    {
      "id": "activity.sessions",
      "versions": [1],
      "availability": "available",
      "freshness": "cached",
      "scopes": {"period": true, "project": true, "workspace": false}
    },
    {
      "id": "workspace",
      "versions": [1],
      "availability": "unavailable",
      "freshness": "unknown",
      "scopes": {"period": false, "project": false, "workspace": false},
      "reason": "no-authority"
    }
  ]
}
```

The bounded capability IDs are `home.usage`, `projects`, `activity.sessions`, `analyze.models`, `analyze.spend`, `workspace` and `device.settings`. Clients negotiate an intersection of advertised and supported versions. Unknown or unsupported capability versions fail safe to unavailable; they do not produce guessed UI or data.

## Mobile Foundation V1

`GET /api/v1/foundation` accepts the same period, trend and `projectScopeId` query dimensions and returns:

```json
{
  "kind": "metrora.companion.foundation",
  "version": 1,
  "generatedAt": "2026-08-14T10:00:00.000Z",
  "capabilities": {"kind": "metrora.companion.capabilities", "version": 1, "capabilities": []},
  "projectScope": {
    "selectedId": "mp_<stable-project-id>",
    "options": [{"id": "all", "name": "All projects", "icon": "grid", "color": "cyan", "sourceProjectCount": 1}],
    "sourceProjects": [{"id": "sp_<derived-source-id>", "name": "metrora", "contributors": [], "assignedProjectId": "mp_<stable-project-id>"}],
    "registry": {"status": "valid", "writable": true}
  },
  "activity": {"available": true, "freshness": "cached", "sessions": []},
  "analyze": {
    "models": {"available": true, "freshness": "cached", "rows": []},
    "spend": {"available": true, "freshness": "cached", "data": {"costMicrosUsd": 0, "calls": 0, "sessions": 0, "trend": []}}
  },
  "workspace": {"available": false, "reason": "no-authority"}
}
```

The DTO is deliberately bounded and content-minimal. Activity rows contain only stable/hash-like session identity, safe date metadata, Project/Source Project identity, bounded model names, factual source/route/brand IDs and numeric totals. The contract excludes prompts, assistant responses, source code, patches, tool arguments, secrets, unrestricted filesystem paths and content-derived mobile titles. Model rows contain bounded accounting totals and the same separate brand/route/source facts. Spend contains bounded totals and trend buckets.

Project `id`, `name`, `icon` and `color` are presentation-compatible with Desktop. The name/icon/color fields are never membership keys and are not accounting semantics. A Project deletion therefore cannot delete or rewrite the underlying Source Project or historical evidence.

## Offline behavior and evolution

A companion may retain the latest successful usage and Foundation projections in encrypted local storage. It must preserve Desktop-generated timestamps, show freshness/cache state and treat missing or corrupted projections as unavailable. It must not fill unavailable fields with zero or infer provenance.

`CompanionUsageV1` remains a compatibility contract. Capability discovery and each Foundation domain are separate bounded versioned surfaces so future transports can serve the same Android domain layer without coupling presentation to HTTP. New fields may be added compatibly inside a version; incompatible shape or meaning requires a new version. No database, server, account, cloud relay, billing backend or remote execution is part of this API.
