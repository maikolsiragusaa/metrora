# Metrora collector inventory v1

Status: **local collector coverage inventory; sharing remains fail-closed**.

This file is generated from `CollectorInventoryV1`. Local support and share eligibility are intentionally separate: an inherited collector may remain useful in the local dashboard while its fields are still withheld from signed workspace measurements.

## Review waves

- **Wave 0 — approved:** parser fixture parity and field-level provenance already exist.
- **Wave 1 — strong next candidates:** sources with strong measured data or high product priority, but still requiring path-specific audit and manual validation.
- **Wave 2 — mixed next candidates:** useful collectors with known estimation, multi-source or reconciliation complexity.
- **Wave 3 — pending:** operational local collectors not yet audited for signed sharing.

| Provider | Loading | Source family | Documentation | Review | Wave | Signed sharing |
| --- | --- | --- | --- | --- | ---: | --- |
| antigravity | lazy | protobuf-rpc-cache-and-statusline | docs/providers/antigravity.md | priority | 1 | withheld |
| claude | core | jsonl-and-desktop-session-files | docs/providers/claude.md | approved | 0 | approved |
| cline | core | unassessed | docs/providers/cline.md | pending | 3 | withheld |
| codebuff | core | unassessed | missing | pending | 3 | withheld |
| codewhale | core | unassessed | docs/providers/codewhale.md | pending | 3 | withheld |
| codex | core | rollout-jsonl | docs/providers/codex.md | approved | 0 | approved |
| copilot | core | otel-sqlite-and-legacy-multi-store | docs/providers/copilot.md | priority | 1 | withheld |
| crush | lazy | unassessed | docs/providers/crush.md | pending | 3 | withheld |
| cursor | lazy | sqlite-mixed-measured-estimated | docs/providers/cursor.md | priority | 2 | withheld |
| cursor-agent | lazy | unassessed | docs/providers/cursor-agent.md | pending | 3 | withheld |
| devin | core | unassessed | docs/providers/devin.md | pending | 3 | withheld |
| droid | core | unassessed | docs/providers/droid.md | pending | 3 | withheld |
| forge | lazy | unassessed | docs/providers/forge.md | pending | 3 | withheld |
| gemini | core | session-json-or-jsonl-message-usage | docs/providers/gemini.md | approved | 0 | approved |
| goose | lazy | unassessed | docs/providers/goose.md | pending | 3 | withheld |
| grok | core | unassessed | docs/providers/grok.md | pending | 3 | withheld |
| hermes | core | unassessed | docs/providers/hermes.md | pending | 3 | withheld |
| ibm-bob | core | unassessed | docs/providers/ibm-bob.md | pending | 3 | withheld |
| kilo-code | core | unassessed | docs/providers/kilo-code.md | pending | 3 | withheld |
| kimi | core | unassessed | docs/providers/kimi.md | pending | 3 | withheld |
| kimicode | core | unassessed | missing | pending | 3 | withheld |
| kiro | core | chat-json-estimated | docs/providers/kiro.md | priority | 2 | withheld |
| lingtai-tui | core | unassessed | docs/providers/lingtai-tui.md | pending | 3 | withheld |
| mistral-vibe | core | session-meta-and-jsonl | docs/providers/mistral-vibe.md | priority | 2 | withheld |
| mux | core | unassessed | docs/providers/mux.md | pending | 3 | withheld |
| omp | core | unassessed | docs/providers/omp.md | pending | 3 | withheld |
| open-design | core | unassessed | missing | pending | 3 | withheld |
| openclaw | core | agent-jsonl | docs/providers/openclaw.md | priority | 2 | withheld |
| opencode | lazy | sqlite-or-file-storage | docs/providers/opencode.md | priority | 1 | withheld |
| pi | core | unassessed | docs/providers/pi.md | pending | 3 | withheld |
| quickdesk | core | unassessed | missing | pending | 3 | withheld |
| qwen | core | unassessed | docs/providers/qwen.md | pending | 3 | withheld |
| roo-code | core | unassessed | docs/providers/roo-code.md | pending | 3 | withheld |
| vercel-gateway | lazy | unassessed | docs/providers/vercel-gateway.md | pending | 3 | withheld |
| warp | lazy | sqlite-weighted-estimation | docs/providers/warp.md | priority | 2 | withheld |
| zcode | lazy | unassessed | docs/providers/zcode.md | pending | 3 | withheld |
| zed | lazy | sqlite-zstd-json | docs/providers/zed.md | approved | 0 | approved |
| zerostack | core | unassessed | docs/providers/zerostack.md | pending | 3 | withheld |

## Current totals

- Registered local collectors: **38**.
- Approved for signed sharing: **4 collectors / 6 path-specific profiles**.
- Priority audit queue: **8**.
- Pending audit: **26**.
- Provider documentation present: **34**.
- Documentation gaps: **codebuff, kimicode, open-design, quickdesk**.

## Approval gate

A collector can move to `approved` only when its concrete source path has fixture parity, field-level token/model/session/reasoning/cost provenance, privacy review, pricing reconciliation rules, and manual validation where the source depends on a live IDE, RPC process or mutable database.

Approval never replaces the inherited parser. It authorizes a narrow, tested projection of that parser output into Metrora signed measurements.
