# Cline CLI

Cline command-line sessions. This integration is intentionally separate from [Cline](cline.md), which reads the VS Code extension task tree.

- **Source:** `src/providers/cline-cli.ts`
- **Loading:** eager (`src/providers/index.ts`)
- **Test:** `tests/providers/cline-cli.test.ts`

## Where it reads from

The sessions root follows the CLI's override chain:

| Level | Environment variable | Default |
|---|---|---|
| sessions | `CLINE_SESSION_DATA_DIR` | `<data>/sessions` |
| data | `CLINE_DATA_DIR` | `<root>/data` |
| root | `CLINE_DIR` | `~/.cline` |

A directory is considered a CLI session only when it contains `<session-id>/<session-id>.json`. `probeRoots()` exposes the resolved sessions directory to `metrora doctor`.

## Storage format

```text
sessions/<session-id>/
  <session-id>.json
  <session-id>.messages.json
```

The session file carries metadata such as the session id, model, workspace/cwd, timestamps and a parent-session `metadata.usage` rollup. The messages file carries user/assistant messages; assistant messages can expose a `metrics` block with input, output, cache-read, cache-write and cost values.

Each assistant metrics block becomes one Metrora call. The deduplication key is `cline-cli:<session-id>:<message-id>`.

## Cost evidence

When Cline CLI reports a finite non-negative per-message cost, Metrora preserves it as explicit client-metered evidence (`CostAssignmentV1`) rather than recalculating it from the model catalog. A reported `$0` remains a real metered zero.

If the CLI does not report a cost, the collector falls back to Metrora model pricing and marks the value as estimated.

For older or interrupted sessions with no per-message metrics, Metrora may emit one call from the parent `metadata.usage` rollup. It deliberately does **not** use aggregate/subagent rollups because spawned agents can have their own session directories and would otherwise be counted twice.

## Tools

CLI tool names are normalized to Metrora's shared vocabulary where the mapping is unambiguous, including:

- `run_commands` → `Bash`
- `read_files` → `Read`
- `editor` / `apply_patch` → `Edit`
- `search_codebase` → `Grep`
- `fetch_web_content` → `WebFetch`
- `skills` → `Skill`
- `spawn_agent` and team task/spawn variants → `Agent`

The original source content is not persisted merely to support these summaries.

## Boundaries and deduplication

The VS Code Cline provider scans `tasks/<id>/ui_messages.json`; Cline CLI scans `sessions/<id>/<id>.json`. Keeping the collectors separate prevents a CLI-format change from altering the shared Cline-family parser.

If duplicate CLI session directories reuse the same internal session and message ids, the shared dedup set suppresses the duplicate message calls. The rollup fallback is also disabled whenever per-message metrics were present, even if every message call was deduplicated, preventing a duplicate copy from reappearing through the rollup.

## When fixing a bug here

1. Reproduce with a minimal `<id>.json` plus `<id>.messages.json` fixture.
2. Preserve the distinction between reported/metered and estimated cost.
3. Check duplicate session ids before changing rollup behavior.
4. Run `tests/providers/cline-cli.test.ts` plus provider registry/parser regressions.
