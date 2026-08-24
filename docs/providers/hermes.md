# Hermes Agent

Hermes Agent CLI profiles.

- **Source:** `src/providers/hermes.ts`
- **Loading:** eager (`src/providers/index.ts`)
- **Test:** `tests/providers/hermes.test.ts`

## Where it reads from

| Source | Path |
|---|---|
| Default Hermes profile | `$HERMES_HOME/state.db` if set, otherwise `~/.hermes/state.db` |
| Named Hermes profiles | `$HERMES_HOME/profiles/<profile>/state.db` |

## Storage format

SQLite. The provider reads Hermes' aggregate `sessions` token/cost counters and the matching `messages` rows for user prompt and tool-call context.

## Parser

Hermes stores durable token accounting at the session level, so Metrora emits one parsed call per Hermes session instead of one call per LLM API request. The call contains the aggregate session totals:

- input tokens
- output tokens
- cache-read tokens
- cache-write tokens
- reasoning tokens
- actual or estimated cost when Hermes recorded one

If Hermes recorded no positive cost, Metrora falls back to its normal model pricing table.

## Project grouping

Discovery groups sessions by Hermes profile (`default`, `coder`, `analytics`, etc.). When a session message includes a clean `Current working directory: /path` line, parsing can attach that project path so Metrora can canonicalize worktrees. The parser deliberately ignores quoted or escaped prompt text that merely contains the phrase `Current working directory:`.

## Tool mapping

Hermes `tool_calls` are normalized to Metrora display names where possible:

- `terminal` -> `Bash`
- `read_file` -> `Read`
- `write_file` -> `Write`
- `patch` -> `Edit`
- `search_files` -> `Grep`
- browser tools -> `Browser`
- web tools -> `WebSearch` / `WebFetch`
- skill tools -> `Skill`

Terminal command arguments are exposed as `bashCommands` for Metrora's command breakdowns.

## Caching

The shared session cache fingerprints Hermes state DB files. `HERMES_HOME` is included in the provider environment fingerprint so changing the runtime home invalidates stale cached results.

To preserve growth from cumulative sessions across refreshes, Metrora maintains a bounded, Metrora-owned observation sidecar at `<Metrora cache>/hermes/v1/observation-ledger.json`. The JSON state is versioned, atomically published, private, content-digested and replay-safe; it stores bounded counter snapshots and deltas rather than prompts, responses or source code. Counter resets or source replacement start a bounded new epoch and never emit negative usage. If authoritative actual cost arrives after estimated or calculated evidence, the parser emits an explicit correction channel instead of adding actual cost to the earlier estimate.

## Pricing evidence

`actual_cost_usd` is bound as client-metered evidence when present, including
an explicit zero. `estimated_cost_usd` and token-table reconstruction remain
estimated; `billing_provider` is preserved as source provider evidence only.

## Quirks

- The provider is aggregate-first because Hermes' stable accounting lives in `sessions`. Do not infer per-turn usage from message text.
- Source paths are encoded as `<dbPath>#hermes-session=<sessionId>` so SQLite paths containing `:` remain safe.
- SQLite schema checks are intentionally light: if the expected `sessions` or `messages` columns are absent, the DB is skipped.

## When fixing a bug here

1. Reproduce against a real Hermes `state.db` or a minimal SQLite fixture.
2. Run `npm test -- tests/providers/hermes.test.ts --run`.
3. For local smoke testing, use an isolated cache directory, for example:
   `METRORA_CACHE_DIR=/tmp/metrora-hermes-cache node --import tsx -e "import { parseAllSessions } from './src/parser.ts'; console.log(await parseAllSessions(undefined, 'hermes'))"`.
