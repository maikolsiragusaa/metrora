# OpenCode upstream surface

This public engineering note records the bounded `OPENCODE_UPSTREAM_SURFACE_001`
spike. Metrora hosts the official OpenCode `v1.18.27` release binary from
`anomalyco/opencode`, source commit
`b04697366f05419e9bd7a92f841813dd976161c9`, with its embedded Web UI served by
`opencode serve` inside an Electron `WebContentsView`.

The sidecar is application-owned and listens only on `127.0.0.1` with
per-launch Basic Auth credentials held by Electron's main process. The Code
renderer contains only a layout host; Sessions, agents, providers, models,
reasoning, permissions, questions, Git, MCP, and the remaining coding-agent
mechanics stay owned by the upstream Web UI and server.

Metrora contributes exactly one OpenCode custom tool,
`metrora_usage_snapshot`. It reads a bounded, sanitized, read-only projection of
today's Metrora usage. Prompt/response content, source code, credentials, and
arbitrary CLI payload fields are not included in that projection.

The binary is staged from the official GitHub release asset, verified against a
pinned archive SHA-256, and packaged with a generated binary identity record.
The upstream MIT notice is preserved in
[`LICENSES/OPENCODE-MIT.txt`](../LICENSES/OPENCODE-MIT.txt).

This note documents adoption evidence for the spike only; Founder physical
acceptance remains pending.
