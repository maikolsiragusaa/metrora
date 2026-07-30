# Kimi

Kimi Code CLI session parser.

- **Source:** `src/providers/kimi.ts`
- **Loading:** eager (`src/providers/index.ts`)
- **Test:** `tests/providers/kimi.test.ts`

## Where it reads from

`$KIMI_SHARE_DIR/sessions/` if set, otherwise `~/.kimi/sessions/`.

Kimi stores sessions by work-directory hash:

```text
~/.kimi/
  kimi.json
  config.toml
  sessions/
    <workdir-md5>/
      <session-id>/
        context.jsonl
        wire.jsonl
        state.json
        subagents/
          <agent-id>/
            context.jsonl
            wire.jsonl
```

`kimi.json` maps each work-directory hash back to the original working path. CodeBurn uses that to display the project basename; if the metadata file is missing, the hash directory name is used.

## Storage Format

CodeBurn reads `wire.jsonl`. Each data line is a persisted wire record:

```json
{"timestamp":1776162403,"message":{"type":"StatusUpdate","payload":{"message_id":"msg-1","token_usage":{"input_other":100,"input_cache_read":25,"input_cache_creation":10,"output":40}}}}
```

`TurnBegin` / `SteerInput` provide the user prompt, `ToolCall` / `ToolCallRequest` provide tool names and shell commands, and `StatusUpdate.token_usage` provides the billable token counts.

## Caching

None.

## Deduplication

Per `kimi:<session-id>:<message_id>`, falling back to the status-update line index if the message id is absent.

## Quirks

- Kimi's official `TokenUsage` separates `input_other`, `input_cache_read`, `input_cache_creation`, and `output`. CodeBurn maps those directly into input, cache read, cache write, and output.
- The current Kimi wire schema does not persist the model on every usage update. CodeBurn uses `KIMI_MODEL_NAME` when set, then the active `~/.kimi/config.toml` default model, then `kimi-auto`.
- `kimi-auto`, `kimi-code`, and `kimi-for-coding` are priced as `kimi-k2-thinking` so managed Kimi Code sessions do not show as `$0` when the exact backend model is hidden.
- Subagent sessions are discovered from `subagents/<agent-id>/wire.jsonl` and parsed as separate Kimi sessions under the same project.

## When Fixing A Bug Here

1. Reproduce with a tiny `wire.jsonl` fixture in `tests/providers/kimi.test.ts`.
2. If token totals look wrong, inspect `StatusUpdate.token_usage` first; `context.jsonl` only stores context checkpoints and cumulative counts, not per-step billing detail.
3. If tools are missing, check whether Kimi emitted `ToolCall`, `ToolCallRequest`, or nested `SubagentEvent`; CodeBurn intentionally counts subagent wire files separately to avoid double-counting parent mirrors.
