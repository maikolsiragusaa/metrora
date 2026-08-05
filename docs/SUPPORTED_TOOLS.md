# Supported tools

Metrora currently registers **38 local collectors**. A registered collector can discover and analyze supported local records, but that does not automatically mean every field is measured directly or approved for signed Workspace measurements.

## How to read this page

- **Local analysis** means the collector is part of the operational provider registry.
- **Evidence reviewed** means the current source family has an explicit evidence description and focused review status.
- **Signed Workspace** means a concrete source path has passed the stricter provenance, privacy and fixture requirements for signed measurements.
- **Withheld** does not disable local analysis. It prevents a local collector from being presented as approved signed evidence before the narrower review is complete.

This is an evidence boundary, not a product-priority ranking.

## Current support matrix

| Provider identifier | Local analysis | Evidence status | Signed Workspace |
| --- | --- | --- | --- |
| `antigravity` | Available | Protobuf/RPC cache and status-line sources documented; path-specific signed review incomplete | Withheld |
| `claude` | Available | JSONL and desktop session evidence reviewed | Approved |
| `cline` | Available | Local collector registered; signed-evidence audit incomplete | Withheld |
| `codebuff` | Available | Local collector registered; public provider guide pending | Withheld |
| `codewhale` | Available | Local collector registered; signed-evidence audit incomplete | Withheld |
| `codex` | Available | Rollout JSONL measured and fallback evidence reviewed | Approved |
| `copilot` | Available | OTEL, SQLite and legacy multi-store sources documented; path-specific signed review incomplete | Withheld |
| `crush` | Available | Local collector registered; signed-evidence audit incomplete | Withheld |
| `cursor` | Available | Mixed SQLite measured and estimated evidence documented | Withheld |
| `cursor-agent` | Available | Local collector registered; signed-evidence audit incomplete | Withheld |
| `devin` | Available | Local collector registered; signed-evidence audit incomplete | Withheld |
| `droid` | Available | Local collector registered; signed-evidence audit incomplete | Withheld |
| `forge` | Available | Local collector registered; signed-evidence audit incomplete | Withheld |
| `gemini` | Available | Session JSON/JSONL message usage reviewed | Approved |
| `goose` | Available | Local collector registered; signed-evidence audit incomplete | Withheld |
| `grok` | Available | Local collector registered; signed-evidence audit incomplete | Withheld |
| `hermes` | Available | Local collector registered; signed-evidence audit incomplete | Withheld |
| `ibm-bob` | Available | Local collector registered; signed-evidence audit incomplete | Withheld |
| `kilo-code` | Available | Local collector registered; signed-evidence audit incomplete | Withheld |
| `kimi` | Available | Local collector registered; signed-evidence audit incomplete | Withheld |
| `kimicode` | Available | Local collector registered; public provider guide pending | Withheld |
| `kiro` | Available | Legacy chat JSON with estimated fields documented | Withheld |
| `lingtai-tui` | Available | Local collector registered; signed-evidence audit incomplete | Withheld |
| `mistral-vibe` | Available | Session metadata and JSONL evidence documented | Withheld |
| `mux` | Available | Local collector registered; signed-evidence audit incomplete | Withheld |
| `omp` | Available | Local collector registered; signed-evidence audit incomplete | Withheld |
| `open-design` | Available | Local collector registered; public provider guide pending | Withheld |
| `openclaw` | Available | Agent JSONL evidence documented | Withheld |
| `opencode` | Available | SQLite and file-storage evidence documented | Withheld |
| `pi` | Available | Local collector registered; signed-evidence audit incomplete | Withheld |
| `quickdesk` | Available | Local collector registered; public provider guide pending | Withheld |
| `qwen` | Available | Local collector registered; signed-evidence audit incomplete | Withheld |
| `roo-code` | Available | Local collector registered; signed-evidence audit incomplete | Withheld |
| `vercel-gateway` | Available | Local collector registered; signed-evidence audit incomplete | Withheld |
| `warp` | Available | SQLite evidence with weighted estimation documented | Withheld |
| `zcode` | Available | Local collector registered; signed-evidence audit incomplete | Withheld |
| `zed` | Available | SQLite, zstd and JSON token evidence reviewed | Approved |
| `zerostack` | Available | Local collector registered; signed-evidence audit incomplete | Withheld |

## Evidence classes

A provider document may describe one or more of these behaviors:

- exact token or cost fields supplied by the source;
- cumulative counters converted into deterministic deltas;
- cache-token normalization where providers use different accounting conventions;
- estimates from bounded message content when token counters are unavailable;
- mixed stores that require reconciliation or deduplication;
- local database, RPC or compressed-record access that requires platform-specific validation.

Metrora must preserve those differences in downstream reporting. A source that exposes only an estimate cannot be described as if it supplied an exact metered value.

## Provider documentation

Detailed source paths, formats, caches, deduplication behavior and known limitations live under [`docs/providers`](providers/).

Current public provider guides are missing for:

- `codebuff`;
- `kimicode`;
- `open-design`;
- `quickdesk`.

Those gaps are documentation gaps, not a claim that the registered local collectors are disabled.

## Technical inventory

[`COLLECTOR_INVENTORY_V1.md`](COLLECTOR_INVENTORY_V1.md) is generated from the executable collector inventory and is checked against the provider registry in tests.

Signed Workspace approval requires concrete fixture parity, field-level provenance, pricing reconciliation, privacy review and manual validation when the source depends on a live IDE, RPC process or mutable database.
