# Grok Build

Grok Build, xAI's coding CLI. Sessions use the `grok-build` model by default.

- **Source:** `src/providers/grok.ts`
- **Loading:** eager (`src/providers/index.ts`)
- **Test:** `tests/providers/grok.test.ts`

## Where it reads from

`$GROK_HOME/sessions/` (or `~/.grok/sessions/`), one directory per session:
`sessions/<url-encoded-cwd>/<uuid>/`. The parser reads `summary.json`, `signals.json`, and `updates.jsonl` from each session directory.

## Storage format

JSON + JSONL. `summary.json` holds the session id, cwd, timestamps, and `current_model_id`. `signals.json` holds `modelsUsed`, `toolsUsed`, and `contextTokensUsed`. `updates.jsonl` is the ACP log: streamed chunks carry `params._meta.totalTokens` (running context size) and `params._meta.promptId` (one per turn); newer builds also append `turn_completed` updates with `prompt_id` and provider-recorded `usage`.

## Token model

**Completed-turn usage.** Newer Grok Build sessions use valid top-level `turn_completed.usage` totals as the accounting authority and sum them after prompt-level last-write-wins deduplication. Grok's `inputTokens` includes cache reads and cache creation, so Metrora stores those fields as subsets and keeps `inputTokens` as the non-cached remainder. `cacheTokenEvidence` records whether both cache fields were present and consistent (`complete`), only one was usable (`partial`), neither was present (`unavailable`), or the decomposition was unsafe (`inconsistent`).

Grok's reported `reasoningTokens` is a factual subset of its reported `outputTokens`. Metrora therefore preserves the provider-reported output unchanged, bounds reasoning to that output, and marks the call `reasoningSemantics: aggregate-output`; reasoning is not added again to generated or billable output. `modelUsage` is used only to choose one session attribution model; top-level totals are never split by model.

**Estimated fallback.** Older sessions without usable positive top-level completed-turn usage retain the compaction-aware running `totalTokens` curve and remain `costIsEstimated`. A mixed session uses only its usable completed-turn subtotal: streamed turns without a corresponding usable completed record are not synthesized, and their absence keeps the session estimated/partial. The heuristic is never blended into authoritative totals.

## Pricing

`grok-build` is aliased to `grok-build-0.1` in `src/models.ts`, so it prices off the bundled LiteLLM fallback. Complete provider usage is not flagged as estimated, but the price-book amount can differ from xAI's published API rate; verify monetary totals against your xAI usage console when needed.

## Caching

Session files are re-parsed once when the Grok parser authority changes. The daily cache authority includes that parser marker: retained Grok source is re-derived, while sourceless carried history remains protected by NEVER-LOSE.

## Deduplication

Per `grok:<session-dir>:<updated_at>:<id>`.

## Quirks

- **`costUsdTicks` is not used.** Its monetary scale is undocumented, so Metrora does not guess a unit.
- **Partial cache evidence stays partial.** Missing cache fields are not factual zeroes, and impossible cache data never creates negative uncached input.
- **Mixed-session undercount is explicit.** Turns without usable completed usage are omitted from the authoritative subtotal and the call is estimated rather than blended with the old curve.
- **Tool capture.** Tool names and `run_terminal_command` bash commands are extracted from `tool_call` updates; subagent types are retained from `spawn_subagent` inputs.
- **Whole-session timestamp.** Spend is attributed to `updated_at`, since the context curve is cumulative.
- **Subscription vs API.** Grok Build runs via either a metered xAI API account (tiered) or a SuperGrok subscription; the session files do not record which.

## When fixing a bug here

1. Discovery: check the `sessions/<cwd>/<uuid>/` walk and the `GROK_HOME` resolution.
2. Token accounting: see `parseUpdates` (deduplicates completed turns and retains the legacy `totalTokens` fallback).
3. Add a fixture-format session under `tests/providers/grok.test.ts`; do not mock the filesystem.
