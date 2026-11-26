# Mistral Vibe

Mistral Vibe CLI and Vibe Desktop.

- **Source:** `src/providers/mistral-vibe.ts`
- **Loading:** eager (`src/providers/index.ts`)
- **Tests:** `tests/providers/mistral-vibe.test.ts` (legacy store), `tests/providers/mistral-vibe-unified.test.ts` (unified store)

## Where it reads from

`$VIBE_HOME/logs/session/` when `VIBE_HOME` is set, otherwise `~/.vibe/logs/session/`.

Two stores live under that root and both are collected:

- **Legacy store**: one directory per session containing `meta.json` and `messages.jsonl`.
- **Unified store**: `logs/session/unified/<session-id>/` containing `meta.json` and a rotated `journal/<sequence>.jsonl`.

Vibe Desktop writes only the unified store. `<session>/owner.json` records `{"entrypoint":"desktop"}` for sessions started from the desktop app; Metrora does not branch on it because the accounting fields are identical for both entrypoints.

## Storage format

### Legacy store

Vibe 2.x stores each session as a directory:

- `meta.json` contains session metadata, cumulative token totals, active model config, model prices, timestamps, working directory, and available tools.
- `messages.jsonl` contains non-system messages and assistant `tool_calls`.

Subagent traces are stored under a parent session's `agents/` folder with the same `meta.json` / `messages.jsonl` shape, so Metrora scans those one level down as separate sessions.

### Unified store

`meta.json` keeps session identity, timestamps, working directory and the active model (`config.active_model` alias plus the concrete `config.model_name` slug). It carries no token totals: usage lives in the journal.

Each journal line is a recovery record with a `sequence`, a `record_sha256` and a `payload`. The records Metrora reads are:

- `payload.type === "completion_succeeded"` inside `type: "action_result"` records. `payload.result.result.usage` is the per-call ledger: `input_tokens`, `output_tokens`, `cached_input_tokens`, `cache_write_tokens`, `reasoning_tokens`, `total_tokens`. `payload.action_id` is the stable native identity.
- `payload.method === "turn/start"` inside `type: "command_reserved"` records, which carry the user entries for the turn.

Tool calls for a call come from `payload.result.result.parts[*]` where `type === "tool_call"`, using `name` and `arguments_json`.

## Caching

The legacy store derives cost from Vibe's own session totals; the unified store has none, so cost is always estimated from LiteLLM pricing for `config.model_name`.

The unified store exposes real cache fields, so `cache_read` and `cache_write` tokens are reported instead of `0`. `input_tokens` is inclusive of `cached_input_tokens` (verified against `total_tokens = input_tokens + output_tokens`), so fresh input subtracts the cached subset before pricing — the same rule `gemini` applies. `cacheTokenEvidence` degrades to `partial` when a record omits either cache subfield.

## Deduplication

- Legacy store: per `mistral-vibe:<session_id>`, or `mistral-vibe:<session_id>:<message_id>` when the session splits across assistant messages.
- Unified store: per `mistral-vibe:<session_id>:unified:<action_id>`, so the same action replayed into an overlapping journal segment is counted once.

## Quirks

- **Usage is cumulative per session in the legacy store.** Vibe does not write per-assistant-message token usage into `messages.jsonl`; token counts come from `meta.json.stats.session_prompt_tokens` and `session_completion_tokens`. Metrora splits assistant-message tools into their user turns for classification and distributes the cumulative token/cost totals across those assistant calls so session totals remain unchanged.
- **Usage is per call in the unified store.** No distribution is needed; each completion is its own record with its own counters.
- **Cost prefers Vibe's own session total in the legacy store.** `meta.json.stats.session_cost` is used first. If it is missing, `meta.json.stats.input_price_per_million` and `output_price_per_million` are used with the active model config as a fallback. LiteLLM pricing is only used when Vibe provides no price data.
- **Reasoning is inside output.** In the unified store `total_tokens` equals `input_tokens + output_tokens`, so `reasoning_tokens` is a subset of the generated output. The call is marked `reasoningSemantics: 'aggregate-output'` so reasoning is reported without being billed twice.
- **Unified records carry no timestamp.** Journal records expose only a `sequence`. Calls are dated by the mtime of the journal segment they live in (bounded by segment rotation), falling back to `meta.json.end_time` then `start_time`. A long session therefore spreads across days instead of collapsing onto one.
- **One model per session.** The unified store records the active model on the session, not per call, so a mid-session model switch is attributed to the session's final model. This matches the legacy behavior.
- **Discovery is per journal segment.** The session cache fingerprints a single file; a directory's mtime does not move when an existing segment is appended to, so segments are the unit of discovery and incremental refresh.
- **Project names come from metadata.** Discovery uses `meta.json.environment.working_directory` and falls back to the session directory name if that field is missing.
- **Tool calls come from messages or parts.** Legacy assistant `tool_calls[*].function.name` and unified `parts[*].name` are normalized to the standard Metrora names (`bash` to `Bash`, `search_replace` to `Edit`, etc.). Bash commands are extracted from `function.arguments.command` and `arguments_json.command` respectively.

## When fixing a bug here

1. Reproduce with a fixture that has both `meta.json` and `messages.jsonl` for the legacy store, or `unified/<id>/meta.json` plus `journal/<sequence>.jsonl` for the unified store.
2. If the bug is "wrong total" on the legacy store, check `meta.json.stats` first. `messages.jsonl` is only for prompts and tool calls. On the unified store, check the `completion_succeeded` records instead.
3. If a future Vibe release adds per-turn usage to the legacy store, add tests before changing the one-record-per-session behavior so historical sessions continue to parse correctly.
4. Keep `input_tokens - cached_input_tokens` as the billable input; billing the inclusive number double-charges cache reads.
