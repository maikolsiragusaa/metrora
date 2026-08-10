# Open Design

Open Design per-run model usage from local event logs.

- **Source:** `src/providers/open-design.ts`
- **Loading:** eager
- **Test:** `tests/providers/open-design.test.ts`

## Where it reads from

The default application-data root is platform-specific:

```text
macOS   ~/Library/Application Support/Open Design
Windows %APPDATA%/Open Design
Linux   ~/.config/Open Design
```

Set `METRORA_OPEN_DESIGN_DIR` to use an explicit root. The override may point to an application root, a namespace `data` directory, or a `runs` directory.

The provider recognizes these layouts:

```text
<root>/data/runs/<run-id>/events.jsonl
<root>/runs/<run-id>/events.jsonl
<root>/namespaces/<namespace>/data/runs/<run-id>/events.jsonl
```

Each `events.jsonl` file is one session source. The namespace or enclosing data root becomes the project label. Duplicate paths discovered through overlapping layouts are removed.

## Storage format

`events.jsonl` contains one JSON object per line. Malformed lines are skipped independently.

The parser follows three event forms:

- `start` events can establish the initial model for a run;
- `agent` events with `data.type = status` can change the active model;
- `agent` events with `data.type = usage` provide token counts.

Usage fields map as follows:

| Open Design | Metrora |
| --- | --- |
| `input_tokens` | total input before cache separation |
| `cached_read_tokens` | cache read and cached input |
| `output_tokens` | output |
| `thought_tokens` | reasoning |

Because cached input is included in the reported input total, Metrora subtracts `cached_read_tokens` from `input_tokens` before recording uncached input. Pricing uses uncached input, cache read, ordinary output and reasoning output through the shared pricing authority.

A usage event is emitted only after a model has been observed from `start` or a status transition. Runs without usage events contribute no calls. Open Design does not expose tool activity or a user-message field through this parser.

Timestamps can be ISO strings or numeric millisecond epochs. Invalid or absent timestamps remain empty and may be excluded by date-scoped aggregation.

## Caching

Open Design is an eager provider using the shared session cache. Every run's `events.jsonl` is fingerprinted as an independent source. The override directory and provider parser version participate in the provider configuration fingerprint.

The files are read locally; no Open Design account or network API is required.

## Deduplication

Each usage call uses:

```text
open-design:<run-id>:<event-id>
```

When an event has no usable ID, the parser assigns a stable per-file fallback counter for that parse. A shared deduplication set prevents the same usage event from being counted twice across repeated scans.

## Quirks

- A run can switch models. Each usage event is attributed to the most recently observed model.
- A `start` event can seed the model before any later status event.
- Cache-read tokens are included in Open Design's input total and must be separated before pricing.
- Reasoning tokens are priced with output tokens while remaining separately reported.
- The environment variable retains the historical `METRORA_` prefix for compatibility; it is not the product name.
- Known model display aliases are presentation-only. Raw model identifiers remain the accounting authority.

## When fixing a bug here

1. Test both start-seeded and status-transition model attribution.
2. Preserve cache-read subtraction from total input.
3. Cover ISO and numeric timestamps in date-scoped aggregation.
4. Keep malformed JSONL lines isolated from later valid events.
5. Test duplicate event IDs with a shared deduplication set.
6. Do not infer tools, prompts or costs beyond the fields present in the event log.
