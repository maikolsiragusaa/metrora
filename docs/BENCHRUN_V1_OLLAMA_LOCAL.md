# BenchRunV1 local Ollama

**Evidence family:** bounded runtime-performance evidence  
**Current status:** shipped public local contract  

See [Bench evidence families](BENCH_EVIDENCE_FAMILIES.md) for the distinction between Performance, Compatibility, future Coding Evaluation and future Agent Evaluation.

BenchRunV1 is Metrora's first small public timing/runtime evidence slice. It records bounded local runtime evidence for one explicitly selected Ollama model using a fixed versioned synthetic workload.

It is **not** a model-quality benchmark. It does not score coding, reasoning or accuracy, rank/recommend models, calculate cost/quota, read Metrora Usage or inspect real user work.

Its timing/token observations are useful runtime-performance evidence, but this contract does not provide the broader hardware/configuration Performance fields captured by the separate native llama.cpp adapter.

## Run it

```bash
metrora bench local --model <ollama-model>
metrora bench local --model <ollama-model> --format json --output ./benchrun.json
```

The model is required and selected explicitly. The runtime boundary is fixed to `http://127.0.0.1:11434`; there is no V1 option for a remote or arbitrary OpenAI-compatible endpoint. Ollama must already be running locally.

The default per-request timeout is 30 seconds. `--timeout-ms` may narrow or extend it only within the bounded 50–120000 ms range.

On runtime unavailable, timeout, cancellation or malformed response, the CLI prints a bounded diagnostic and exits non-zero. `--format json` still emits the JSON-safe run contract when a run has partial/failed evidence.

## Fixed methodology

- one warmup request followed by five measured requests;
- same `metrora.benchrun.synthetic.v1@1.0.0` fixture/parameters;
- `temperature: 0`, `seed: 1729`, `num_predict: 64`;
- streaming `/api/generate` with bounded response bytes/chunks/events/NDJSON/output;
- no dataset loading, filesystem prompt discovery, repository access or user-content input.

A fixed seed and temperature do not prove cross-model or cross-version deterministic text generation. That remains an evidence limitation rather than being converted into a quality claim.

## BenchRunV1 contract

Schema: `metrora.bench-run.v1`  
Runner: `ollama-local-v1@1.0.0`

The artifact contains:

- run/runner/fixture identity;
- selected/reported model and local runtime identity;
- factual environment identity limited to OS, architecture and Node version;
- fixed generation parameters and `1 + 5` methodology;
- start/end timestamps and per-run success/failure/cancel state;
- Metrora-observed request latency and time to first streamed content;
- bounded response/chunk/event counts, output length and output digest;
- nullable Ollama duration/token fields;
- measured-run aggregates: count/min/median/max/mean;
- failures, unstarted exclusions, termination state and result digest.

Observed timing and runtime-reported timing/token data remain separate. Missing runtime fields stay `null`; they are not replaced with zero/estimates. Raw generated text is not written to the artifact.

The result digest covers the versioned fixture, fixed generation contract, selected/reported model and per-run output/result metadata. It excludes timestamps/timing values, so timing variation alone does not change result identity. This is evidence identity, not a reproducibility/quality guarantee.

## Relationship to broader Performance Bench

The primary Bench direction is richer local **Performance** measurement of a declared model/runtime/hardware/configuration.

That future surface may include prefill/decode throughput, TTFT, RAM/VRAM and configuration/hardware identity through additional versioned adapters.

`BenchRunV1` remains a valid small Ollama runtime evidence contract; it is not silently reinterpreted as richer hardware evidence it never captured.

The native Performance engine is available through the separate bounded llama.cpp `llama-bench` adapter documented in [Local runtime and Performance Wave 001](LOCAL_RUNTIME_PERFORMANCE_WAVE_001.md); this BenchRunV1 contract does not add or reinterpret those fields.

## Runtime and provenance

Implementation uses Node's bounded HTTP `fetch` and no Ollama SDK/provider package. Response semantics follow official Ollama `/api/generate`, `/api/version` and streaming documentation.

No Ollama source is copied into Metrora by this slice, so no third-party notice is added by this contract. Individual model weights remain subject to their own licences and operator review.

An artifact is written only with `--output`; the write is local, bounded and atomic. There is no upload, publication, managed compute path, cloud credential, persistent Bench database or Desktop navigation for `bench local` V1.

The separate [Core Compatibility v1](BENCH_TASK_PACK_V1.md) surface adds versioned assertions, bounded private history and Desktop Bench routing without changing BenchRunV1.
