# Metrora collector inventory v1

Status: **local collector coverage inventory; signed sharing remains fail-closed**.

This file is generated from `CollectorInventoryV1`. Local analysis and signed Workspace eligibility are intentionally separate: a registered collector may remain useful in local reports while its fields are withheld from signed measurements until the concrete source path passes the stricter provenance review.

## Public status labels

- **signed-approved:** fixture parity and path-specific provenance profiles authorize the listed source for signed Workspace measurements.
- **source-documented:** the source family and focused behavior are documented, but signed Workspace approval is withheld.
- **local-only:** the operational collector is registered for local analysis while its signed-evidence audit remains incomplete.

These labels describe current evidence boundaries. They are not a public implementation sequence or priority ranking.

| Provider | Loading | Source family | Documentation | Local analysis | Evidence | Signed Workspace |
| --- | --- | --- | --- | --- | --- | --- |
| antigravity | lazy | protobuf-rpc-cache-and-statusline | docs/providers/antigravity.md | available | source-documented | withheld |
| claude | core | jsonl-and-desktop-session-files | docs/providers/claude.md | available | signed-approved | approved |
| cline | core | unassessed | docs/providers/cline.md | available | local-only | withheld |
| cline-cli | core | unassessed | docs/providers/cline-cli.md | available | local-only | withheld |
| codebuff | core | unassessed | docs/providers/codebuff.md | available | local-only | withheld |
| codewhale | core | unassessed | docs/providers/codewhale.md | available | local-only | withheld |
| codex | core | rollout-jsonl | docs/providers/codex.md | available | signed-approved | approved |
| copilot | core | otel-sqlite-and-legacy-multi-store | docs/providers/copilot.md | available | source-documented | withheld |
| crush | lazy | unassessed | docs/providers/crush.md | available | local-only | withheld |
| cursor | lazy | sqlite-mixed-measured-estimated | docs/providers/cursor.md | available | source-documented | withheld |
| cursor-agent | lazy | unassessed | docs/providers/cursor-agent.md | available | local-only | withheld |
| devin | core | unassessed | docs/providers/devin.md | available | local-only | withheld |
| droid | core | unassessed | docs/providers/droid.md | available | local-only | withheld |
| forge | lazy | unassessed | docs/providers/forge.md | available | local-only | withheld |
| gemini | core | session-json-or-jsonl-message-usage | docs/providers/gemini.md | available | signed-approved | approved |
| goose | lazy | unassessed | docs/providers/goose.md | available | local-only | withheld |
| grok | core | unassessed | docs/providers/grok.md | available | local-only | withheld |
| hermes | core | unassessed | docs/providers/hermes.md | available | local-only | withheld |
| ibm-bob | core | unassessed | docs/providers/ibm-bob.md | available | local-only | withheld |
| kilo-code | core | unassessed | docs/providers/kilo-code.md | available | local-only | withheld |
| kimi | core | unassessed | docs/providers/kimi.md | available | local-only | withheld |
| kimicode | core | unassessed | docs/providers/kimicode.md | available | local-only | withheld |
| kiro | core | chat-json-estimated | docs/providers/kiro.md | available | source-documented | withheld |
| lingtai-tui | core | unassessed | docs/providers/lingtai-tui.md | available | local-only | withheld |
| mistral-vibe | core | session-meta-and-jsonl | docs/providers/mistral-vibe.md | available | source-documented | withheld |
| mux | core | unassessed | docs/providers/mux.md | available | local-only | withheld |
| omp | core | unassessed | docs/providers/omp.md | available | local-only | withheld |
| open-design | core | unassessed | docs/providers/open-design.md | available | local-only | withheld |
| openclaw | core | agent-jsonl | docs/providers/openclaw.md | available | source-documented | withheld |
| opencode | lazy | sqlite-or-file-storage | docs/providers/opencode.md | available | source-documented | withheld |
| pi | core | unassessed | docs/providers/pi.md | available | local-only | withheld |
| quickdesk | core | unassessed | docs/providers/quickdesk.md | available | local-only | withheld |
| qwen | core | unassessed | docs/providers/qwen.md | available | local-only | withheld |
| roo-code | core | unassessed | docs/providers/roo-code.md | available | local-only | withheld |
| vercel-gateway | lazy | unassessed | docs/providers/vercel-gateway.md | available | local-only | withheld |
| warp | lazy | sqlite-weighted-estimation | docs/providers/warp.md | available | source-documented | withheld |
| zcode | lazy | unassessed | docs/providers/zcode.md | available | local-only | withheld |
| zed | lazy | sqlite-zstd-json | docs/providers/zed.md | available | signed-approved | approved |
| zerostack | core | unassessed | docs/providers/zerostack.md | available | local-only | withheld |

## Current totals

- Registered local collectors: **39**.
- Approved for signed Workspace measurements: **4 collectors / 6 path-specific profiles**.
- Local collectors with signed sharing withheld: **35**.
- Provider documentation present: **39**.
- Documentation gaps: **none**.

## Approval gate

A collector can become signed-approved only when its concrete source path has fixture parity, field-level token/model/session/reasoning/cost provenance, privacy review, pricing reconciliation rules, and manual validation where the source depends on a live IDE, RPC process or mutable database.

Approval never replaces the inherited parser. It authorizes a narrow, tested projection of that parser output into Metrora signed measurements.
