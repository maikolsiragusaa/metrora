# DeepSeek Harness

DeepSeek Harness (DSH) local session usage, tool activity and fork-seed lineage.

- **Source:** `src/providers/dsh.ts` (reading half: `src/providers/dsh-session-log.ts`)
- **Loading:** eager (`src/providers/index.ts`)
- **Test:** `tests/providers/dsh.test.ts`

## Where it reads from

`DSH_HOME` when set, otherwise `~/.dsh`. Sessions are one directory per session
inside the encoded project directory:

```text
<DSH_HOME>/sessions/
└── --C-DEV-metrora-dev--/            # encoded cwd, lossy: never parsed for the project
    └── session-a05b1930-…/           # or <uuid> for forked/subagent children
        └── session.v4.jsonl.zstd     # or session.jsonl / session.v4.jsonl (compression=none)
```

`probeRoots()` reports `<home>/sessions` so `metrora doctor` can distinguish
"DSH not installed" from "wrong override" even when nothing was discovered.

Discovery reads the header of each candidate for the project label: the
absolute `cwd` recorded in the log is the only honest source for it, because the
project directory name encodes that path lossily. The header lives in the first
logical line, which is written in its own first frame, so discovery decompresses
only that frame (with a bounded 256 KiB head read) instead of the whole log.

### Generation selection

DSH writes a new versioned filename when the log format changes and keeps the
immutable predecessor beside it. Per session directory, Metrora resolves the
numerically highest generation (`session.v03.jsonl` names generation 3, the
unversioned `session.jsonl` names generation 0) and prefers the compressed
spelling on a tie. Ambiguous generation names, a header whose `version` disagrees
with its filename, and generations this parser was not written against are all
skipped with a notice — never silently downgraded to an older snapshot, and never
reported as zero usage. Supported generations today: **0, 1, 2, 3, 4**.

## Storage format

The default backend writes a `session.jsonl`-equivalent stream **compressed as a
concatenation of independent zstd frames**: one checksummed frame for the header
line, then one per durable append batch. Node's `zstdDecompressSync` decodes a
single frame — the first frame is the session header, so calling it once would
discover every session and report no usage at all. `dsh-session-log.ts`
therefore walks the frame structure itself (a port of DSH's own
`scanZstdFrames`), decodes one frame at a time, and tolerates a torn final frame
(the normal state of a live session) by keeping the frames before it. A decode
budget of `MAX_SESSION_FILE_BYTES` and a 64 MiB per-frame cap bound a crafted or
corrupt file; blowing either skips the whole log with a notice rather than
counting a prefix.

Record types read, by name:

| Type | Used for |
|---|---|
| `session` | the immutable header: id, cwd, createdAt, `parentSession`, `seedLength`, `isSeeded` |
| `assistant/message` | one completed model call: `data.usage` plus the model/provider that served it (the only usage record) |
| `tool/call` | one tool invocation, correlated to its `(turn, step)` |
| `request/header` / `request/context` | route fallback (model/provider) for a call that reports none |
| `turn/start` | the current turn for events that omit it |
| `user/message` | the human prompt preview, when `data.source.kind === 'user'` |
| `assistant/attempt` | an attempt that committed no surface message (v2+); its stream may carry usage |
| `llm/retry-started` | opens an additive attempt for a step |
| `session/end-seed` | the fork-seed cut (`data.inherited === true`) in v2+ |

Everything else — `tool/result`, `system/message`, `developer/message`,
`assistant/attempt` payloads beyond their usage chunk, the web-search and
title side requests, and the packed `data.stream` rows that repeat reasoning
text and tool arguments — is ignored by type before its `data` is decoded. The
one exception is a shell tool's `arguments`, parsed only for `command` so
Bash-command attribution matches every other collector.

### Version differences that matter

- **v0/v1** report usage per streamed chunk (`assistant/chunk` with
  `chunk.type === "usage"`).
- **v2/v3/v4** settle the step in `assistant/message.data.usage`. v4 additionally
  packs the whole attempt stream inside that record, so the same numbers also
  appear as a `chunk.type === "usage"` row in `data.stream`. The message's own
  `usage` is the collapsed authority and the stream chunk is only a fallback —
  reading both would bill one call twice. v4 also stamps `totalTokens`; the
  ledger uses the disjoint components instead, which is the same arithmetic.

## Token accounting

DSH reports disjoint counts: `inputTokens` is **uncached** input, cached input is
`cacheReadTokens` / `cacheWriteTokens`, and billed input is the sum of the three.

| DSH | Metrora |
|---|---|
| `inputTokens` | input |
| `outputTokens` (includes reasoning) | output |
| `cacheReadTokens` | cache read and cached input |
| `cacheWriteTokens` | cache creation |
| `reasoningTokens` | reasoning breakdown |

`reasoningTokens` is a **subdivision of `outputTokens`**, so it is reported with
`reasoningSemantics: 'aggregate-output'` and never added to output again — not in
the ledger, not in cost, not in the generated-token display. `cacheTokenEvidence`
records whether both cache subfields were present (`complete`), one
(`partial`) or neither (`unavailable`); the harness's own arithmetic bills input
as the sum of the three, so a missing cache field is not a reported zero.

DSH records no cost. Metrora computes it with `calculateCost` and marks the call
estimated. DSH's route ids are account names, so only the verified DeepSeek
routes (`deepseek-account`, `deepseek-official`, `deepseek`) declare
`pricingContext.pricingAuthority = 'deepseek'`, which lets the reviewed DeepSeek
price book settle the call (including its peak-hour policies); an unknown route
keeps its descriptive provider and no invented authority.

## Fork seeds

A forked session's log opens with its parent's leading events copied verbatim
under a new session id: `header.seedLength` (v0/v1) or the tagged
`session/end-seed` marker (v2+) is the cut. Those copied calls are already
counted by the parent's own log, so every event at or before the cut is
skipped. A seeded header without a tagged marker, or an unseeded header with
one, is treated as corrupt and the whole session is skipped.

## Retries and attempts

Observations are bucketed per `(turn, step)`. A settled observation replaces an
unsettled one in place; only an explicit `llm/retry-started` opens a new additive
attempt. That keeps a retried step from being counted twice while still billing a
retry that really did consume tokens. Tools and skills are attached to the last
observation of their step, so they are reported once.

## Caching

Eager provider on the shared session cache. `DSH_HOME` participates in the
provider env fingerprint, and the parse version
(`session-format-v4-fork-seed-attempt-v1`) forces one re-parse when the parser
changes. Compressed logs are re-read whole on change: frame boundaries are not
derivable from a byte offset without parsing every block header, and DSH's crash
recovery may rewrite its tail in place, so a stored offset could point into a
rewritten frame.

## Deduplication

`dsh:<session-id>:<turn>:<step>`, with `:attempt:<n>` appended for retries. The
key is scoped to the session that owns the log, which is what makes the fork-seed
cut load-bearing: the same call in the parent and in the child must not both be
emitted, and the cut is what guarantees it.

## What was verified against real logs

- 10 local sessions, all generation 4, decoded frame-by-frame: 324 usage rows
  from 324 `assistant/message` records, with zero undecodable frames.
- Every row's reported `totalTokens` equalled
  `input + output + cacheRead + cacheWrite` (324/324), matching DSH's own
  arithmetic.
- Real totals across those sessions: 1,036,585 uncached input, 389,482 output,
  36,984,448 cache-read, 0 cache-write — with no `reasoningTokens` reported.
- Session-format v4 emits no `assistant/chunk` records; retries appear as
  `assistant/attempt` (2 observed, neither carrying usage).
- Model identity: the log's route is `deepseek-account` / `deepseek-flash`, while
  the web-search and title side requests embedded in the same log put
  `deepseek-v4-flash` on the wire — the basis for the `deepseek-flash` alias in
  `src/models.ts`.

## Quirks

- The usage counter is 0-based per session, and a `session/end-seed` marker
  without `inherited: true` is an ordinary lifecycle boundary, not a fork cut.
- `data.stream` is a verbatim packed stream: never parse it for content, and
  never treat its usage chunk as a second call.
- A session that never reached a model call (a failed first attempt, for
  example) contains no usage row and therefore contributes nothing.
- Project directory names are lossy encodings of `cwd` and are only a fallback
  label; the header's `cwd` always wins.

## When fixing a bug here

1. Decide whether the bug is **discovery** (`dsh-session-log.ts` selection,
   generations, version gate) or **parsing** (`dsh.ts` buckets, retries, fork
   cut) before editing.
2. Keep the frame walk aligned with DSH's own reader; a torn tail must stay
   recoverable and a corrupt interior must skip the session, not the file prefix.
3. Add fixture coverage under `tests/providers/dsh.test.ts` using real
   `mkdtemp` directories — do not mock the filesystem — and include a
   `.zstd` fixture with more than one frame, since a single-frame decoder
   silently sees only the header.
4. Bump the `dsh` parse version in `src/session-cache.ts` when the emitted
   ledger changes, so already-cached sessions re-parse.
