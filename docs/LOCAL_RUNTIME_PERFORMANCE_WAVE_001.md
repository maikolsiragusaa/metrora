# Local runtime and Performance Wave 001

**Status:** implemented in this branch; validate the final packaged artifact separately before release.

This wave adds two bounded local capabilities while preserving Metrora's existing
Harness, Tools and ACT boundaries:

- an existing-server-only llama.cpp `llama-server` adapter in the shared Harness
  conversation loop;
- a native llama.cpp `llama-bench` Performance adapter, separate from Core
  Compatibility / Runtime Health.

The llama-server path never downloads, builds or starts a runtime and neither
path connects to hosted inference. Desktop Performance may explicitly acquire
the pinned official llama-bench artifact through the Metrora Component Manager;
that is a separate user-triggered component install, never a silent runtime
install or server start.

## llama.cpp server runtime

The Desktop runtime selector exposes `llama.cpp server`. The adapter connects
only to HTTP loopback at a user-selected validated port, defaulting to
`http://127.0.0.1:8080`; accepted loopback host spellings are
`127.0.0.1`, `localhost` and `::1`. Ports are bounded to `1` through
`65535`. Credentials, paths, queries, fragments, arbitrary hostnames/IPs and
remote URLs are rejected.

The adapter uses bounded `GET /health` and `GET /v1/models` discovery, then the
OpenAI-compatible `/v1/chat/completions` endpoint through the existing Harness
conversation transport. It supports normal and SSE streaming, bounded model
metadata, explicit malformed/loading/unavailable outcomes and request abort
cancellation. Tool-call capability is reported as unknown unless a future
runtime probe can verify it; the adapter does not claim universal OpenAI
compatibility.

Upstream model identifiers are treated as host-only routing data. When a
`/v1/models` response exposes a filesystem path, Electron keeps the exact raw
identifier only in its in-process route table so chat can address the selected
model. Renderer, Harness, capabilities and diagnostics receive only a bounded
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
families. The Desktop Harness adapter and the read-only MCP adapter consume
that same transport-neutral source for scope, latest/previous selection,
comparison and state. MCP exposes retained evidence only; it cannot start a
Performance run or grant execution authority.

## Harness and privacy boundary

Harness can read completed Performance evidence through the existing
`get_bench_evidence` path and explain observed throughput/timing/setup facts,
including bounded observed configuration. MCP uses the same retained fixture
and canonical source through its read-only `get_bench_evidence` tool.
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

Metrora does not bundle llama.cpp binaries in the application. Desktop can
explicitly install the official pinned `llama-bench` release `b10621` into
its Metrora-owned component directory after HTTPS download and checksum
verification; provenance records the exact `cpu` backend and `cpu` variant.
The managed catalog is deliberately CPU-only: it is a truthful portable
benchmark fallback, not a claim of native GPU coverage. Its exact official
release assets and SHA-256 values are:

| Platform | Official asset | SHA-256 |
| --- | --- | --- |
| Windows x64 | `llama-b10621-bin-win-cpu-x64.zip` | `0e8b65e650e369f70f8307d890508886f171ef4fb00facccddd4a1b7ffdaca51` |
| Windows arm64 | `llama-b10621-bin-win-cpu-arm64.zip` | `c072e8bb057751587243c1e0ed28d82e23c7e0544a426e0d476f1e77792bf3ce` |
| macOS x64 | `llama-b10621-bin-macos-x64.tar.gz` | `33c44e036e0e223f71a29fc74a0ab3e130ca9eadeb032ecc1c7af25985b8b91b` |
| macOS arm64 | `llama-b10621-bin-macos-arm64.tar.gz` | `429c8270608600188035e5e92f7d78dffb7900904fe7dd7e6a84f48068cd13cf` |
| Linux x64 | `llama-b10621-bin-ubuntu-x64.tar.gz` | `91d7b03ddae498a39f28fdb85d84d2b4a0fd3838d10b4f897e0ef8975bb9b583` |
| Linux arm64 | `llama-b10621-bin-ubuntu-arm64.tar.gz` | `95940151be63492f70f659da420b268244cc83a6ee70e310d2600ccdb7ea4deb` |

The same upstream `b10621` release publishes backend-specific Windows CUDA,
Vulkan, OpenVINO, SYCL and ROCm assets. The CUDA packages are paired with
separate `cudart`/cuBLAS DLL archives, so selecting one safely would require
trusted local backend detection plus an atomic multi-asset install. This wave
has neither a trusted pre-install hardware detector nor that transaction
contract; it therefore does not auto-download or imply accelerated coverage.
Users can still select an existing accelerated `llama-bench` executable
manually. See the upstream [b10621 release](https://github.com/ggml-org/llama.cpp/releases/tag/b10621),
[release attestation](https://github.com/ggml-org/llama.cpp/attestations/42818481)
and [release packaging workflow](https://raw.githubusercontent.com/ggml-org/llama.cpp/master/.github/workflows/release.yml)
for the characterized asset composition. Provenance is retained and the CLI
continues to require an existing executable path. The integration was
characterized against the upstream server and `llama-bench` documentation. See the upstream
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
