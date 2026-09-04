# OpenCode Harness Engine Spike 001

This spike makes OpenCode the coding engine behind the Metrora Desktop
surface. It does not fork or patch OpenCode and it does not create a second
Metrora agent runtime.

## Upstream identity

- repository: [`anomalyco/opencode`](https://github.com/anomalyco/opencode)
- release: `1.18.27`
- source commit: `b04697366f05419e9bd7a92f841813dd976161c9`
- license: MIT, preserved in [`LICENSES/OPENCODE-MIT.txt`](../LICENSES/OPENCODE-MIT.txt)
- SDK: `@opencode-ai/sdk@1.18.27`

The Windows distribution stages the official release archive, verifies its
SHA-256 digest, and packages the executable as a resource. The desktop never
downloads an unpinned executable at runtime and never falls back to `PATH`.

## Responsibility boundary

OpenCode owns the coding-engine behavior: sessions and transcripts, provider
and model selection, reasoning variants, primary and subagent modes, the agent
loop, filesystem/search/edit/write/patch/shell tools, git/workspace behavior,
permissions, retries, cancellation, MCP, LSP, formatters and its plan/build
semantics.

Metrora owns only the Electron integration boundary:

- bundles the exact official executable and SDK version;
- launches `opencode serve` on `127.0.0.1` with an ephemeral port;
- gives that child a per-launch Basic-auth credential and does not expose it to
  the renderer or logs;
- owns child lifecycle, health/version checks, crash state and bounded restart;
- passes typed, renderer-safe DTOs over the preload bridge;
- supplies the selected local workspace and observes the official event stream;
- provides exactly one custom read-only tool, `metrora_usage_snapshot`.

The renderer contains no provider client, tool executor, shell runner, parser,
or alternate agent loop. The UI label is **OpenCode** and the About surface
states the upstream relationship explicitly.

## Custom tool boundary

`metrora_usage_snapshot` is installed in Metrora’s private OpenCode config
directory through OpenCode’s documented custom-tool extension point. It reads a
short-lived JSON projection produced by the canonical Metrora CLI status
snapshot. It cannot write files, execute commands, mutate accounting state or
read arbitrary prompts/responses. The renderer receives only bounded,
redacted event and transcript projections.

The private runtime config is isolated under the Electron user-data directory,
with sharing and autoupdate disabled. Its dependency manifest is seeded for the
dependency-free local tool so the official config loader can resolve the
extension deterministically without changing the user’s OpenCode config.

## Providers and local models

Provider, model and variant inventories come from OpenCode’s official APIs.
Metrora can write the official OpenAI-compatible `llama.cpp` provider config for
a user-selected loopback port and model id, then restart the same OpenCode
server. It does not implement a local model client or proxy.

The bundled binary also exposes OpenCode’s `acp` command. This spike verifies
that command is present, while the Desktop path uses the official SDK against
`opencode serve`; Metrora does not duplicate or reinterpret ACP.

## Validation

The automated boundary coverage includes:

- exact upstream version/commit and staged executable resolution;
- exact OpenCode permission (`permission.asked`/`permission.replied`), question
  (`question.asked`/`question.replied`/`question.rejected`) and message delta
  (`message.part.delta` plus complete `message.part.updated`) contracts;
- official provider authentication through `provider.auth`, OAuth
  authorize/callback and `auth.set`, including OpenCode Zen discovery;
- session-owned model, agent and exact variant forwarding with no local model
  catalog or guessed context/output limits;
- token, bearer, secret, path and source-content redaction;
- nested OpenCode event projection without raw tool input/output leakage;
- canonical usage snapshot projection and custom-tool registration;
- exact IPC handler names and prompt forwarding;
- TypeScript typecheck, renderer/electron builds and application tests;
- live loopback startup against the staged official Windows binary, health and
  version checks, workspace discovery, custom-tool discovery, MCP inventory,
  ACP command availability and clean child shutdown;
- Windows package assembly with the OpenCode resource present.

Physical Founder acceptance, provider-authenticated prompt execution and a
real local `llama.cpp` completion remain manual acceptance steps. This spike
does not claim those steps were completed by automated tests.

## Current architecture note

The current Desktop coding surface is OpenCode. The removed Core Compatibility
executor and its approval/lifecycle authority are not part of the current
product. Independent local optimization operations remain under
`src/optimization-operations/` for analysis, reversible configuration changes,
backup, journal and undo; they are separate from OpenCode and are never used as
OpenCode authority. The former Desktop conversational runtime and orchestration
paths are not retained as compatibility surfaces.
