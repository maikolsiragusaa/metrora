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

Metrora retains the legacy compatibility tool `metrora_usage_snapshot` and adds
seven canonical read-only Code tools:

```text
metrora_get_spend_snapshot
metrora_get_model_efficiency
metrora_get_overview_snapshot
metrora_get_project_drivers
metrora_get_session_highlights
metrora_get_coverage_report
metrora_get_bench_evidence
```

Each new module is only an OpenCode description/schema plus an argv-only bridge
to `metrora tools call`. The plain JSON-schema `filters` wrapper is compatible
with OpenCode `1.18.27`'s legacy custom-tool fallback; the transport unwraps it
without changing the canonical argument names. The command validates and
executes the canonical `src/tools` registry already used by Local MCP, returning bounded
content-minimal JSON. Prompt/response content, source code, credentials, raw
paths and arbitrary CLI payload fields are not included. The canonical
`get_quota_snapshot` remains available to the registry/MCP contract but is not
exposed as a new Code tool in this wave; Metrora never estimates quota from
measured spend.

If the CLI bridge cannot be resolved, OpenCode still starts and the seven tools
return a clean unavailable result. The bridge uses an argv array with
`shell:false`, bounded arguments/output, a timeout and cancellation propagation.
The official OpenCode binary, source, pinned version and staging/provenance
files are not modified by this integration.

The binary is staged from the official GitHub release asset, verified against a
pinned archive SHA-256, and packaged with a generated binary identity record.
The upstream MIT notice is preserved in
[`LICENSES/OPENCODE-MIT.txt`](../LICENSES/OPENCODE-MIT.txt).

This note documents adoption evidence for the spike only; Founder physical
acceptance remains pending.
