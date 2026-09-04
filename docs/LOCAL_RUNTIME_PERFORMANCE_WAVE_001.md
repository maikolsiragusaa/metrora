# Local runtime and Performance Wave 001

**Status:** implemented in this branch; validate the final packaged artifact separately before release.

This wave adds two bounded local capabilities while preserving Metrora's
analytics, Tools and local-runtime boundaries:

- an existing-binary-only llama.cpp `llama-server` connection adapter;
- a native llama.cpp `llama-bench` Performance adapter, separate from Core
  Compatibility / Runtime Health.

Neither path downloads, builds or starts a runtime. Neither path connects to
hosted inference.

## llama.cpp server runtime

The Desktop runtime selector exposes `llama.cpp server`. The adapter connects
only to the fixed local default `http://127.0.0.1:8080`; accepted loopback
host spellings are `127.0.0.1`, `localhost` and `::1`. Credentials,
paths, queries, fragments, arbitrary hostnames/IPs and remote URLs are rejected.

The adapter uses bounded `GET /health` and `GET /v1/models` discovery, then the
OpenAI-compatible `/v1/chat/completions` endpoint through its existing local
conversation transport. It supports normal and SSE streaming, bounded model
metadata, explicit malformed/loading/unavailable outcomes and request abort
cancellation. Tool-call capability is reported as unknown unless a future
runtime probe can verify it; the adapter does not claim universal OpenAI
compatibility.

Upstream model identifiers are treated as host-only routing data. When a
`/v1/models` response exposes a filesystem path, Electron keeps the exact raw
identifier only in its in-process route table so chat can address the selected
model. Renderer, capabilities and diagnostics receive only a bounded
opaque handle plus a safe basename-style label; Windows paths, Unix paths,
relative traversal and other raw identifiers never cross that boundary.

This is a connection adapter, not a second chat engine. It reuses the existing
conversation loop, message/tool boundary, privacy projection and cancellation
semantics.

## Native Performance

The CLI and Desktop Bench surface run the first native Performance method:

~~~
metrora bench performance --executable <absolute llama-bench path> \
  --model <absolute .gguf path>
metrora bench performance-history
metrora bench performance-compare <left-run-id> <right-run-id>
~~~

The adapter executes a known argument set directly with `shell:false`. It
accepts only an existing executable and existing `.gguf` model plus bounded
method settings. The default setup is:

| Setting | Default |
| --- | ---: |
| repetitions | 3 |
| prompt/prefill tokens | 512 |
| generation/decode tokens | 128 |
| batch | 2048 |
| ubatch | 512 |
| threads | runtime default |
| GPU layers | -1 |
| Flash Attention | auto |
| split mode | none |
| main GPU | runtime default |
| warmup | enabled |
| timeout | 10 minutes |

The adapter requests JSON output and normalizes upstream fields into the
versioned method `metrora.performance.llama-bench.v1` and evidence schema
`metrora.bench.performance.v1`. It preserves, when supplied by the executable:

- prefill/prompt, decode/generation and mixed workload rows;
- throughput, standard deviation, average timing/latency and ISO `test_time`;
- prompt/generation sizes, `n_depth`/depth and repetitions;
- declared and observed batch/ubatch/threads/GPU-layer/Flash-Attention/split/main-GPU configuration;
- model filename/type/size/parameter count (quantization is not inferred);
- llama.cpp build identity, backend, CPU/GPU and device fields.

Absent upstream fields remain `null` or empty; Metrora does not fabricate
TTFT, memory, utilization, quality or a universal score. Full local records
are retained in the separate `bench-history/performance-v1/records` family.
The record digest excludes timestamps and process diagnostics so retained
evidence stays comparable without storing raw stdout/stderr or local paths.

The native argv is fixed by the adapter: it always emits every declared
setting, including `-sm none`, and never accepts arbitrary flags or shell
syntax. After parsing, controlled upstream fields are normalized into
`observedConfiguration`. A material declared/observed mismatch, conflicting
rows or malformed evidence fails closed and cannot become a completed retained
record.

Performance comparison requires compatible method, runner version, exact setup,
observed configuration, hardware/environment identity and completed runs.
Model identity may differ; if the comparison is not valid, the UI and CLI
return the material identities, a reason and no invented delta.

`bench evidence` is the canonical factual aggregation for both local Bench
families. The read-only MCP adapter consumes that same transport-neutral source
for scope, latest/previous selection, comparison and state. MCP exposes
retained evidence only; it cannot start a Performance run.

## Privacy boundary

Metrora's read-only analytical and MCP surfaces can read completed Performance
evidence through the canonical `get_bench_evidence` path and explain observed
throughput/timing/setup facts. OpenCode does not start `llama-bench` through its
custom usage tool.

The full Desktop Bench history may retain technical identity needed for local
comparison. Renderer and external projections omit executable and model paths,
credentials, machine/user identifiers and raw process output.
The server adapter never accepts a credential field or remote endpoint.

Failure states are explicit: loading/unavailable server, unavailable executable,
cancelled, timeout, output-limit, malformed output and non-zero native exit are
not converted into zero throughput or a successful result.

## Upstream provenance

Metrora does not ship llama.cpp binaries. The integration was characterized
against the upstream server and `llama-bench` documentation at master commit
`9723942adc518b43c4b95dc4dce6906903eb5e09` and release tag `b10516`
(`b95502ba9aa0eb73a2f4fc8878d7fbe6a847a0b9`). See the upstream
[llama.cpp repository](https://github.com/ggml-org/llama.cpp), its
[server documentation](https://raw.githubusercontent.com/ggml-org/llama.cpp/master/tools/server/README.md)
and [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md).

The selected executable's reported build metadata remains the authority for
the actual local binary. The upstream license notice is
[LICENSES/LLAMA-CPP-MIT.txt](../LICENSES/LLAMA-CPP-MIT.txt).

## Acceptance

Use the [OpenCode Engine Spike 001](OPENCODE_ENGINE_SPIKE_001.md) procedure
for the current Desktop coding-engine acceptance. The llama.cpp server and
Performance paths remain separately testable local capabilities; this link is
not a claim that their packaged release acceptance is complete.
