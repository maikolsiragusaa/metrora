# Metrora MCP architecture

**Status:** implemented Local MCP Server V1

## Purpose

Metrora exposes bounded local factual evidence to MCP-compatible clients
through a stdio server. The adapter is intentionally thin: discovery and
execution are bound to the canonical src/tools registry, so MCP does not
create a second analytics authority.

## Runtime model

- metrora mcp serve starts the local long-lived server over stdio.
- JSON-RPC owns stdout; diagnostics use stderr.
- Startup scope is immutable and defaults to the bounded six-calendar-month
  'all' period.
- Calls may narrow the scope only where the canonical contract permits it.
- Active and queued calls are bounded.
- No hosted Metrora service or automatic client configuration is required.

## Canonical surface

The server discovers and registers the eight definitions from
METRORA_TOOL_DEFINITIONS:

get_spend_snapshot, get_model_efficiency, get_quota_snapshot,
get_overview_snapshot, get_project_drivers, get_session_highlights,
get_coverage_report, and get_bench_evidence.

Each result is produced by the canonical registry and preserves the
metrora-factual-tool-v1 envelope, coverage, freshness, unavailable and content-
minimal privacy semantics. The adapter does not render tables or recalculate
spend/savings.

## Privacy and authority

MCP is a local read authority only. It excludes raw conversation content,
prompts, responses, source content, credentials, unrestricted session payloads
and filesystem paths. It does not expose action, shell, repository, provider
proxy or model-runner operations. MCP calls do not mutate usage/session/Bench
history.

Provider-reported Capacity exists in the public Desktop authority. Local MCP
V1's CLI/core runtime does not yet bind that authority through a reusable
non-Electron source, so its empty quota source truthfully produces unavailable
quota evidence rather than inferring capacity from Metrora spend.

## Compatibility

metrora mcp info --json reports the command, transport, contract version,
tool names and bounded limits. The public package uses the MIT-licensed MCP
TypeScript SDK dependency already declared in package.json.

OpenHands and ACP are characterization targets for future replaceable
external-agent boundaries. This wave does not add production adapters or make
either system a Metrora authority.

## Maintenance rules

- Keep transport, schemas and evidence in separate layers.
- Generate MCP discovery from the canonical Tools registry.
- Keep stdout protocol-clean under success and failure paths.
- Fail closed for unknown/additional arguments without echoing input.
- Preserve unavailable/stale/fresh/coverage semantics.
- Keep local MCP read-only and prevent MCP failures from corrupting canonical
  history.
