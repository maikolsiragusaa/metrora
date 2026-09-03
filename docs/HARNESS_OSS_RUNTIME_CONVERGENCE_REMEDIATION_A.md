# Harness OSS runtime convergence 001 — remediation A

This remediation keeps the accepted P1 shape:

`Metrora contracts and authority -> narrow adapters -> DSH commodity runtime`

It does not add a second AgentLoop, replace the DSH runtime, or widen the
accepted state-changing architecture.

## Runtime and durable identity

The Electron host keeps one DSH `Agent` and one durable `Session` per local
conversation. A runtime/model change updates the per-request waterfall used by
DSH before `GenerateOptions` is produced. The selected provider route and model
therefore change on the next request without replacing the Session or losing
its event log. Resume reconstructs the same Session from JSONL and uses the
latest durable request header.

Terminal provider failures remain durable turn boundaries. A manual Retry
identifies the failed request, verifies the exact failed question, and submits a
DSH plugin notice that asks the model to reuse the existing user request. The
renderer projection therefore retains one user message; it does not append the
same user question a second time.

## Canonical Metrora Tool authority

`app/electron/harness-tool-bridge.mts` is an adapter only. The Electron host
loads the compiled `src/tools/runtime.ts` entry, which exports the canonical
`METRORA_TOOL_DEFINITIONS` and `createMetroraToolRegistry` from
`src/tools/contract.ts` and `src/tools/registry.ts`.

DSH schemas are projected from the canonical definitions. Every execution
resolves an explicit Agent/Session scope and delegates validation, narrowing,
source reads, evidence, freshness, coverage, privacy projection, and result
envelope construction to the canonical registry. The adapter has no parallel
period ordering, provider/model filtering, evidence builder, or privacy
implementation. Quota remains provider-reported; any Metrora usage context is
separate evidence and is never relabeled as quota authority.

## Scope and filesystem boundary

Scope is keyed by the exact DSH Agent/Session identity. There is no process-wide
or first-conversation default scope. A child Agent receives the parent's
bounded scope at creation; an unbound Agent fails closed before the canonical
source is called.

The accepted Metrora main does not currently expose an explicit local
Workspace/codebase root suitable for Harness filesystem execution. The
Desktop working directory and a usage Project ID are not such an authority.
This slice therefore mounts no `read`, `glob`, or `grep` codebase capability and
does not use `process.cwd()` as a product workspace fallback. Filesystem
capability is pending the explicit Workspace-root contract.

## Shield, ACT, and native closure

P1 mounts DSH orchestration, durable Session persistence, compaction, retry,
and bounded in-process subagent delegation. It mounts no state-changing DSH
Tool, subprocess executor, PowerShell executor, filesystem Tool, editor Tool,
or process Tool. Metrora Shield denies unknown and mutation/process names;
there is no DSH path that bypasses that decision. The existing Core
Compatibility action remains a separate bounded proposal/confirmation bridge
owned by the trusted Electron host and ACT; it is not a DSH mutation Tool.

The direct DSH dependency set in `app/package.json` is:

- `@deepseek-ai/cordis` — Cordis context used to compose the runtime.
- `@deepseek-ai/dsh-agent`, `dsh-agent-loop`, and `dsh-llm` — Agent, loop, and
  adapter contracts directly used by the host.
- `dsh-session`, `dsh-session-persistence-jsonl`, and
  `dsh-session-projection` — durable history, JSONL persistence, and derived
  projections.
- `dsh-llm-retry`, `dsh-token-meter`, `dsh-compaction`,
  `dsh-compaction-basic`, and `dsh-compaction-tool-result-pruner` — the active
  retry, token, and context-pressure mechanics.
- `dsh-system-prompt`, `dsh-tools`, and `dsh-user-approval` — active DSH
  composition services and ToolRuntime boundary.
- `dsh-subagent`, `dsh-subagent-spawn-in-process`, and `dsh-tool-subagent` —
  the bounded child-Agent substrate and native delegation Tool.
- `dsh-commands` — required peer composition for the active compaction
  packages; it is not exposed as a Metrora product command surface.

The removed direct packages are the local filesystem, subprocess, PowerShell,
shell-environment, filesystem-search, editor, and PowerShell Tool packages.
`node-pty` is no longer in the app lockfile. JSONL persistence still brings
transitive `koffi` because its Windows durable-publish path uses native fsync
semantics; that dependency is retained only with the active persistence
backend, not to enable mutation or subprocess execution.

## Compatibility debt

The hosted Advisor runtime remains available only for the explicit hosted
choice. The existing renderer Advisor kernel remains the bounded compatibility
fallback when a local model is not selected or an older packaged surface lacks
the DSH handler. The existing Swarm path remains behind its experimental gate.
No new feature is added to either path. A later convergence wave owns removal
of these compatibility routes after the DSH local path and any future
Workspace/ACT contracts are accepted.
