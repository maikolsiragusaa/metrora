# Zed

Zed's built-in AI agent.

- **Source:** `src/providers/zed.ts`
- **Loading:** lazy via `src/providers/index.ts`
- **Parser version:** `sqlite-zstd-ledger-v1-model-provider-v1`
- **Blocking tests:** Zed SQLite/zstd tests on Node 22.15 on Ubuntu and Windows
- **Signed sharing:** approved only for the two reviewed paths described below

## Where it reads from

One SQLite database with one row per agent thread:

- macOS: `~/Library/Application Support/Zed/threads/threads.db`
- Linux: `~/.local/share/zed/threads/threads.db`
- Windows: `%LOCALAPPDATA%\Zed\threads\threads.db`

## Storage format

The `threads` table stores each thread's `data` BLOB as zstd-compressed JSON (`data_type = "zstd"`). Legacy rows may be uncompressed JSON (`data_type = "json"`); both are read.

Decompression uses Node's built-in `zlib.zstdDecompressSync`, with no extra native dependency. Metrora CI runs the collector explicitly on Node 22.15 on Ubuntu and Windows so the primary zstd path cannot pass by being silently skipped.

The decompressed thread JSON carries:

- `model`: `{ "provider": ..., "model": ... }`
- `request_token_usage`: map of request/user-message key to input, output, cache-creation and cache-read counters
- `cumulative_token_usage`: the same counter shape for the complete thread

## Reviewed token paths

Zed contains two distinct evidence paths. Metrora never assigns them one universal quality label.

### Per-request usage

Entries present directly in `request_token_usage` carry measured input, output, cache-creation and cache-read counters.

Reviewed profile:

```text
zed-request-token-usage-v1
```

### Cumulative remainder

The per-request map does not always cover every request. Metrora sums the visible request entries and derives one `cumulative-remainder` entry by subtracting those values from `cumulative_token_usage`.

The remainder keeps totals equal to the database, but its token fields are **derived**, not independently measured request records. A thread with no request entries degrades to one cumulative-remainder call.

Reviewed profile:

```text
zed-cumulative-remainder-v1
```

## Model and provider identity

Zed records both:

- the exact model identifier in `model.model`;
- the underlying model/API provider in `model.provider`, such as `anthropic`, `openai`, `google` or `zed.dev`.

Metrora now preserves that provider through:

```text
ParsedProviderCall → CachedCall → ParsedApiCall → reviewed event
```

Signed sharing requires the recorded provider. If it is missing or malformed, the call remains available locally but is withheld from signed measurements. The reviewed event factory also rejects a caller-supplied provider that conflicts with the value read from Zed.

Metrora never infers the provider from the model string and never treats the Zed client as the underlying model provider.

## Reasoning

The current Zed thread format does not expose a reviewed reasoning-token field or reasoning-effort level. A stored zero is not interpreted as proof that no hidden reasoning occurred.

## Cost

Cost is calculated locally from model and token counters through Metrora's pricing registry and is marked as an **estimated token-pricing cost**.

It is not:

- a Zed billing receipt;
- proof of the amount charged by `zed.dev`;
- proof that a subscription or included allowance incurred a marginal charge.

Missing model or cache pricing, or a mismatch with the locally calculated value, degrades the public cost to `unavailable` without altering the token facts.

## Caching and deduplication

Zed uses Metrora's shared session cache.

Deduplication is per:

```text
zed:<threadId>:<requestKey>
```

The synthetic remainder uses `cumulative-remainder` as the request key. The parser-version fingerprint forces one replay of existing Zed sources so previously cached calls recover `model.provider`.

## Privacy

Neither reviewed profile requires prompts, responses, source code, patches or local paths. The thread summary and private deduplication key are not serialized into public measurement events.

## Known limits

- All calls in one thread use the thread's `updated_at`; individual request timestamps are unavailable.
- All Zed usage currently lands under one local `zed` project; `folder_paths` is not yet mapped.
- Node versions below 22.15 lack built-in zstd support and skip current compressed rows with a notice.
- Cost remains a local list-price estimate, not provider-metered evidence.
- Calls without a valid source-recorded model provider remain local-only.

## When fixing a bug here

1. Keep the SQLite/zstd tests executing on Node 22.15 or newer; a skipped zstd suite is not a valid pass.
2. Compare aggregate output with `cumulative_token_usage`; the request map alone can substantially undercount.
3. Preserve the distinction between measured request entries and the derived cumulative remainder.
4. Bump `PROVIDER_PARSE_VERSIONS.zed` whenever unchanged database rows require provenance re-review.
5. Do not infer the underlying AI provider from the model string.
6. Do not present locally calculated cost as a Zed billing receipt.
