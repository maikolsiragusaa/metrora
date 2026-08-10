# Metrora MCP architecture

**Status:** implemented compatibility surface

## Purpose

Metrora exposes selected local usage and optimization evidence to MCP-compatible agents through a stdio server. The MCP surface reuses canonical aggregation and does not create a second analytics authority.

## Runtime model

- The MCP server runs as a long-lived local CLI process over stdio.
- JSON-RPC owns stdout; diagnostics use stderr.
- Aggregation, pricing and optimization remain in the canonical public runtime.
- In-flight requests and cache use are bounded.
- No hosted Metrora service is required.

## Tool boundary

Current tools expose structured usage and savings evidence with display-ready summaries. Tool output must preserve:

- period, provider and project scope;
- observed versus derived or estimated evidence;
- coverage and unavailable states;
- pricing provenance;
- privacy-safe project/session handling.

Absolute local paths, prompts, responses, source code and secrets are excluded.

## Privacy

Project and session labels are pseudonymized by default where the tool contract requires it. Real local names are exposed only through an explicit caller option and remain on the user's machine.

The MCP server must not become a general filesystem, shell or model-proxy tool.

## Compatibility

The canonical command is `metrora mcp`. The current package publishes no
alternate CLI alias; historical signed-data identifiers are internal protocol
details, not current product names.

## Maintenance rules

- Keep transport, schemas, redaction and table formatting in separate modules.
- Reuse canonical usage/optimization functions rather than copying logic.
- Keep stdout protocol-clean under every success and failure path.
- Add fixture-backed tests for schemas, redaction, empty states and concurrency.
- Do not introduce hosted dependencies or content collection through MCP work.
