# Zed

Zed's built-in AI agent.

- **Source:** `src/providers/zed.ts`
- **Loading:** lazy via `src/providers/index.ts`
- **Parser version:** `threads-sqlite-zstd-cumulative-topup-v1`
- **Blocking tests:** `tests/providers/zed.test.ts` on Node 22.15 on Ubuntu and Windows
- **Signed sharing:** withheld pending model-provider propagation through the shared cache

## Where it reads from

One SQLite database with one row per agent thread:

- macOS: `~/Library/Application Support/Zed/threads/threads.db`
- Linux: `~/.local/share/zed/threads/threads.db`
- Windows: `%LOCALAPPDATA%\Zed\threads\threads.db`

## Storage format

The `threads` table stores each thread's `data` BLOB as zstd-compressed JSON (`data_type = "zstd"`). Legacy rows may be uncompressed JSON (`data_type = "json"`); both are read.

Decompression uses Node's built-in `zlib.zstdDecompressSync`, with no extra native dependency. Qovrion's CI now runs the collector explicitly on Node 22.15 on both Ubuntu and Windows so the primary zstd path cannot pass by being silently skipped.

The decompressed thread JSON carries:

- `model`: `{ "provider": ..., "model": ... }`
- `request_token_usage`: map of request/user-message key to input, output, cache-creation and cache-read counters
- `cumulative_token_usage`: the same counter shape for the complete thread

## Token paths

Zed contains two distinct evidence paths and they must not be assigned one universal quality label.

### Per-request usage

Entries present directly in `request_token_usage` carry measured input, output, cache-creation and cache-read counters.

### Cumulative remainder

The per-request map does not always cover every request. Qovrion sums the visible request entries and derives one `cumulative-remainder` entry by subtracting those values from `cumulative_token_usage`.

The remainder keeps totals equal to the database, but its token fields are **derived**, not independently measured request records.

A thread with no request entries degrades to one cumulative-remainder call.

## Model and provider identity

Zed records both:

- the exact model identifier in `model.model`;
- the underlying model provider in `model.provider`, such as `anthropic` or `zed.dev`.

The inherited parser currently preserves the model identifier but drops `model.provider` when converting provider output into Qovrion's shared cached call. Local dashboards remain usable, but signed sharing stays withheld because a future producer must not infer the AI provider from a model name or confuse the Zed client with the underlying model provider.

The next prerequisite is a generic optional `modelProvider` field carried through:

```text
ParsedProviderCall → CachedCall → ParsedApiCall → reviewed event context
```

Only after that field and its cache migration tests exist will Qovrion register separate Zed request and cumulative-remainder provenance profiles.

## Reasoning

The current Zed thread format does not expose a reviewed reasoning-token field or reasoning-effort level. A stored zero must not be interpreted as proof that no hidden reasoning occurred.

## Cost

Cost is calculated locally from model and token counters through Qovrion's pricing registry. It is not a provider billing receipt. Missing model or cache pricing must degrade the public cost to unavailable rather than altering token facts.

## Caching and deduplication

Zed uses Qovrion's shared session cache.

Deduplication is per:

```text
zed:<threadId>:<requestKey>
```

The synthetic remainder uses `cumulative-remainder` as the request key.

## Known limits

- All calls in one thread use the thread's `updated_at`; individual request timestamps are unavailable.
- All Zed usage currently lands under one local `zed` project; `folder_paths` is not yet mapped.
- Node versions below 22.15 lack built-in zstd support and skip current compressed rows with a notice.
- Signed sharing remains fail-closed until the recorded model provider survives normalization and cache reload.

## When fixing a bug here

1. Keep the SQLite/zstd tests executing on Node 22.15 or newer; a skipped zstd suite is not a valid pass.
2. Compare aggregate output with `cumulative_token_usage`; the request map alone can substantially undercount.
3. Preserve the distinction between measured request entries and the derived cumulative remainder.
4. Bump `ZED_PARSER_VERSION` whenever unchanged database rows require provenance re-review.
5. Do not infer the underlying AI provider from the model string.
