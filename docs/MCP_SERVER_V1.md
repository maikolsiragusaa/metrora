# Metrora MCP Server V1

**Status:** implemented local interoperability surface

Metrora MCP Server V1 is a local, read-only Model Context Protocol server. It
publishes the same factual Tools registry used by the rest of Metrora and does
not maintain a second usage database or evidence calculator.

## Run

~~~text
metrora mcp serve
~~~

The server uses the MCP TypeScript SDK already present in the public package
(@modelcontextprotocol/sdk 1.29.x, MIT) and communicates over stdio.
JSON-RPC owns stdout; diagnostics go to stderr. No client configuration file
is edited automatically.

Optional startup scope:

~~~text
metrora mcp serve --period week --provider claude --project-id <project-id>
metrora mcp info --json
~~~

The default period is 'all', bounded to the same six-calendar-month window as
the canonical CLI. Valid periods are 'today', 'week', '30days', 'month', 'all'
and 'lifetime'; valid provider filters are 'all', 'claude' and 'codex'.

## Canonical tool surface

Discovery is generated from src/tools and preserves this order:

1. get_spend_snapshot
2. get_model_efficiency
3. get_quota_snapshot
4. get_overview_snapshot
5. get_project_drivers
6. get_session_highlights
7. get_coverage_report
8. get_bench_evidence

Every tool is annotated read-only, idempotent and closed-world. Arguments are
limited to the filters declared by the canonical contract. A tool call may
narrow its startup period or add a model/provider filter where the contract
allows it; it cannot widen the immutable scope.

## Authority and output

The path is:

~~~text
MCP adapter
→ canonical Metrora Tools registry
→ canonical evidence source
~~~

Results use the metrora-factual-tool-v1 contract, JSON-safe content-minimal output,
explicit coverage/freshness/unavailable semantics and a 32 KiB output bound.
Arguments are bounded to 8 KiB. Canonical provider-reported Capacity exists in
the Desktop authority, but Local MCP V1's CLI/core runtime does not yet bind
that authority through a reusable non-Electron source. `get_quota_snapshot`
therefore truthfully returns unavailable in Local MCP V1. Metrora spend is
never converted into an invented quota or burn-rate estimate.

The server excludes raw conversations, prompts, responses, source content,
credentials, unrestricted session payloads and local filesystem paths. Tool
calls do not start Bench runs, mutate usage history or invoke actions.

## Non-goals

This V1 is not a shell, filesystem, repository, credential, provider-proxy,
model-runner or hosted Metrora service. It does not expose ACT, Swarm,
approval, execution or agent-management operations. External clients receive
factual evidence only.

OpenHands and ACP remain characterized as replaceable external-agent/runtime
boundaries. No production adapter for either is included in this wave.

## Verification

The public test suite includes real child-process stdio negotiation, exact
tool discovery, annotation/schema checks, bounded output, fail-closed invalid
arguments, privacy markers and a source-boundary check that keeps the
transport adapter dependent on the canonical Tools registry.
