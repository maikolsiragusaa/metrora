# Metrora Harness public foundation

Metrora Harness is the public, local-first coding and agent surface of the
Desktop application. It is a normal coding Harness with Metrora-owned scope,
factual Tools, provenance, Workspace authority and Shield/ACT policy layered on
top.

## Runtime authority

Every ordinary prompt follows one path:

```text
Metrora Harness UX / mode / Workspace / policy
        -> pinned OSS Agent runtime
        -> pinned OSS durable Session and Tool lifecycle
        -> Metrora LLM adapter
        -> selected local or hosted provider/model
```

The embedded commodity substrate is a pinned MIT-licensed OSS Harness release
recorded in the repository's third-party notices. Local and hosted models use
the same Agent, Session, transcript, reasoning projection,
Tool events, cancellation and retry path. If the selected route is unavailable
or unsupported, Harness reports the failure; it does not answer through a
second engine or an offline chatbot.

## Sessions and Workspace

DSH Session/event history is the canonical source for user and assistant
messages, reasoning, Tool calls/results, approvals, retries, cancellation and
Agent/Subagent activity. Metrora stores only bounded Session metadata beside
the DSH JSONL history: title, selected route, mode, reasoning effort,
Workspace projection, timestamps and conformance state.

A Workspace is an explicitly selected local folder. Electron canonicalizes the
root and rejects traversal, outside-root paths and symlink escapes where the
platform permits inspection. Filesystem and process Tools are mounted against
that accepted root; `process.cwd()` is not product Workspace authority.

## Modes

Ask, Plan, Edit and Build are policy/UX profiles over the same Agent engine:

| Mode | Default authority |
| --- | --- |
| Ask | conversation, factual Tools and read-only Workspace inspection |
| Plan | reasoning, inspection, search and a bounded plan; mutations require explicit policy approval |
| Edit | focused file changes through Shield/ACT approval |
| Build | inspect, edit, test and iterate through the same bounded approval path |

Modes do not create separate planners or transcripts.

## Commodity Tools

Where the pinned substrate provides the mechanic, Harness mounts DSH filesystem,
search, PowerShell/shell, terminal, web fetch and in-process Subagent Tools.
Tool cards project stable call IDs, ownership, status, bounded inputs/results,
timing and safe specialized details. Git inspection and local Git mutations
use the shell/process substrate with Git-aware classification; remote and
destructive history operations remain explicit approval actions.

`web_fetch` is available through the bounded HTTP adapter. `web_search` is not
advertised without a configured real search provider. The pinned DSH MCP client
is mounted in-process for bounded configured stdio and Streamable HTTP servers;
their Tools enter the same registry, Agent turn and Session lifecycle. MCP
Tools remain external/unknown capability and therefore require explicit Shield
approval. First-party Metrora factual Tools are direct registry entries and do
not use MCP as an internal round trip.

## Metrora authority

Metrora factual Tools remain in the canonical root registry. They own schema,
scope validation, privacy, evidence references, freshness and authority
semantics. Current usage, cost, quota, Models, Capacity, Projects and Bench
facts come from those Tools, never from model memory or estimates when the fact
is unavailable. The canonical factual contract is
`metrora-factual-tool-v1`.

State-changing intent follows:

```text
Agent proposal -> Shield classification -> exact approval/preauthorization
               -> ACT/bounded executor -> Tool result -> DSH Session evidence
```

DSH supplies dispatch mechanics, not authorization authority. Approvals render
inline in the active turn and resume that same Agent turn. Credentials remain
in Electron main-process OS-vault custody and never enter renderer persistence,
profile data or Session history.

## Model and reasoning conformance

Discovery is not verification. A route/model fingerprint includes runtime,
provider, model, protocol, adapter contract and known capabilities. Tool-capable
`Verified` requires a real nonce Tool call from the exact model, validated
arguments, execution, the actual Tool result sent back to that same model and a
natural final synthesis. Chat-only and failed routes remain distinct states.

Reasoning effort is resolved per exact route/model from provider metadata and
passed to DSH `GenerateOptions`. Provider-visible reasoning is translated to
DSH reasoning blocks/deltas and shown as a restrained, collapsible process
projection; hidden internal reasoning is never fabricated or exposed.

## Public boundary

This Community Harness includes commodity coding capability, provider adapters,
Workspace and local persistence, factual Tools, Shield/ACT, Git, web fetch and
manual bounded Agent/Subagent delegation. Private routing intelligence,
automatic topology selection, proprietary decomposition, managed background
services, billing/entitlement logic and team intelligence are outside this
public surface.

See [Architecture](architecture.md), [Workspace v1](WORKSPACE_V1.md), [ACT
contract preparation](ACT_CONTRACT_PREP_001.md), [Provider quota authority](provider-quota-authority.md),
and [Third-party notices](../THIRD_PARTY_NOTICES.md) for adjacent boundaries.
