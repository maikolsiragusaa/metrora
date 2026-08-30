# Local runtime and Performance Wave 001

**Status:** implemented in this branch; validate the final packaged artifact separately before release.

This wave adds two bounded local capabilities while preserving Metrora's existing
Harness, Tools and ACT boundaries:

- an existing-binary-only llama.cpp `llama-server` adapter in the shared Harness
  conversation loop;
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
OpenAI-compatible `/v1/chat/completions` endpoint through the existing Harness
conversation transport. It supports normal and SSE streaming, bounded model
metadata, explicit malformed/loading/unavailable outcomes and request abort
cancellation. Tool-call capability is reported as unknown unless a future
runtime probe can verify it; the adapter does not claim universal OpenAI
compatibility.

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
- throughput, standard deviation, average timing/latency and test time;
- prompt/generation/context sizes and repetitions;
- batch/ubatch/threads/GPU-layer/Flash-Attention/split/main-GPU setup;
- model filename/type/quantization/size/parameter count;
- llama.cpp build identity, backend, CPU/GPU and device fields.

Absent upstream fields remain `null` or empty; Metrora does not fabricate
TTFT, memory, utilization, quality or a universal score. Full local records
are retained in the separate `bench-history/performance-v1/records` family.
The record digest excludes timestamps and process diagnostics so retained
evidence stays comparable without storing raw stdout/stderr or local paths.

Performance comparison requires compatible method, runner version, exact setup,
hardware identity and completed runs. Model identity may differ; if the
comparison is not valid, the UI and CLI return a reason and no invented delta.

## Harness and privacy boundary

Harness can read completed Performance evidence through the existing
`get_bench_evidence` path and explain observed throughput/timing/setup facts.
That read is side-effect free. Harness does not start `llama-bench`, and this
wave adds no `run-performance` ACT kind. Core Compatibility remains the only
existing ACT operation.

The full Desktop Bench history may retain technical identity needed for local
comparison. Renderer and Harness content-minimal projections omit executable
and model paths, credentials, machine/user identifiers and raw process output.
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

Use the [Founder Harness acceptance checklist](FOUNDER_HARNESS_ACCEPTANCE_CHECKLIST.md)
for the manual runtime, Performance, privacy, cancellation and comparison
checks. The checklist is a procedure, not a claim that packaged release
acceptance has already been completed.
